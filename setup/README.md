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
   `firestore.rules` (this folder) → Publish. (Scopes all reads/writes to
   signed-in users only; role-based rules come in a later iteration.)

## Test environment setup (`docs/test/`, required before it works)

`docs/test/` is a second, isolated build — same Auth users, separate Firestore
data — so testing never touches real data. It needs a second named database:

1. **Create the `test` database** — Firebase Console → Build → Firestore
   Database → the database-name dropdown near the top (next to `(default)`) →
   **Add database** (or "+ Create database") → name it exactly `test` →
   **Native mode** → same region as `(default)` is fine. (If your Console
   doesn't show that option, it can also be done via the `gcloud` CLI:
   `gcloud firestore databases create --database=test --location=<region> --type=firestore-native`
   — needs the Google Cloud SDK installed and authenticated against the
   `smart-lab-abd80` project.)
2. **Publish rules to it too** — Firestore Database → Rules → use the same
   database-name dropdown to switch to `test` → paste in `firestore.rules`
   (same contents as `(default)`'s) → Publish. Rules are per-database, so this
   is a separate step from setting up `(default)`'s rules above.
3. **Verify the split holds** — log into `docs/test/`'s URL, run "Test
   Firestore round-trip" there, then check the Console: the `ping/latest` doc
   should show up under the `test` database's data browser, not `(default)`'s.

## Hosting

Push to GitHub and enable **Settings → Pages** (source: branch `main`, `/docs`
folder). Live URLs: `https://matanyaa.github.io/smart-lab/` (launched) and
`https://matanyaa.github.io/smart-lab/test/` (testing build).

## Updating

Bump `APP_VERSION` in `docs/index.html` (launched) or `docs/test/index.html`
(testing) on every deployed change to that build.
