# CLAUDE.md — smart-lab

Project context for Claude Code. Read this first, then `SPEC.md` for full design detail.

## What this is
A personal web app for managing failure-analysis / metallurgical inspection lab work: tracking cases (and their samples) through a workflow, logging measurements/actions, giving clients visibility into progress, collecting client reviews after closure, and producing a report section (docx) for insertion into the official report authored elsewhere. Full detail in `SPEC.md`.

## Mode
Real-use mode — this is a tool meant for actual daily work, not a learning exercise. Build for reliability and a clean UX from the start; no special teaching pacing needed.

## How this project is being run
Four files, and one hard rule: **you only ever read `CLAUDE.md`, `SPEC.md`, and `TASK.md` — never write to them.** The design session (a separate Claude Cowork session) is their only writer. This isn't a style preference — two independent writers saving the same file caused real, silent data loss earlier in this project (a section of this file, a chunk of `TASK.md`, and later several of `SPEC.md`'s own Decisions Log entries and part of its Roles section all reverted at different points, because whichever side saved last — working from a copy that didn't yet include the other side's edit — overwrote it without either side doing anything wrong). Splitting reads from writes per file removes the collision entirely rather than trying to avoid it through care.

- **CLAUDE.md** (this file) — stable context and conventions. You read it; only the design session writes it.
- **SPEC.md** — the full living design, including its "Decisions Log." You read it; only the design session writes it.
- **TASK.md** — the current bounded build instruction — exactly what to build right now, not the whole of SPEC.md. You read it; only the design session writes it. **Always read TASK.md before starting work**, and don't build ahead of what it asks for even if SPEC.md describes more.
- **HANDOFF.md** — the *only* file you write to, and you're its *only* writer, permanently — the design session only ever reads it, never writes to it (even to clear old entries), so this file doesn't reopen the same collision from the other direction. Whenever you finish a task, or hit a blocker/open question mid-build, **append** an entry: what you built, any deviation from TASK.md or SPEC.md, any real design/architecture decision you made along the way (schema shape, library choice, structure change), any question or blocker, and the current app version reached. Never delete or rewrite earlier entries — just add yours, dated, at the end. This is the only channel back to the design session — nothing written anywhere else in this repo will be seen by it. If the file ever gets unwieldy, you (not the design session) can move older, already-referenced-in-SPEC.md entries into a dated archive file — still a single-writer operation either way.

The loop:
1. The design session writes the next TASK.md (and updates SPEC.md/CLAUDE.md too, if the design itself changed).
2. The user pulls it into this repo and points you at it.
3. You build exactly that slice, working directly in this repo.
4. When done, write your completion note to `HANDOFF.md` — never edit `TASK.md`, `SPEC.md`, or this file yourself, even just to leave a note in context. Append your entry to `HANDOFF.md` rather than rewriting or deleting whatever's already in it.
5. The user relays this back; the design session reads `HANDOFF.md` (never writes to it — it tells what's new by the dated entries, not by the file being empty), absorbs anything durable into `SPEC.md`, and writes the next `TASK.md`.

Build incrementally regardless — even within one TASK.md, prefer a piece that can be tested before adding the next. If you hit an open question in SPEC.md that blocks you, don't guess silently on anything user-facing (data model shape, auth model, client-access model, etc.) — log it in `HANDOFF.md` and stop, since the user is relaying between you and the design session.

## Trigger phrase
When the user says **"execute"** (or something clearly equivalent, like "go" or "build it"), that means: read `TASK.md` (re-read it even if you've seen an earlier draft — it may have been revised; check its "Task drafted/updated" timestamp against what you last saw) and build exactly what it specifies. Don't ask for scope confirmation — TASK.md *is* the scope. Only stop and ask if TASK.md itself is unclear, blocked (e.g. missing config), or you hit a genuine open question per the paragraph above.

When the user says **"task complete"**, that means: the current TASK.md's work is done and about to be relayed back to the design session. Write your completion note to `HANDOFF.md` (never to `TASK.md`) reflecting final state, and make sure it states the current app version (the live `APP_VERSION` value, not just the version TASK.md was originally targeting — they can differ if the build needed extra `-tNN` passes on `docs/test/`).

## File versioning (so everyone can tell what's current)
- **TASK.md** carries a header with the app version it's building toward plus a "drafted/updated" date-time — since the task itself might get revised a few times before you ever see it, the timestamp is how you and the user confirm you're both looking at the current draft.
- **SPEC.md** carries its own version tag in the format `sJ.M.P` (the leading `s` distinguishes it from the app's own version number) — see its "Spec versioning" section for what J/M/P mean. You don't need to maintain this; the design session does.

## Stack & conventions (from personal App Build Standards)
- **Frontend:** start with a single `index.html` (HTML/CSS/JS), no build step. Split into separate files only once `index.html` gets unwieldy; a bundler (e.g. Vite) is fine later if needed, not the starting point.
- **Backend/persistence:** Firebase / Firestore (Native mode).
- **Hosting:** GitHub Pages, this repo — `github.com/Matanyaa/smart-lab`, served from the `/docs` folder (not repo root — see "Repo layout" below).
- **Deploy:** push to the Pages branch, auto-deploys. Don't auto-refresh the live app silently on a new deploy — use an "update available, refresh?" prompt instead.
- **Auth:** Firebase Auth's email/password provider, but users log in with a **username**, not a real email — the app maps each username to a synthetic email under the hood (e.g. `username@smart-lab.internal`) before calling Firebase's sign-in. No real personal emails are stored for anyone, including the app owner's own account (see `SPEC.md`'s Authentication section for why, and how password resets work without them). Firestore rules must always be scoped appropriately — never left fully open.
- Commit and push after each working version/change, not batched at the end.
- Include a basic web app manifest (name, icons, `start_url`, `display: standalone`) so it can be added to a phone home screen.
- **Versioning:** MAJOR.MINOR.PATCH starting at `0.1.0`. Bump minor (reset patch) once a feature is done and launched; bump patch for a fix to something already launched; major is TBD (likely `1.0.0` = real day-to-day use). Display the version near the **top** of the app, not a footer. It also powers the "update available, refresh?" pattern above — see `SPEC.md`'s Versioning and Environments sections for detail.
- **User-facing changelog (added 2026-09-17):** separate from everything above — this is for whoever actually uses the app, not for you or the design session. Whenever a task changes something a user would notice, add a short, plain-language entry (a version, a date, a couple of bullets) to the changelog list — do this as a standing habit alongside your `HANDOFF.md` note, not just when a TASK.md happens to mention it. Skip it for purely internal changes (refactors, rules cleanup) nobody using the app would care about. Full behavior (auto-popup on a new version, reopenable by clicking the version number) is spec'd wherever it was first built — see `SPEC.md`'s Decisions Log.
- **`-tNN` suffix is `docs/test/`-only (changed 2026-09-17):** while work is still being proven out on `docs/test/`, it carries a two-digit `-tNN` suffix (`0.3.0-t01`, `0.3.0-t02`...), dropped once that slice is done. **`docs/` (root/launched) never carries a `-tNN` suffix, even for a small change** — any edit made directly to `docs/` gets committed straight as a plain patch or minor bump. `docs/test/` is where things get proven out before ever touching root, so root doesn't need its own testing cycle on top of that.
- **Environments:** built in iteration 2. The launched app lives at `docs/` (the repo's GitHub Pages source, effectively the site root); a working/testing build lives in `docs/test/` (same GitHub Pages deployment, no branches needed) so colleagues/clients keep seeing the last launched version while testing continues separately. Data separation is a **collection-name prefix** (`docs/` writes `ping`, `docs/test/` writes `test_ping`, both in the shared `(default)` Firestore database) — the originally-planned second named database needs Firebase's paid Blaze plan, and this project is on the free Spark plan, so the prefix is the interim approach (revisit if the project ever moves to Blaze). `docs/test/` is **not** separately installable to a phone home screen — Android can't offer two independent install icons when one URL path is nested under the other (a strict web-platform limitation, not fixable via manifest tweaks) — so it has no manifest/service-worker of its own and is accessed via browser bookmark/tab only. Full story in `SPEC.md`'s Decisions Log.
- **Never test against the launched app (added 2026-09-18):** `docs/` (root) holds real, in-use case data — never run manual/browser verification, create test accounts, seed sample data, or otherwise exercise the live UI against it. All hands-on testing and verification — including the kind of real browser-automation checks done in earlier iterations (creating accounts, reading/writing documents to confirm behavior) — happens against `docs/test/` only, since its `test_`-prefixed collections are exactly what makes that safe to touch. This holds even when a task doesn't touch `docs/` at all: verifying something that affects both environments (e.g. a Firestore rules change, since rules are shared across the one Firebase project) means a read-only check (Firebase Console, GitHub Actions log, a query run from a script/CLI you control) — never a live test performed through the root app's own UI. If a task genuinely can't be verified without touching root, stop and log it in `HANDOFF.md` instead of proceeding.

## Repo layout
Unlike this project's other personal apps (which just have `index.html` etc. loose at repo root), `smart-lab` keeps the top level clean for the CLAUDE/SPEC/TASK governance docs:
- **Repo root** — `CLAUDE.md`, `SPEC.md`, `TASK.md`, `HANDOFF.md`, `app-build-standards.md`. Nothing else.
- **`docs/`** — the actual app code (`index.html`, `manifest.json`, `icon.svg`, `sw.js`), and this is the GitHub Pages source folder (Settings → Pages → `/docs`), not documentation despite the name. `docs/test/` holds the working/testing build once it exists.
- **`setup/`** — project setup/reference material that isn't app code and isn't one of the three governance docs: `README.md`, `firestore.rules`.

## Pre-build setup checklist (user does this manually)
1. GitHub repo — `github.com/Matanyaa/smart-lab` (empty, no README/gitignore)
2. Enable GitHub Pages once there's a first commit (Settings → Pages → deploy from branch → `/docs` folder)
3. Firebase project (new, or confirm reuse of an existing one)
4. Firestore enabled, Native mode, pick a region
5. Firebase Auth enabled — email/password provider (used with synthetic emails, not real ones — see Auth above)
6. Register a web app in Firebase to get the config snippet (apiKey, projectId, etc.) and paste it into the code
7. Firestore security rules — written during the build, scoped to the authenticated user

See `SPEC.md` for the full design and open questions, and `TASK.md` for what to build right now.
