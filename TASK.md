# TASK.md — smart-lab

**Task:** Automate Firestore security-rules deployment via GitHub Actions
**App version affected:** none — this is repo tooling only, no changes to `docs/` or `docs/test/`, no `APP_VERSION` bump.
**Task drafted:** 2026-09-18

## Why
Firestore rules live at `setup/firestore.rules`, but the repo copy only takes effect once someone manually pastes it into the Firebase Console's Rules tab — and that step has already been missed at least once this project (see `SPEC.md`'s Decisions Log: the dead `ping`/`test_ping` rule cleanup needed a manual re-publish after the fact). This task replaces that manual step with an automatic deploy: whenever `setup/firestore.rules` changes on the branch GitHub Pages actually deploys from, GitHub Actions pushes it straight to Firebase.

## What to build

1. **`setup/firebase.json`** — a minimal Firebase CLI config, scoped to Firestore rules only:
   ```json
   {
     "firestore": {
       "rules": "firestore.rules"
     }
   }
   ```
   The `rules` path is relative to this file's own folder, so it resolves to `setup/firestore.rules`. Putting it here (not at repo root) keeps the root clean per `CLAUDE.md`'s "Repo layout" — the workflow points the Firebase CLI at it explicitly with `--config setup/firebase.json`.

2. **No `.firebaserc`.** Pass the project ID directly on the deploy command instead (see the workflow below) — one less file, and no root-level config needed. Get the *real* project ID from the Firebase config object already embedded in the app (in `docs/js/firebase-init.js` after the Iteration 3 modularization — read the actual file to find `projectId`, don't guess or ask the user for it).

3. **`.github/workflows/deploy-firestore-rules.yml`** — triggers only when `setup/firestore.rules` changes, on the real branch GitHub Pages deploys from (confirm the actual default/deploy branch name in this repo — likely `main`, but check rather than assume):
   ```yaml
   name: Deploy Firestore Rules

   on:
     push:
       branches: [main]
       paths:
         - 'setup/firestore.rules'

   jobs:
     deploy-rules:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - name: Write service account credentials
           env:
             FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
           run: echo "$FIREBASE_SERVICE_ACCOUNT" > "$RUNNER_TEMP/gcp-key.json"

         - name: Deploy Firestore rules
           env:
             GOOGLE_APPLICATION_CREDENTIALS: ${{ runner.temp }}/gcp-key.json
           run: npx firebase-tools@latest deploy --only firestore:rules --project <REAL_PROJECT_ID> --config setup/firebase.json --non-interactive
   ```
   Replace `<REAL_PROJECT_ID>` with the value found in step 2, and adjust `branches: [main]` if the real deploy branch differs.

   The "write the secret to a temp file, then point `GOOGLE_APPLICATION_CREDENTIALS` at it" pattern is deliberate — passing the service-account JSON directly as a CLI argument breaks on its embedded newlines/quotes.

4. **Manual test after building**: push a trivial, safe whitespace-only change to `setup/firestore.rules` on the deploy branch (or open a PR and merge it) and confirm in the repo's Actions tab that the workflow runs. Two possible good outcomes: it succeeds (then also confirm in the Firebase Console's Rules tab that the content/timestamp updated), or it fails specifically at the deploy step with an authentication error because the `FIREBASE_SERVICE_ACCOUNT` secret isn't set up yet (see below) — that's expected, not a bug in the workflow, if the user hasn't done their manual step yet. Report whichever actually happened in `HANDOFF.md`.

## One manual step — not yours, already the user's job
This task assumes a GitHub repository secret named `FIREBASE_SERVICE_ACCOUNT` will exist, containing a Firebase service-account JSON key with Firestore rules-deploy permission. If your test run fails with an auth error because it's missing, that's expected — log it in `HANDOFF.md` and move on; there's nothing to work around, since creating that secret can only happen in the Firebase/GitHub consoles, by the user, outside this repo.

## Deviations / open questions
If the real Firebase project ID can't be found anywhere in the repo (shouldn't happen — the app needs it to run at all) or the deploy branch isn't `main`, log it in `HANDOFF.md` and use your best judgment rather than blocking — this is a low-risk, easily-reverted tooling change, not a schema/data-model decision.

## Definition of done
- `setup/firebase.json` exists and correctly scopes to `setup/firestore.rules`.
- `.github/workflows/deploy-firestore-rules.yml` exists, triggers only on pushes touching `setup/firestore.rules` on the real deploy branch, and uses the real project ID.
- The end-to-end test in step 4 has actually been run (not just reasoned about), and its real outcome is reported in `HANDOFF.md`.
- No changes to `docs/`, `docs/test/`, or `APP_VERSION` — this task touches only repo tooling.

## When done
Write your completion note to `HANDOFF.md` as usual: what you built, the real project ID and branch name used, and the outcome of the end-to-end test.
