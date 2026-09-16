# SPEC — smart-lab

**Spec version:** `s0.1.0` (see "Spec versioning" below for what this means)
Living design spec, updated collaboratively across the Cowork design session and Claude Code builds.
Last updated: 2026-09-17 00:08 IDT.

## Purpose
Help manage lab work: tracking cases and their samples through a workflow, logging measurements and actions, giving clients visibility into progress, collecting client reviews after closure, and producing a report section (docx) that gets inserted into the official report authored elsewhere.

Built for real day-to-day lab work (real-use mode, not a learning project). Terminology note: the top-level unit of work is called a **Case** (not "job").

## Spec versioning
This document has its own version, separate from the app's version (see the app's "Versioning" section below) — format `sJ.M.P`, the leading `s` marking it as the *spec's* version so it's never confused with the app's own `MAJOR.MINOR.PATCH`.
- **J** (major) — bumped for a major overhaul of the design itself (e.g. a fundamental restructuring, not just new detail).
- **M** (minor) — bumped when a new feature area gets finalized through discussion (goes from open/undecided to settled).
- **P** — bumped for each discussion-driven edit to this document that isn't a J or M bump (i.e. the default increment for routine updates).
- Baseline `s0.1.0` set 2026-09-17, reflecting everything settled up to that point without retroactively reconstructing a precise edit-by-edit history; counting forward starts from here.

## Environment
- **Open network** (regular internet, reachable from phone) — this is where this app lives. It tracks in-progress cases, their workflow/status, gives clients visibility, and offers some utilities (TBD).
- **Closed network** (separate, no internet) — used for writing the final official report and long-term documentation/archival. Out of scope for this app; no integration attempted. This app produces a docx section formatted so it can be inserted into that closed-network report, since there's an existing way to bring docx content in.
- **Dev workflow**: built on the open network using Claude Code, pushed to GitHub, deployed via GitHub Pages + Firebase (per App Build Standards). Not affected by the closed-network constraint since this app never needs to run there.
- **Core scoping principle**: this app tracks *cases in progress*. It is explicitly not a long-term archive — see "Archiving" below.

## Roles
- **Team leader** — currently the only role that can open a new case. Assigns a case manager to the case, defines the case's workflow (from a maintained catalog/skeleton of actions, plus custom actions), defines the archiving workflow (steps to run after the report is published), and signs off final archiving (which deletes the case).
- **Case manager** — assigned to a case by the team leader. Runs the workflow day-to-day: assigns individual actions to operators.
- **Operator** — executes actions. Every action gets at minimum a date + operator name; actions that need more (e.g. measurements) get the actual recorded values, stored in this app.
- **Verifier** — a role certain people hold (not assigned per-action by name). Some actions require sign-off from any verifier in addition to the operator's execution.
- **Client** — participates in the initiation meeting (with case manager + team leader) that precedes a case being opened. While the case is in progress, sees status only (stage name, per sample — see "Client-facing view"). After closure, gets a review request. Represents whoever attends from the client's side (could be multiple people; treated as one entity for now).
- **Admin** — confirmed role. Can add users, delete users, change a user's status (e.g. active/disabled), and change a user's password. May also get elevated access for review anonymity — still deferred.
- *(Dev — you, building the app. Not a workflow participant, not necessarily an in-app role.)*

## Authentication
- All in-app accounts (team leader, case manager, operator, verifier) use **synthetic/fake emails** under the hood (e.g. `username@smart-lab.internal`) paired with a password — the login UI just asks for username + password. No real personal emails are stored for anyone, including the app owner's own account, to avoid exposing real addresses.
- Because fake emails can't receive real reset links, there's no self-service "forgot password" flow. Instead, **Admin** manages accounts directly: add users, delete users, change a user's status, and change a user's password. Managing another user's Firebase Auth account (creating, deleting, changing password) isn't possible from client-side code alone — it needs the Firebase Admin SDK, implying a small Cloud Function behind the Admin UI. Build note: this needs Firebase's Blaze (pay-as-you-go) plan to enable Cloud Functions, though usage at this scale should stay within the free tier.
- As an ultimate fallback (e.g. before the Admin UI exists), the app owner can still do all of the above manually via the **Firebase Console** using their own Google account — a separate system from the app's in-app accounts with its own independent recovery, so this path can never get locked out by anything happening inside the app.

## Case lifecycle
1. **Initiation meeting** — client + case manager + team leader discuss the case.
2. **Case opened** (stage: `new`) — team leader opens the case, assigns a case manager, defines the workflow (actions needed, drawn from a catalog/skeleton with room for custom additions) and the archiving workflow (post-report steps). Workflow is mostly shared across all samples in the case, but the team leader can add extra actions scoped to a specific sample.
3. **Workflow execution** (stage: `in lab`, tracked **per sample**) — case manager assigns actions to operators. Sub-stages per sample, in typical order: sample preparation → pre-etch → post-etch. Some actions require a verifier's sign-off in addition to the operator's.
4. **Research** (stage: `research`, tracked **per sample**) — happens once a sample's lab work is done. Shape not yet decided (could be checklist, workflow, or notes).
5. **In writing** (case-level, once all samples have finished lab + research) — the official report is authored (on the closed network); this app exports a docx section to be inserted into it.
6. **Closed** (case-level) — report has been published to the client. Client receives a review request (ranking questions 1-5 plus a free-text area — exact questions TBD). Client can decline (removes the request) or choose to review later (closes the prompt without removing the link, so they can still complete it). Aside from the review prompt, the case becomes invisible to the client from this point on.
7. **Ready to archive** (case-level) — the archiving workflow (defined back in step 2) is executed.
8. **Archived** (case-level) — team leader signs off. **The case is completely deleted from the app** — this is real deletion, not a soft archive, since the app's job is only to track cases in progress and the authoritative long-term record lives in the closed-network report. If a review was submitted, it is retained independently of the case record (so it survives the case's deletion).

Note: this is the *typical* path and order — real cases can deviate as they evolve, so the stage model shouldn't be a rigid fixed state machine.

## Case / Sample / Action model
- A case can have multiple samples. Some stages are tracked **per sample** (`in lab` and its sub-stages, `research`); others are **case-level milestones** that apply once all samples have finished their individual work (`new`, `in writing`, `closed`, `ready to archive`, `archived`).
- **Workflow** = the set of actions needed for a case. Drawn from a maintained catalog/skeleton, with support for fully custom actions. Applied by default to every sample in the case; the team leader can add sample-specific extra actions on top.
- **Archiving workflow** = a separate action list, defined by the team leader when the case is opened, executed after the report is published (step 7 above).
- **Action** — minimally requires date + operator name once done. Some actions require additional documentation (e.g. measurement values), which **are stored in this app** (this supersedes an earlier assumption that only lighter/status-level data would live here — actual values are in scope). Some actions additionally require a verifier's sign-off.
- Known Case-level fields so far: client name, start date (when the case is opened / enters `new`), expected timeline date (a target/estimated completion date, set by the team leader alongside the workflow at case-open). Full field list still TBD (see Open Questions).

## Client-facing view (current scope)
- **Single shared public link, no login and no per-client ID/code at all.** Anyone with the link can view it — security is intentionally lightweight here per the owner's preference.
- **Default view**: lists every currently open case's status — stage name, per sample — filterable by client name (a field stored on each case).
- **Lean view** (toggle, off by default): a condensed per-case listing showing status, start date, day count (days elapsed since start, derived), and expected timeline date. Aimed mainly at a client-side "team leader" contact who wants a quick overview, but reachable by anyone via the toggle — no separate access tier enforced.
- **Shadow cases toggle** (nested inside lean view only, off by default): reveals shadow cases (see below) alongside real cases. Also not access-gated — just an extra step to find.
- After a case closes, it drops out of this view entirely for the client; only a pending review request surfaces separately (see Reviews).

## Shadow cases
- Represents a case that's expected to start soon but hasn't formally opened yet — a heads-up placeholder, not a full case.
- No case number. May carry an internal-only identifier not shown to any user.
- Holds mostly free notes; rarely needs more structure than that.
- Visible to the lab's team leader, and to clients only via the lean-view shadow toggle (see above).
- Later "evolves into" a real case once it's ready to formally open — exact mechanics (same record promoted into a Case vs. a new Case created separately and the shadow entry cleared) still open, see Open Questions.

## Versioning
- Format: **MAJOR.MINOR.PATCH**, starting at `0.1.0`.
- **Patch** bumps for a fix to something already launched (e.g. `0.2.0` → `0.2.1`).
- **Minor** bumps once a feature is considered done and launched for real use; patch resets to 0 (e.g. `0.1.3` → `0.2.0`).
- **Major** has no concrete trigger yet beyond the semver default: `1.0.0` marks the app going into real day-to-day use for actual cases (replacing whatever's used today); later majors would mark something similarly big (a major re-architecture, a new module) — to be decided when it comes up.
- **Testing suffix**: while a version is still being worked on and hasn't launched yet, it carries a `-tNN` suffix (two digits, zero-padded), e.g. `0.3.0-t01`, `0.3.0-t02`, `0.3.0-t03`... Once satisfied, it launches as the plain version with the suffix dropped (`0.3.0`). This applies the same way to a bug fix: `0.2.1-t01` for a quick check, then `0.2.1` once confident. The base number (minor vs. patch) says *what kind* of change it is; the `-tNN` suffix says *whether it's live yet*.
- Displayed at the **top** of the app (e.g. near the header/app name), not in a footer — makes it easy to confirm which build loaded during active testing.
- Doubles as the mechanism for the "update available, refresh?" pattern from the App Build Standards: the running app's version is compared against the deployed version, and a mismatch triggers the prompt rather than a silent reload. (The comparison logic itself is a later iteration, once there's a second deployed version to test against — the first iteration just displays the hardcoded version.)

## Environments (testing vs. launched)
The owner wants to keep working on a testing build while colleagues/clients continue seeing the last launched version, rather than everyone seeing every in-progress change immediately.
- **Two live URLs from the same repo, no branches or build step needed**: the launched app lives at the repo root (what colleagues/clients use); the working/testing build lives in a `/test/` subfolder of the same repo, served by the same GitHub Pages deployment. "Launching" a tested version means copying `/test/`'s files up to the root and dropping the `-tNN` suffix from the version string.
- **Data separation, same Firebase project**: rather than a naming convention (which risks a missed prefix silently writing test data into production), use Firestore's **multiple databases** feature — a second named database (e.g. `test`) alongside the `(default)` one, both inside the same Firebase project. The launched build connects to `(default)`; the `/test/` build connects to the named `test` database. Auth stays shared across both (only the data is separated; that's what was asked for).
  - Build notes: a named database is created via the `gcloud` CLI (`gcloud firestore databases create --database=test --location=... --type=firestore-native`) — check at build time whether the Firebase Console also offers this directly. Security Rules are deployed **per database** (via the Firebase CLI, once per database), so both databases need their rules deployed separately, not just the default one. The Web SDK connects to a specific database via `getFirestore(app, "test")` instead of the plain `getFirestore(app)` for default.
- **Sequencing note**: this environment split is not part of the very first infra iteration (TASK.md iteration 1) — that iteration only needs to prove basic connectivity works at all, against the default database, with no `/test/` split yet. Setting up the dual-environment structure is a near-term follow-up task once iteration 1 is working, not a prerequisite for it.

## Report
- The official report is authored outside this app (closed network). This app's job is to produce a **report section as a docx file**, structured so it can be inserted into that report via the closed network's existing docx-import path. Exact content/structure of that section — TBD.

## Reviews
- Triggered when a case reaches `closed`.
- Client can: decline (removes the request entirely), review later (dismisses the prompt but keeps the link available), or complete it.
- A completed review has several 1-5 ranking questions plus a free-text area (exact question set TBD).
- Reviews are stored independently of the case record, so they survive the case's eventual deletion at `archived`.
- Admin may need elevated access here for anonymity reasons — deferred.

## Open questions (revisit as we build)
- **Admin & reviews**: does Admin get elevated access for review anonymity handling, and if so what exactly?
- **Utility features**: unspecified — "some utility" was mentioned early on, content TBD.
- **Research stage**: structure undecided (checklist / workflow / freeform notes).
- **Case-level status derivation**: when samples are in different per-sample stages simultaneously, how is the case's overall displayed status computed/shown (e.g., "in lab" while any sample is still in lab, moving to "research" once all samples clear lab)?
- **Report section content**: what exactly the generated docx section contains, and what structure it needs to match for insertion into the closed-network report.
- **Review question set**: the actual 1-5 ranking questions and free-text prompt wording.
- **Shadow case promotion**: does a shadow case become the real case record (promoted in place), or does opening the real case happen separately with the shadow entry then cleared out?
- **Case/sample/action field-level detail**: exact fields on each entity beyond what's now known (case number format, item/sample descriptors, action catalog entries, measurement field types/units, etc.) — not yet fully specified.

## Phase plan
1. **Infrastructure (current phase):** GitHub repo + Pages, Firebase project + Firestore + Auth (email/password), minimal web app config wired in, a skeleton page proving login + a Firestore read/write round-trip, basic manifest for home-screen install.
2. **Core data model:** case/sample/action/stage structures, workflow catalog, role-based access, once remaining open questions above are resolved enough to build against.
3. **Client visibility:** per-sample stage-only view for clients, once the access model is chosen.
4. **Reviews:** post-closure review flow.
5. **Reporting:** docx section generation per case.

## Decisions Log
- 2026-09-16 — Initial spec created from Cowork design session.
- 2026-09-16 — Terminology fixed to "Case" (not "Job"). Environment split (open/closed network) established; this app is scoped entirely to the open-network side. Full case lifecycle, roles, and case/sample/action/stage model captured through discussion. Measurement values confirmed to be stored in-app (revises the earlier "lighter data" framing). Client MVP view scoped to stage-name-per-sample only. Archiving confirmed as full deletion, not long-term storage.
- 2026-09-16 — Auth model settled: fake/synthetic emails for all in-app accounts (including the owner's). Client access model settled: one public link, no login/ID, filterable by client name, with a lean-view toggle (status/start date/day count/expected timeline) and a nested shadow-cases toggle. New "shadow case" concept added: pre-case placeholder with notes only, no case number, visible to lab team leader and via the client lean view's shadow toggle.
- 2026-09-16 — Admin role confirmed with concrete capabilities: add/delete users, change user status, change user password. Implies a Cloud Function behind user-account management (Firebase Blaze plan needed); Firebase Console via the owner's Google account remains the fallback path.
- 2026-09-16 — Versioning scheme settled: semver-style MAJOR.MINOR.PATCH starting at 0.1.0 (patch = a fix to something launched, minor = launched feature, major = TBD, likely 1.0.0 = real day-to-day use). Displayed at the top of the app. Pre-build setup (GitHub repo, Firebase project) confirmed done by the user. First TASK.md (infra skeleton iteration) handed off to Claude Code.
- 2026-09-16 — Versioning refined: testing-in-progress versions carry a `-tNN` suffix (two-digit, e.g. `-t01`), dropped once launched. Environments settled: two live URLs from one repo (root = launched, `/test/` = working build), with data separated via a second Firestore named database (`test`) in the same Firebase project rather than a separate project — real database-level isolation instead of a naming-convention risk. This environment split is a near-term follow-up task, not part of the first infra iteration.
- 2026-09-17 — Process conventions added: the user will say "execute" to Claude Code to mean "read TASK.md and build it," documented in CLAUDE.md. This document now carries its own version tag (`sJ.M.P`, see "Spec versioning" above), baselined at `s0.1.0`. TASK.md now carries a target-app-version + drafted/updated timestamp header so staleness is visible before a build starts.
- 2026-09-17 — Infra skeleton (`0.1.0-t01`) built: single `index.html` with Firebase modular SDK v10.14.1 loaded via CDN `<script type="module">` (ESM CDN imports, not the compat/global build). Firestore round-trip test uses a single fixed doc `ping/latest` (not per-user) since this iteration has no per-user data model yet. Firestore rules written to `firestore.rules` in the repo root as the source of truth, applied manually via the Firebase Console Rules tab (no Firebase CLI/deploy pipeline set up yet). Firebase web app config was not yet available, so `index.html` ships with obvious `PASTE_YOUR_*` placeholders instead of real or fake-looking keys; README.md's new "Firebase setup" section walks through registering the web app, enabling Firestore/Auth, creating the first synthetic-email test account, and pasting in config + rules. Deployed to GitHub Pages at `https://matanyaa.github.io/smart-lab/`.
- 2026-09-17 — Added a minimal no-op `sw.js` service worker (registers a `fetch` listener, no caching/offline logic) after testing on Android Chrome showed no home-screen install prompt: Chrome's installability check requires a registered service worker before it'll offer the full "Install app" treatment, separate from the manifest itself being valid. Not a caching/offline strategy yet — just enough to satisfy that check.
- 2026-09-17 — Added the "update available, refresh?" banner (TASK.md for this iteration had explicitly deferred it "until there's a second deployed version to actually test against") — the user asked for it directly once `0.1.0-t02` gave them exactly that second version to test with, so it was pulled forward rather than waiting for a later TASK.md. Implementation matches the existing pattern from `calorie-tracker`/`split-builder`: polls its own `index.html` on load and on tab-visibility-regained, regex-matches the `APP_VERSION` constant, shows a dismissible banner with a Reload button on mismatch. Bumped to `0.1.0-t03` to exercise it.
- 2026-09-17 — Considered and rejected a 60s `setInterval` poll for the update-check, added after testing showed a tab left open in the foreground the whole time never re-checks (same limitation exists in `calorie-tracker`/`split-builder`, just not one the user had hit there). User decided the existing load/visibilitychange/pageshow triggers are sufficient — an interval poll isn't worth the added complexity/battery cost for this app. Reverted; bumped to `0.1.0-t05` to retest the original mechanism (background/foreground the app, not just leave the tab sitting open).
