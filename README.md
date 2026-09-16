# Smart Lab

Personal web app for managing failure-analysis / metallurgical inspection lab
work. See `SPEC.md` for the full design and `TASK.md` for what's currently
being built (`CLAUDE.md` explains the three-file workflow).

**Current iteration (`0.1.0-t01`):** infra skeleton only — login, a Firestore
write/read round-trip, version display, home-screen install. No case data yet.

## Firebase setup (required before this app works)

`index.html` already has the project's `firebaseConfig` wired in
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
   `firestore.rules` from this repo → Publish. (Scopes all reads/writes to
   signed-in users only; role-based rules come in a later iteration.)

## Hosting

Push to GitHub and enable **Settings → Pages** (source: branch `main`, root
folder). Live URL: `https://matanyaa.github.io/smart-lab/`.

## Updating

Bump `APP_VERSION` in `index.html` on every deployed change.
