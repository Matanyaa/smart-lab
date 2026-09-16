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

## Hosting

Push to GitHub and enable **Settings → Pages** (source: branch `main`, `/docs`
folder). Live URL: `https://matanyaa.github.io/smart-lab/`.

## Updating

Bump `APP_VERSION` in `docs/index.html` on every deployed change.
