# TASK — Iteration 3: Login types & Admin (roles, verifier tag, password reissue)

**Target app version:** `0.3.0-t01`
**Task drafted/updated:** 2026-09-17 (rev 2 — username-stable identity model + reissue added after design discussion)

Read `CLAUDE.md` first, then `SPEC.md`'s "Roles" and "Authentication" sections (both revised today). Key change from rev 1: login no longer resolves a username straight to `username@smart-lab.internal` by formula — it goes through a small lookup doc instead, specifically so an admin can later swap out *which* Firebase account backs a username (a "reissue") without disturbing anything that references that person elsewhere in the app. This task builds that plus the admin screen; still no case/sample/action model.

## Step 1: Data model
Two Firestore collections:

- **`users/{uid}`** — one doc per Firebase Auth account. Fields: `username` (string), `role` (`"client" | "team_leader" | "worker" | "admin"`), `verifier` (boolean — must be `false`/absent when `role === "client"`), `status` (`"active" | "disabled"`, default `"active"`).
  - **Important for later:** `username` here is the stable identifier — once the case/sample/action model exists (a future iteration), it should reference people *by username*, never by `uid`. A `uid` can be replaced (see Step 4, reissue); a username isn't expected to change. Leave a code comment on this collection saying so, for whoever builds that later.
  - Disabled accounts are never deleted — they just sit there permanently inert, and that's fine (see SPEC's Authentication section on why delete isn't being built).
- **`usernames/{username}`** — one doc per login username. Fields: `authEmail` (string — whichever synthetic email currently signs this username in). This is what makes reissue possible: the username stays fixed, but which email/Firebase-account it points to can change.

Security rules (`setup/firestore.rules`):
- `usernames/{username}`: **public read** (needed before anyone's signed in, to resolve a typed username into an email to attempt sign-in with), admin-only write.
- `users/{uid}`: a signed-in user can always read their own doc; only a caller whose own `users/{their uid}.role == "admin"` can read any `users/*` doc or write another user's doc. No client-side `delete`.
- Don't over-engineer edge cases (e.g. an admin editing their own role) — a comment flagging it as a known gap is enough for this pass.

**Login flow, updated:** username + password entered → read `usernames/{username}` → get `authEmail` → `signInWithEmailAndPassword(authEmail, password)` → on success, read `users/{resulting uid}` for role/verifier/status.

**Manual bootstrap step, once, by the user (you can't do this from the app — no admin exists yet to grant the first one)**: after creating your own Firebase Auth account as before, manually create *both* `users/{your uid}` (`role: "admin"`, `status: "active"`) **and** `usernames/{your username}` (`authEmail: "<your synthetic email>"`) in the Firebase Console's Firestore data browser — both are needed for login to work under the new flow. Write clear step-by-step instructions for this into `setup/README.md`.

## Step 2: Add-user (admin-only)
- On login, look up the signed-in user's own `users/{uid}` doc. If `role !== "admin"`, don't render the admin screen at all (convenience only — the security rules above are the real protection).
- Admin screen: a form (username, password, role dropdown, verifier checkbox — clear/disable it when role is `client`) to add a new user, plus a list of existing users (username/role/verifier/status) with inline editing of role, verifier, and status.
- **Mechanism**: a second, temporary Firebase App instance (`initializeApp(firebaseConfig, "secondary")` with its own `getAuth()`) calls `createUserWithEmailAndPassword` with email `<username>@smart-lab.internal` on that secondary instance — creates the new Auth account without disturbing the admin's own session. Sign out and discard the secondary instance right after. Then, from the primary (still-admin) session, write `users/{newUid}` and `usernames/{username}`.
- Editing an existing user's role/verifier/status is a plain Firestore update to their `users/{uid}` doc.

## Step 3: Show role/tag after login
- Somewhere visible after login (near the version banner is fine): show the logged-in username, their role, and "Verifier" if the tag is set. This is the main test surface for Steps 1–2.

## Step 4: Reissue (admin-triggered password change for an existing user)
This is how "change a user's password" actually gets built this iteration — not a true Admin-SDK reset (still needs Blaze, still deferred), but a Spark-compatible substitute that achieves the same practical outcome: the admin gives someone a new password.
- On the admin screen's user list, a "Reissue" action per user, prompting for a new password.
- Mechanism: same secondary-app-instance trick as Step 2 creates a **new** Firebase Auth account — needs a **different** internal email than the original, since the old account isn't being deleted (e.g. append a short disambiguator the user never sees, like `<username>.r2@smart-lab.internal`; exact scheme is your call, just make it obviously distinguishable in case you're ever looking at the Firebase Console directly).
- Copy `username`, `role`, `verifier` from the old `users/{oldUid}` onto a new `users/{newUid}` doc (`status: "active"`). Set the old doc's `status` to `"disabled"`.
- Update `usernames/{username}.authEmail` to the new account's email.
- Result: the person logs in with the exact same username and the new password. Nothing else about them (role, verifier, and — once it exists — anything assigned to them by username) changes.
- **Not building**: deleting a user's Auth account outright. Between "disable" (Step 1/2, already free) and "reissue" (this step), a real delete may never actually be needed — see SPEC's Authentication section. If it ever is, it stays a manual Firebase Console action, not an in-app one.

## Step 5: Create test accounts and exercise all of it
Using the admin screen:
- Add one account per type: a `client` (no verifier), a `team_leader`, and a `worker` — put the verifier tag on one of the latter two, not the other.
- Pick one non-admin account and **reissue** its password. Confirm: old password no longer works, new password logs in under the *same username*, and role/verifier/status are unchanged after the reissue.
- (Your `admin` account is the one bootstrapped manually in Step 1.)

## Where to build this
`docs/test/` — same convention as the last iteration. Bump `docs/test/index.html`'s `APP_VERSION` to `0.3.0-t01`.

## Explicitly NOT in scope for this iteration
- Deleting a user's Auth account (see Step 4 — likely never needed at all; manual Console fallback if it ever is).
- Any feature-level role *restriction* beyond hiding/showing the admin screen itself — no client-only or worker-only views of anything yet. That's Phase plan items 4–5, not this task.
- Review-anonymity elevated admin access — unrelated open question.

## Definition of done
- Logged in as the bootstrapped admin: the admin screen is visible, and you can add a new user for each role/tag combination in Step 5 and see them appear in the list.
- Logging in as each newly-created account shows the correct role/tag on screen and does **not** show the admin screen.
- Reissuing one account's password works exactly as described in Step 5 — same username, new password, unchanged role/verifier/status.
- The Firestore rules are actually enforcing this, not just the UI hiding buttons — e.g. a non-admin account's direct read of another user's `users/*` doc should genuinely fail.

## Versioning
`docs/test/`: `0.3.0-t01`, bumping `-t02`, `-t03`... if more passes are needed. Root stays at plain `0.1.0` throughout — untouched by this task.

## When done
- Add a short completion note below this line: what you built, any deviations, any questions or blockers.
- Log any real decisions (exact rules syntax, the secondary-app-instance code pattern, the reissue email-disambiguation scheme you picked, anything about the admin-bootstrap step that wasn't obvious) as a dated entry in `SPEC.md`'s Decisions Log.

---

*(Claude Code: add your completion note below this line.)*

**Done — 2026-09-17.** Built in `docs/test/index.html`: `users/{uid}` + `usernames/{username}` model, admin-gated `setup/firestore.rules`, admin screen (add user, inline role/verifier/status editing), and reissue. `docs/test/index.html` bumped to `0.3.0-t01`.

- Login flow now does the `usernames/{username}` → `authEmail` lookup before `signInWithEmailAndPassword`, per rev 2's spec.
- Admin screen only renders when the signed-in user's own `users/{uid}.role === "admin"`; the real protection is in the rules, not this check.
- Add-user and reissue both use a uniquely-named secondary Firebase app instance (`secondary-${Date.now()}`) to create the new Auth account without disturbing the admin's own session, then write Firestore from the primary session.
- Reissue's disambiguated email: `${username}.r${Date.now()}@smart-lab.internal`.
- Rewrote `setup/firestore.rules` rather than extending it — the prior blanket "any signed-in user" rule would have silently bypassed the new admin-only gates if left in place alongside them (Firestore rules are permissive-OR across matching blocks). Full reasoning and exact rules in `SPEC.md`'s Decisions Log.
- Wrote the one-time admin-bootstrap steps into `setup/README.md` (UID-keyed `users` doc + username-keyed `usernames` doc, created by hand in the Console).
- Root (`docs/index.html`) untouched, stays on the old fixed-formula login as scoped — still plain `0.1.0`.

**Deviation:** left `status: "disabled"` as a tracked/editable field with no enforcement yet (doesn't block login) — matches this task's own "no feature-level restriction beyond hiding the admin screen" scope note, flagged with a comment in the rules file rather than silently built further.

**Verification needed from you (Step 5):** bootstrap your admin account per `setup/README.md`'s new section, then from the admin screen add a `client`, `team_leader`, and `worker` (verifier tag on one of the latter two), confirm each logs in with the correct role/tag shown and no admin screen, then reissue one non-admin account's password and confirm the old password stops working while the new one logs into the same username with role/verifier/status unchanged. Also worth a direct check that a non-admin's browser console can't read another user's `users/{uid}` doc (rules should reject it, not just the UI hiding it).
