# TASK — Iteration 1: Infra skeleton

**Target app version:** `0.1.0-t01`
**Task drafted/updated:** 2026-09-17 00:08 IDT

Read `CLAUDE.md` first for the working conventions, then this file for what to build right now. Don't build anything from `SPEC.md` beyond what's listed here — this iteration only proves the basic infrastructure connects.

## Goal
A minimal deployed page that: logs in with username + password, does one Firestore write+read round-trip, shows the version number at the top, and can be added to a phone home screen. Nothing about cases, samples, or workflow yet.

## Prerequisites (already done by the user)
- GitHub repo created and pushed at least once.
- Firebase project created.
- Not yet necessarily done: Firestore enabled (Native mode), Auth email/password provider enabled, web app registered for the config snippet. If any of these are missing, ask the user rather than guessing.

## Scope for this iteration
1. Single `index.html` (HTML/CSS/JS, no build step). Load the Firebase SDK via CDN `<script>` tags — no bundler yet.
2. Wire in the Firebase config the user provides (from their Firebase project's web app registration). Ask for it if you don't have it — don't invent placeholder keys that look real.
3. Login screen: **username + password** fields (not "email"). Before calling Firebase's `signInWithEmailAndPassword`, map the username to a synthetic email: `${username}@smart-lab.internal`. No signup UI yet — the user will manually create the first test account in the Firebase Console (Authentication tab) using that same synthetic-email pattern.
4. After a successful login, show a minimal authenticated screen with:
   - App name + version number displayed near the **top** (e.g. "smart-lab v0.1.0") — not a footer.
   - A button that writes a small test document to Firestore (e.g. a `ping` doc with a timestamp) and then reads it back and displays it, proving the round-trip works both ways.
   - A logout button.
5. Add a basic web app manifest (name, a simple placeholder icon, `start_url`, `display: standalone`) linked from `index.html`, so it can be added to a phone home screen.
6. Firestore security rules: scope all reads/writes to signed-in users only, as a starting point (`request.auth != null`). Role-based rules come in a later iteration once the case data model exists.
7. Commit and push once it works.

## Explicitly NOT in scope for this iteration
- Case / sample / action data model — none of it yet.
- Admin UI / account management — still manual via Firebase Console for now.
- The "update available, refresh?" version-check logic — comes in a later iteration once there's a second deployed version to actually test against. For now, just display the hardcoded version constant.
- Client-facing view, shadow cases, reviews, reporting — all later.

## Versioning
Since this is still being worked on, use the testing suffix: start at `0.1.0-t01`, bumping to `-t02`, `-t03`, etc. if you need another pass within this iteration. Don't drop the suffix yet — this becomes plain `0.1.0` only once the user decides it's ready to consider "launched," which happens outside this task, not automatically.

Note: the dual-environment setup (a separate `/test/` build against a second Firestore database) is **not** part of this iteration — that's a near-term follow-up task. For now there's just one build, one `(default)` Firestore database, and the version display simply reflects that it's a testing build via the `-tNN` suffix.

## When done
- Add a short note below this line: what you built, any deviations from this instruction, any questions or blockers.
- Log any real decisions you made (exact Firestore rule syntax, manifest icon choice, file structure) as a dated entry in `SPEC.md`'s Decisions Log — don't just leave them here.

---

*(Claude Code: add your completion note below this line.)*

**Done — 2026-09-17.** Built `index.html`, `manifest.json`, `icon.svg`, `firestore.rules`, and a rewritten `README.md`, all at repo root, version `0.1.0-t01`.

- Login screen takes username + password, maps to `<username>@smart-lab.internal` before calling `signInWithEmailAndPassword`.
- Authenticated screen shows who's signed in, a "Test Firestore round-trip" button (writes `ping/latest` with a `serverTimestamp()`, reads it back, displays the JSON), and a logout button.
- Version badge (`v0.1.0-t01`) shown in a top header bar, visible on both the login and authenticated screens.
- Manifest + SVG icon wired in for home-screen install.
- `firestore.rules` scopes all reads/writes to `request.auth != null`, as specified — not yet applied in the Firebase Console (see blocker below).
- No "update available" logic, per the explicit exclusion — will land once there's a second deployed version to test against.

**Update 2026-09-17:** Firebase web app config received and wired into `index.html` (project `smart-lab-abd80`). Still unconfirmed whether Firestore (Native mode), the Auth email/password provider, and a first test account (Authentication → Users, synthetic-email pattern) exist yet, and whether `firestore.rules` has been published via the Console's Rules tab — see README's "Firebase setup" section for the remaining checklist. Not committed/pushed yet per repo convention (commit after it *works*) — will do once you confirm those and the round-trip test passes.

**Task complete — 2026-09-17. Current app version: `0.1.0-t05`.**

Firebase setup was confirmed done by the user; first commit made (required setting a one-time local git identity — new machine, no global `.gitconfig` yet, since resolved with a global default too), pushed to `github.com/Matanyaa/smart-lab` on `main`, and GitHub Pages enabled. Live at `https://matanyaa.github.io/smart-lab/`. Login + Firestore round-trip confirmed working on both desktop and phone (Android).

Deviations from the original scope, added mid-iteration at the user's request rather than waiting for a follow-up TASK.md:
- Added a minimal no-op `sw.js` service worker (`t01` → no SW at first; added after `t01` testing showed Android Chrome wasn't offering the home-screen install option — a registered service worker turned out to be part of what's needed there, separate from the manifest itself being valid).
- Added the "update available, refresh?" banner (explicitly deferred in the original TASK.md scope) once `0.1.0-t02` gave a second deployed version to actually test it against. Matches the existing `calorie-tracker`/`split-builder` pattern: checks on load and on `visibilitychange` (tab foregrounded), not on a timer — a `setInterval` poll was tried and deliberately reverted, since a tab left open and untouched not re-checking was judged acceptable rather than worth the added complexity/battery cost.

Versions `t02`–`t04` were intermediate passes exercising the above (`t04` briefly included the interval poll, reverted in `t05`). No open blockers. Next: a follow-up TASK.md from the design session for the actual case/sample/action data model.
