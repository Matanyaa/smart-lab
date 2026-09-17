# TASK — Offline persistence, script modularization, rules cleanup, admin greeting tweak

**Target app version:** `docs/test/` → `0.3.1-t01`; `docs/` (root) → `0.3.1` once confirmed (no `-tNN` on root — see CLAUDE.md's updated versioning convention). **Treat this whole task as a patch, not a minor** — none of it is a new user-facing feature area, just robustness/structure/cleanup.
**Task drafted/updated:** 2026-09-17

Read `CLAUDE.md` first (note the updated "How this project is being run": you now only read `CLAUDE.md`/`SPEC.md`/`TASK.md` and only write to `HANDOFF.md` — nothing you log goes back into this file or into `SPEC.md` directly anymore). This task is five small, mostly-independent pieces that came out of a design-session architecture review, not a new data-model iteration — still no case/sample/action work here.

## Step 1: Split the script into ES modules
Both `docs/index.html` and `docs/test/index.html` (~560 lines each) are still single files with all their JS inline. Before this grows further, split the `<script type="module">` content into a few separate module files, loaded with plain `<script type="module" src="...">` — no bundler, no build step, this works natively in every current browser and deploys to GitHub Pages exactly as-is.

- You have discretion on the exact module boundaries — you know the actual code's dependencies better than this instruction does — but a reasonable starting split, based on the app's current shape: a small module holding the Firebase app/auth/Firestore instances (shared state everything else imports), a module for login/logout/change-password/the signed-in greeting, a module for the admin screen (user list, add-user, inline edit, reissue), and a module for the version-check banner.
- Keep this to a pure refactor — no behavior change. If moving something reveals an actual bug or an awkward dependency, note it in `HANDOFF.md` rather than silently changing behavior to work around it.
- Do this on `docs/test/` first as usual; only bring it to `docs/` once confirmed working.

## Step 2: Enable Firestore offline persistence
In whichever module now initializes Firestore, switch from the plain `getFirestore(app)` call to the persistent-cache form, e.g.:

```js
initializeFirestore(app, { localCache: persistentLocalCache({}) });
```

- Do this for both `docs/` and `docs/test/`'s Firestore instances (they're separate `initializeApp` calls today, so this is two call sites, not one).
- No other code changes should be needed — reads, writes, and listeners keep working offline and sync automatically on reconnect. If you find that assumption wrong for anything in the current code (e.g. something that assumes a write always completes synchronously), flag it in `HANDOFF.md` rather than guessing at a fix.
- Quick sanity check once built: load the app, go offline (dev tools network throttling is fine), confirm the signed-in screen still reads/behaves, then reconnect and confirm nothing got stuck.

## Step 3: Remove the dead `ping`/`test_ping` Firestore rules
Small, unrelated cleanup queued from the same review: the round-trip test UI that used `ping`/`test_ping` was already removed from both builds, but `setup/firestore.rules` still has open read/write match blocks for both collections. Delete those two match blocks. (The `ping/latest` and `test_ping/latest` documents themselves are harmless leftover data — feel free to delete them too via the Firebase Console if convenient, but that's not blocking.)

## Step 4: Admin greeting — drop the redundant role
The header greeting ("Hello **{username}** — {role}") is right for everyone except admin, where the username and role are effectively the same word (e.g. "Hello **admin** — admin" reads as redundant). For the signed-in admin account only, show just "Hello **{username}**" with no "— {role}" suffix; every other role keeps the full "Hello **{username}** — {role}" form unchanged.

## Step 5: "What's new" changelog popup
A plain-language changelog, distinct from `SPEC.md`'s Decisions Log (that's written for the design/build workflow, not for whoever actually uses the app) and from `HANDOFF.md` (your build notes back to the design session). This one's user-facing.

- New small module (or data file) holding a short, ordered list of version entries — each just a version number, a date, and a **short, plain-language summary** of what changed, written so someone with no technical background understands it at a glance. A handful of short bullets per version at most (most versions should be 1-3), each one plain sentence, no jargon, no implementation detail, no code/file names, no internal reasoning — describe the effect the user would notice, not the mechanism (e.g. "The app now keeps working briefly if your connection drops" rather than "Enabled Firestore persistentLocalCache"; "Cleaned up the admin screen" rather than "Removed dead ping/test_ping rules"). Purely internal changes with no user-visible effect (this task's script modularization, for instance) get no entry at all — it's fine, even expected, for some versions to have nothing worth showing. Start the list fresh from this version (`0.3.1`) — no need to backfill entries for everything before it.
- On load, compare the current version against a "last seen version" stored in `localStorage`. If the current version is newer, show a popup listing every entry newer than what was last seen, then update the stored value to the current version. If a version has no user-facing entries at all, it shouldn't trigger the popup on its own.
- Make the existing version display (already shown near the top of the app) clickable — pressing it opens the same popup on demand, showing the recent entries regardless of what's been "seen." This works the same on `docs/` and `docs/test/`.
- **Suppress the automatic popup on `docs/test/`'s `-tNN` builds specifically** — those are in-progress by nature, and popping up a changelog on every testing pass would get noisy. The version number stays clickable there too; it just doesn't self-trigger. Root (`docs/`) always auto-triggers, since it only ever gets plain versions now.
- Going forward, add a changelog entry as a standing part of "when done" (alongside your `HANDOFF.md` note) for any future task that changes something a user would notice — same bar every time: short, plain-language, no jargon, describes the effect not the mechanism. Flag in your completion note that you've picked this up as a habit, not just for this one task.

## Where to build this
`docs/test/` for all five steps first, as usual. Promote to `docs/` only once confirmed — and per the updated versioning convention, `docs/` goes straight to a plain `0.3.1`, no `-tNN` on root even though this is its first change since `0.3.0`.

## Explicitly NOT in scope for this task
- Any case/sample/action model work.
- Introducing Alpine.js or any other reactive layer — that's a separate future call, once the case/sample/action CRUD UI actually needs it.
- Rules unit tests / GitHub Actions rules deploy — a separate, larger piece if it happens at all.

## Definition of done
- `docs/test/index.html`'s script is split into separate module files with no behavior change; `docs/`'s isn't yet (until promoted).
- Both builds' Firestore instances use `persistentLocalCache`; basic offline sanity check passes.
- `setup/firestore.rules` no longer has `ping`/`test_ping` match blocks.
- Admin's greeting reads "Hello **admin**" with no role suffix; every other role's greeting is unchanged.
- Loading a version newer than what's stored in `localStorage` shows the "what's new" popup with everything since last seen (except on `docs/test/`'s `-tNN` builds); clicking the version number opens it on demand anywhere.

## When done
Log your completion note in `HANDOFF.md` — what you built, the exact module boundaries you chose, any deviation, and the current app version reached. Do not write to this file or to `SPEC.md`.
