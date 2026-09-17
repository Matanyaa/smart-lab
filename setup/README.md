# Smart Lab

Personal web app for managing failure-analysis / metallurgical inspection lab
work. See `../SPEC.md` for the full design and `../TASK.md` for what's currently
being built (`../CLAUDE.md` explains the three-file workflow).

App code lives under `../docs/` (that's the GitHub Pages source folder, not
documentation). This file and `firestore.rules` live here in `setup/` since
they're project setup/reference material, not app code or the top-level
governance docs.

## Firebase setup (required before this app works)

`docs/index.html` already has the project's `firebaseConfig` wired in
(project `smart-lab-abd80`). Still needed in the
[Firebase Console](https://console.firebase.google.com/), if not done already:

1. **Firestore** — Build → Firestore Database → Create database →
   **Native mode** → pick a region.
2. **Auth** — Build → Authentication → Sign-in method → enable **Email/Password**.
3. **Create the first test account** — Authentication → Users → Add user.
   Since login uses a username, not a real email, enter it as
   `<username>@smart-lab.internal` (e.g. `matanya@smart-lab.internal`) with
   a password. Log into the app using just `matanya` as the username.
4. **Security rules** — Firestore Database → Rules → paste in the contents of
   `firestore.rules` (this folder) → Publish. As of iteration 3, this scopes
   `users`/`usernames` to admin-gated read/write (see below) and everything
   else (`ping`, `test_ping`) to signed-in users only.

## Test environment (`docs/test/`)

`docs/test/` is a copy of the launched build — same Auth users, same
`(default)` Firestore database — so no extra Firebase setup is needed for it.

Firestore's second-named-database feature needs the paid Blaze plan; on the
free Spark plan (what this project is on), only `(default)` is available. So
data separation between `docs/` and `docs/test/` is a collection-name prefix
instead: the launched build's round-trip test writes to a `ping` doc, the
test build's writes to `test_ping`. Same `firestore.rules` (already published
above) covers both, since they're just different documents in the same
database. Revisit real database-level isolation if the project ever moves to
Blaze — see `SPEC.md`'s Decisions Log for the tradeoff.

**Not independently installable to a phone home screen** — `docs/test/` has
no manifest/service-worker of its own (removed after testing showed Android
can't offer two separate installed icons when one path is nested under the
other; the web platform's install-scope matching is a strict prefix match
with no way to exclude a subpath). Access `/test/` via a browser bookmark/tab
instead. See `SPEC.md`'s Decisions Log for the full story and the rejected
alternative (a separate repo/sibling path, which would genuinely fix it but
costs a second repo to keep in sync).

## Admin bootstrap for `docs/test/` (iteration 3, `0.3.0-t01`)

`docs/test/` now logs in via a `usernames/{username}` → `users/{uid}` lookup
instead of the old fixed formula, and role/admin access is gated by a `role`
field on `users/{uid}`. No admin exists yet the first time, so the first
admin account has to be created by hand, once, directly in the Firebase
Console (the app can't do this itself — role-editing is admin-gated, and
there's no admin yet to grant it):

1. **Find your existing account's UID** — Authentication → Users → find the
   account you've been testing with (e.g. `matanya@smart-lab.internal`) →
   copy its **User UID** column value.
2. **Create its Firestore profile** — Firestore Database → Data → start a
   new document:
   - Collection: `users`, **Document ID: paste the UID from step 1** (not
     auto-generated).
   - Fields: `username` (string, e.g. `matanya`), `role` (string, `admin`),
     `verifier` (boolean, `false`), `status` (string, `active`).
3. **Create the username lookup doc** — same Data tab, new document:
   - Collection: `usernames`, **Document ID: the username itself** (e.g.
     `matanya`, not the UID).
   - Fields: `authEmail` (string, the full synthetic email from step 1, e.g.
     `matanya@smart-lab.internal`).
4. Log into `docs/test/` with that username + its existing password — the
   admin screen should now appear. From there, every other account (client,
   team_leader, worker) can be added through the app itself; this manual
   step is only ever needed once, for the first admin.

## Hosting

Push to GitHub and enable **Settings → Pages** (source: branch `main`, `/docs`
folder). Live URLs: `https://matanyaa.github.io/smart-lab/` (launched) and
`https://matanyaa.github.io/smart-lab/test/` (testing build).

## Updating

Bump `APP_VERSION` in `docs/index.html` (launched) or `docs/test/index.html`
(testing) on every deployed change to that build.
