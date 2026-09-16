# App Build Standards

Single source of truth for building personal apps/tools via the `build-new-app` skill. Override anything below when a specific app genuinely calls for it — this is a default, not a rule.

## Modes
- **Real-use mode (default):** the app is built to actually use. Standard spec → setup → build flow, no special pacing.
- **Learning mode:** toggled on when the app's stated purpose signals the point is to learn/practice by building it (or the user says so explicitly) — otherwise real-use mode is the default. When active:
  - Once the spec is written, lay out the full multi-stage learning curriculum upfront (don't dole it out one task at a time)
  - Let the user drive each stage hands-on rather than doing the step for them
  - Everything else (stack, workflow, auth, setup checklist) is the same as real-use mode — the curriculum uses the same defaults as the vehicle

## Spec phase
- Starts from one question: what's the core purpose — what problem does this solve?
- From there, the rest is worked out conversationally — no fixed checklist, since the right questions depend on the app. Typically needs settling:
  - Who uses it — just the user, or others too
  - Where it needs to work — phone, desktop, both
  - The core data model — what gets tracked/created, how it's entered/logged
  - Real login vs. anonymous/no-auth
  - File/code structure, if the app looks like it'll grow large (see Default stack)
  - Any existing app/repo whose conventions should carry over
- A user-supplied spec can replace this phase entirely — don't re-derive from scratch if one's handed over, but still confirm which mode applies
- Output: a spec doc saved in the app-builder project at `specs/<app-name>.md`
- No app code gets written during this phase

## Pre-build setup checklist
Once a spec is confirmed and before any code gets written, walk through (or confirm already done) whatever of these the spec actually needs:

1. **GitHub repo** — create an empty repo at github.com/new, named for the app, under github.com/Matanyaa (no README/gitignore needed)
2. **GitHub Pages** — enable Pages for the repo once it has at least one commit (Settings → Pages → deploy from branch)
3. **Firebase project** — create one at console.firebase.google.com (or confirm reusing an existing one, if that's ever appropriate)
4. **Firestore** — enable it in Native mode, pick a region
5. **Firebase Auth** (only if the spec calls for real login) — enable the needed sign-in providers (email/password and/or Google)
6. **Web app config** — register a web app inside the Firebase project to get the config snippet (apiKey, projectId, etc.) — needs to be pasted back in so it can go into the code
7. **Firestore security rules** — written during the build itself, scoped to the authenticated user; nothing to pre-do here beyond Auth being enabled first

## After first deploy
- Include a basic web app manifest (name, icons, `start_url`, `display: standalone`) in the build so the app can be added to a phone home screen as a real shortcut, not just a browser bookmark
- Once GitHub Pages is live for the first time, output the live URL (`https://matanyaa.github.io/<app-name>/`) so the user can open it and add it to their home screen

## Default stack
- **Frontend:** start with a single `index.html` (HTML/CSS/JS). Once it starts feeling unwieldy, split into separate plain files (e.g. `app.js`, `styles.css`) loaded directly or via ES modules — still no build step. If it outgrows that too, a lightweight bundler (e.g. Vite) is an acceptable next step — not the default starting point, but not off the table either.
- **Backend/persistence:** Firebase / Firestore
- **Hosting:** GitHub Pages, one new GitHub repo per app — `github.com/Matanyaa/<app-name>`
- **Deploy:** push to the Pages branch and it auto-deploys. If a bundler is introduced, the build output needs to be what actually gets deployed (adjust the deploy step accordingly rather than assuming this still applies unchanged).

## Dev workflow with Claude Code
- Build locally with Claude Code; commit and push after each working version/change (not batched at the end)
- Don't silently auto-refresh the live app on a new deploy — use an "update available, refresh?" prompt pattern instead

## Auth & security
- Personal data, or needs to work from phone as well as desktop → real Firebase Auth (email/password or Google sign-in), Firestore rules scoped to the authenticated user's own data
- Sandbox / learning / throwaway app → anonymous auth is fine
- Never leave Firestore rules open — always scope to the authenticated user

## Repo naming
`github.com/Matanyaa/<short-descriptive-name>`, matching the app's purpose.

---
*Update this doc directly (or through Claude) whenever a default changes or a new pattern emerges.*
