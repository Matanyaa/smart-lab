# TASK — Iteration 3 continued (rev 3): Admin exclusivity, branding, UI cleanup, remaining verification

**Target app version:** `docs/test/` → `0.3.0-t03`; `docs/` (root) → `0.1.1-t01`
**Task drafted/updated:** 2026-09-17 (rev 3 — follow-up from the user's own hands-on testing of `0.3.0-t02`)

Read `CLAUDE.md` first, then `SPEC.md`'s "Roles" section (revised today — new "Admin exclusivity" paragraph) before starting. This isn't a new iteration's data model — it's four small, independent follow-ups on the Iteration 3 work you already built and the user has now tested, plus finishing that iteration's original Step 5. Still no case/sample/action model (that stays a separate future task).

## Step 1: Admin exclusivity in the admin screen (`docs/test/` only)
- On the add-user form's role dropdown: remove `admin` as an option. Only `client` / `team_leader` / `worker` should ever be selectable there.
- On the existing-user list's inline role editor: same — `admin` should never appear as a choice for any user, including when editing a non-admin's role.
- The admin account's own row in that user list: render it without the role/verifier/status edit controls (read-only display of `admin` + whatever tag/status it has). There's exactly one admin, it isn't editable through this screen, and there's no second admin to promote — a comment noting why is enough, no need to over-engineer.
- No Firestore rules change needed for this — rules are already admin-gated for any `users/*` write, so this is purely about not offering an option in the UI that shouldn't be picked. If you find a Firestore rules case where a non-admin *could* actually set `role: "admin"` on themselves or anyone if they crafted the write by hand, flag it — that would be a real gap worth closing, not just a UI nicety.

## Step 2: Inline app logo + launched-icon recolor
- Add the app's own `icon.svg` inline in the header, next to the "Smart Lab" title — `docs/index.html` uses `docs/icon.svg`, `docs/test/index.html` uses `docs/test/icon.svg`. Since `docs/test/` has no manifest anymore (removed in the Android-install-collision fix), this has to be a plain inline element (e.g. an `<img>` or inlined `<svg>`) referencing the file directly, not anything manifest-driven. Size it reasonably next to the title text — you have discretion on exact sizing/spacing.
- Recolor `docs/icon.svg`'s accent (the flask outline + bubble dots, currently green `#4ac98f`) to orange — use `#e8590c`. This was picked specifically to stay visually distinct from `docs/test/icon.svg`'s existing amber (`#f5a623`), since the two builds' icons need to be tellable apart at a glance; flagged for the user to eyeball once built and say if they'd rather adjust the exact shade. Leave the dark background (`#141a1f`) and the flask/bubble geometry itself unchanged — only the accent color changes.
- `docs/test/icon.svg` — leave completely as-is (amber, unchanged).
- This touches `docs/` (launched), so bump it to `0.1.1-t01` per the versioning convention (a patch-level cosmetic fix to something already launched, tested under a `-tNN` suffix before dropping it). This is the first time `docs/` has changed since `0.1.0` — the login/data-model work from Iteration 3 stays entirely on `docs/test/`, untouched here.

## Step 3: Remove the round-trip test UI, relocate Logout (`docs/test/` only)
- Remove the leftover Firestore round-trip ping-test UI (the button/status display left over from the iteration-1 infra skeleton, writing/reading `test_ping/latest`). It's served its purpose and is just visual clutter now.
- Move the Logout button to sit next to the username/role/verifier display that Iteration 3 already added (Step 3 of the original TASK.md) — wherever exactly makes sense given the current layout; you have discretion, just get it out of whatever less-natural spot it's currently in.
- Root (`docs/`) is untouched by this step — it's still on the pre-roles fixed-formula login with no admin screen, so its own round-trip/logout layout is a separate call for whenever `docs/test/` eventually gets promoted to launched, not now.

## Step 4: Finish Iteration 3's original Step 5 verification (still open from `0.3.0-t02`)
This was flagged as not-yet-exercised when Iteration 3 was marked complete — finish it now, using the current admin screen (with Step 1's exclusivity changes already in place):
- Add one account per type: a `client` (no verifier), a `team_leader`, and a `worker` — verifier tag on one of the latter two, not the other.
- Confirm each logs in with the correct role/tag shown and no admin screen.
- Pick one non-admin account and reissue its password. Confirm the old password stops working, the new one logs into the *same username*, and role/verifier/status are unchanged.
- Confirm directly (e.g. via browser console) that a non-admin's read of another user's `users/{uid}` doc is genuinely denied by the rules, not just hidden by the UI.

## Where to build this
`docs/test/` for Steps 1, 3, 4. `docs/` (root) for the icon-color half of Step 2 only — root gets no other changes.

## Explicitly NOT in scope for this task
- Any case/sample/action model work (separate future task).
- Changing root's login flow, adding an admin screen to root, or touching root's round-trip/logout layout.
- A true Auth-account delete, or any other item already marked out-of-scope in the original Iteration 3 TASK.md.

## Definition of done
- Admin screen's role dropdowns (add-user and edit-role) never show `admin` as an option; the admin's own row has no edit controls.
- Both `docs/` and `docs/test/` show their own logo next to "Smart Lab" in the header; `docs/`'s icon accent is orange (`#e8590c`), `docs/test/`'s is unchanged amber.
- `docs/test/`'s round-trip test UI is gone; Logout sits next to the username/role/verifier display.
- All of original Step 5's verification (client/team_leader/worker creation, reissue, rules-enforcement check) confirmed working.

## Versioning
`docs/test/`: `0.3.0-t03`, bumping further if more passes are needed. `docs/`: `0.1.1-t01`, dropping the suffix once the user's confirmed the icon looks right.

## When done
- Add a short completion note below this line: what you built, any deviations, any questions or blockers (especially if you find a real rules gap in Step 1, or want to propose a different orange shade).
- Log any real decisions as a dated entry in `SPEC.md`'s Decisions Log.

---

*(Claude Code: add your completion note below this line.)*

**Done — 2026-09-17.** `docs/test/` bumped to `0.3.0-t03`, `docs/` (root) bumped to `0.1.1-t01`.

- **Step 1 (admin exclusivity):** removed `admin` from both the add-user role dropdown and the per-row inline role editor. The admin's own row in the user list now renders role/verifier/status as plain text with no edit controls (and its Reissue button is left available — not asked to remove it, and it's a legitimate action on any account including the admin's own). **Checked the rules gap you flagged: there isn't one.** `allow create, update: if isAdmin();` on `users/{uid}` requires the *caller* to already be admin unconditionally — there's no `|| request.auth.uid == uid` self-write exception, so a non-admin can't write to any `users/*` doc at all, including their own. Self-promotion was never possible; no rules change made.
- **Step 2 (logo + recolor):** `docs/icon.svg`'s three accent colors changed from green `#4ac98f` to orange `#e8590c` (background/geometry untouched). `docs/test/icon.svg` left alone (amber, unchanged). Both `docs/index.html` and `docs/test/index.html` now show a 22×22px inline `<img>` of their own icon next to "smart-lab" in the header (plain `<img>`, not manifest-driven, since `docs/test/` has no manifest).
- **Step 3 (cleanup):** removed the round-trip ping-test button/result box and its now-unused `serverTimestamp` import from `docs/test/index.html`. Logout now sits directly under the "Signed in as {username}" heading in the app-screen card (role/verifier stayed in the header badge next to the version, unchanged from Iteration 3).
- **Step 4 (verification):** not run by me — this needs real credentials/manual judgment on the live admin screen (creating accounts, confirming role/tag display, reissuing a password, checking rules denial via browser console). Ready for you to run now that Steps 1–3 are deployed; happy to walk through it live if useful.

No blockers. No deviations beyond what's noted above.

**Update 2026-09-17 — further ad hoc follow-ups, in chat, beyond this TASK.md's text:**
- Self-service "Change password" for any signed-in role (reauth + `updatePassword`), distinct from admin Reissue.
- Verifier stripped from `docs/test/`'s UI/data model entirely — coming back later in a different shape.
- Admin user list now defaults to Active users, with a sliding Active/Non-active toggle.
- Removed the "Signed in as X / No case data yet" welcome card; Change password and Logout moved into the header top-right.
- Header now shows a "Hello **{username}** — {role}" greeting instead of a plain role badge.

**Task complete — 2026-09-17. Launched.** `docs/` (root) promoted to plain `0.3.0`, replacing the old iteration-1 fixed-formula login + ping round-trip with the full feature set above: `usernames`/`users` login, admin screen, reissue, self-service password change, orange branding. `docs/test/` stays at `0.3.0-t07`, now functionally identical to root (both share the same Firestore `users`/`usernames` docs and `setup/firestore.rules`, so the admin account bootstrapped earlier for testing already works on root too — no separate root bootstrap needed).

Root's `docs/manifest.json`/`docs/sw.js` (install-to-home-screen) are untouched and still apply — only `index.html` changed. `docs/test/` keeps its non-installable, bookmark-only status from the earlier install-collision fix.

*(Claude Code: add your completion note below this line.)*
