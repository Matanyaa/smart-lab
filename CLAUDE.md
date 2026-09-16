# CLAUDE.md — smart-lab

Project context for Claude Code. Read this first, then `SPEC.md` for full design detail.

## What this is
A personal web app for managing failure-analysis / metallurgical inspection lab work: tracking cases (and their samples) through a workflow, logging measurements/actions, giving clients visibility into progress, collecting client reviews after closure, and producing a report section (docx) for insertion into the official report authored elsewhere. Full detail in `SPEC.md`.

## Mode
Real-use mode — this is a tool meant for actual daily work, not a learning exercise. Build for reliability and a clean UX from the start; no special teaching pacing needed.

## How this project is being run
Three files, three jobs — this is the handoff protocol between the design session (a separate Claude Cowork session) and you (Claude Code, doing the actual build):
- **CLAUDE.md** (this file) — stable context and conventions. Changes rarely.
- **SPEC.md** — the full living design. Reference material; changes only when the design session settles something new. Has a "Decisions Log" at the bottom.
- **TASK.md** — the *only* file that changes every round. A short, bounded instruction for exactly what to build right now. **Always read TASK.md before starting work** — it's the current scope, not the whole of SPEC.md. Don't build ahead of what TASK.md asks for, even if SPEC.md describes more.

The loop:
1. The design session writes the next TASK.md.
2. The user pulls it into this repo and points you at it.
3. You build exactly that slice, working directly in this repo.
4. When done, leave a short note at the bottom of TASK.md describing what you actually did (especially any deviation from the instruction), and log any real design/architecture decisions you made (schema shape, library choice, structure change) as a dated entry in SPEC.md's Decisions Log — don't silently rewrite existing SPEC.md sections.
5. The user tests, then relays results back to the design session, which writes the next TASK.md.

Build incrementally regardless — even within one TASK.md, prefer a piece that can be tested before adding the next. If you hit an open question in SPEC.md that blocks you, don't guess silently on anything user-facing (data model shape, auth model, client-access model, etc.) — leave a note in TASK.md and ask, since the user is relaying between you and the design session.

## Trigger phrase
When the user says **"execute"** (or something clearly equivalent, like "go" or "build it"), that means: read `TASK.md` (re-read it even if you've seen an earlier draft — it may have been revised; check its "Task drafted/updated" timestamp against what you last saw) and build exactly what it specifies. Don't ask for scope confirmation — TASK.md *is* the scope. Only stop and ask if TASK.md itself is unclear, blocked (e.g. missing config), or you hit a genuine open question per the paragraph above.

When the user says **"task complete"**, that means: the current TASK.md's work is done and about to be relayed back to the design session. Update TASK.md's completion note (below the `---` at the bottom) to reflect final state, and make sure it states the current app version (the live `APP_VERSION` value, not just the version TASK.md was originally targeting — they can differ if the build needed extra `-tNN` passes).

## File versioning (so everyone can tell what's current)
- **TASK.md** carries a header with the app version it's building toward plus a "drafted/updated" date-time — since the task itself might get revised a few times before you ever see it, the timestamp is how you and the user confirm you're both looking at the current draft.
- **SPEC.md** carries its own version tag in the format `sJ.M.P` (the leading `s` distinguishes it from the app's own version number) — see its "Spec versioning" section for what J/M/P mean. You don't need to maintain this; the design session does.

## Stack & conventions (from personal App Build Standards)
- **Frontend:** start with a single `index.html` (HTML/CSS/JS), no build step. Split into separate files only once `index.html` gets unwieldy; a bundler (e.g. Vite) is fine later if needed, not the starting point.
- **Backend/persistence:** Firebase / Firestore (Native mode).
- **Hosting:** GitHub Pages, this repo — `github.com/Matanyaa/smart-lab`.
- **Deploy:** push to the Pages branch, auto-deploys. Don't auto-refresh the live app silently on a new deploy — use an "update available, refresh?" prompt instead.
- **Auth:** Firebase Auth's email/password provider, but users log in with a **username**, not a real email — the app maps each username to a synthetic email under the hood (e.g. `username@smart-lab.internal`) before calling Firebase's sign-in. No real personal emails are stored for anyone, including the app owner's own account (see `SPEC.md`'s Authentication section for why, and how password resets work without them). Firestore rules must always be scoped appropriately — never left fully open.
- Commit and push after each working version/change, not batched at the end.
- Include a basic web app manifest (name, icons, `start_url`, `display: standalone`) so it can be added to a phone home screen.
- **Versioning:** MAJOR.MINOR.PATCH starting at `0.1.0`. Bump minor (reset patch) once a feature is done and launched; bump patch for a fix to something already launched; major is TBD (likely `1.0.0` = real day-to-day use). While a version is still being worked on, it carries a `-tNN` suffix (two-digit, e.g. `0.3.0-t01`, `0.3.0-t02`...), dropped once it launches. Display the version near the **top** of the app, not a footer. It also powers the "update available, refresh?" pattern above — see `SPEC.md`'s Versioning and Environments sections for detail.
- **Environments:** the launched app lives at the repo root; a working/testing build lives in a `/test/` subfolder of the same repo (same GitHub Pages deployment, no branches needed) so colleagues/clients keep seeing the last launched version while testing continues separately. Data is separated via a second Firestore named database (`test`) in the same Firebase project — the launched build uses `(default)`, the `/test/` build uses `test` — rather than a naming-convention prefix, since that's more failure-prone. This split is a near-term follow-up task, not part of the first infra iteration (see `TASK.md`).

## Pre-build setup checklist (user does this manually)
1. GitHub repo — `github.com/Matanyaa/smart-lab` (empty, no README/gitignore)
2. Enable GitHub Pages once there's a first commit (Settings → Pages → deploy from branch)
3. Firebase project (new, or confirm reuse of an existing one)
4. Firestore enabled, Native mode, pick a region
5. Firebase Auth enabled — email/password provider (used with synthetic emails, not real ones — see Auth above)
6. Register a web app in Firebase to get the config snippet (apiKey, projectId, etc.) and paste it into the code
7. Firestore security rules — written during the build, scoped to the authenticated user

See `SPEC.md` for the full design and open questions, and `TASK.md` for what to build right now.
