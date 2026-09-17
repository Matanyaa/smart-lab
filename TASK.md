# TASK — Iteration 4: Core case/sample/action model

**Target app version:** `docs/test/` → `0.4.0-t01`, bumping `-tNN` as needed while proving this out. Root untouched until this launches (per the current versioning convention, root will go straight to a plain `0.4.0` once confirmed — no `-tNN` there).
**Task drafted/updated:** 2026-09-17 (full rewrite — supersedes the earlier draft of this same task; the data model, lifecycle, and workflow shape all changed significantly during design discussion since the last version).

This is the first iteration touching the actual lab-work model: cases, their samples, and the actions performed on them. Read `CLAUDE.md` first (you only read `CLAUDE.md`/`SPEC.md`/`TASK.md` and only write to `HANDOFF.md`), then `SPEC.md`'s "Roles," "Case lifecycle," and "Case / Sample / Action model" sections before starting — `SPEC.md` has been updated to match everything below.

## A few consolidating calls made while writing this up
A lot of ground was covered in design discussion; a handful of small gaps got filled in with a specific, reasonable choice rather than left open. Flagged here so they're visible in one place — if any of these are wrong, a quick note back is cheaper than building it wrong:
- **"New" and "planning" are merged into a single internal stage**, called `new` — both are just "case is being set up" (fields, then samples/workflows), and the client shows the same "In lab" label for it as for the actual `lab` stage, so there was no reason to keep them as two stored values.
- **Research is tracked at the case level, not per sample** — a single `researchAddressed` flag per case, not a per-sample research status. (This supersedes the original spec's "research, tracked per sample" line; `SPEC.md` has been updated.)
- **Explicit actions gate the big transitions**: "Start lab" (new → lab, team leader/admin), automatic lab → writing once every sample's actions are all done, "Publish report" (writing → archiving — blocked unless `researchAddressed` is true), "Approve & delete" (archiving → done — team leader only, deletes the case).
- **Archiving workflow's ordering (sequential vs. parallel) is informational/display-only this iteration** — nothing stops someone from marking "scan" done before "publish," matching the "loose for now" pattern already used elsewhere in this spec (e.g. action assignment). Add real enforcement later if it turns out to matter.
- **On hold / high priority are pure badges** — no enforced behavior (an on-hold case's actions can still be executed normally), visible both to the client and internally.
- **The public client-facing view itself is still out of scope** for this iteration (unchanged from the original scope — that's Phase plan item 5). This task stores every field that view will eventually need (`stage`, `onHold`, `highPriority`, `showResearchToClient`, `researchAddressed`), but doesn't build the public page.
- The case's `archivingWorkflow` is stored as a plain array field directly on the case document, not a subcollection — it's small (5 items), always edited as a whole, and never queried independently of its case.
- An action's `zone` field holds one zone name or nothing — covering the same test across multiple zones means taking the free-form action again per zone, not one action instance holding several zones' results.

## Data model

Firestore, all under a `cases` collection. No `createdBy` field (dropped — not needed). No `assignedTo` on actions (dropped — actions go straight from unclaimed to executed). No verifier fields anywhere (`requiresVerifier`/`verifiedBy`/`verifiedAt`) — verifier is explicitly out of scope for this iteration.

- **`cases/{caseId}`** (auto-generated, opaque, internal doc ID — never shown to the user as "the case's ID"):
  - `caseNumber` (string) — **mandatory**. Either a real number in `YYMMNXX` format (YY = year, MM = month, N = department digit — `5` for this lab's own cases — XX or XXX = running number, almost always 2 digits), or an auto-generated placeholder `tempN` (lowest integer `N` not already in use among this case's siblings' temp numbers — fine to compute by scanning existing `caseNumber` values given how few cases there are). Freely editable later (e.g. replacing a temp number with the real one, or fixing a typo) — it's just a field, not the document's actual key, so editing it has no migration cost.
  - `clientCaseNumber` (string, optional/nullable) — the client's own case number for whatever work on their end this case's output feeds into (same `YYMMNXX` shape, department digit `4` for the one known client so far). Two distinct cases, only connected by this reference.
  - Both `caseNumber` and `clientCaseNumber`: soft-validate the shape (6–8 digits: `YYMM` + 1-digit department + 2-or-3-digit running number, month between 01–12) and show a dismissible warning on mismatch — never block saving an "invalid" one. Don't validate the department digit itself (informational only, not a rule).
  - `name` (string) — the case's own short title/label, separate from `clientName`.
  - `clientName` (string, as already speced).
  - `caseManager` (string, username) — set by the team leader; any `worker` or `team_leader` account can be named (a team leader can manage their own case).
  - `startDate`, `expectedTimelineDate` (as already speced).
  - `stage` (string enum: `"new" | "lab" | "writing" | "archiving" | "done"`) — see "Case lifecycle" below for what drives each transition. Starts at `"new"`.
  - `onHold` (bool, default `false`) — team-leader-only toggle. Pure badge, no enforced behavior.
  - `highPriority` (bool, default `false`) — team-leader-only toggle. Pure badge, no enforced behavior.
  - `showResearchToClient` (bool, default `false`) — team-leader-only toggle, per case.
  - `researchAddressed` (bool, default `false`) — manually set by team leader or case manager once research (whatever form it takes — most likely just notes, not a structured workflow) is sufficiently wrapped up. Gates the writing → archiving transition.
  - `archivingWorkflow` (array) — see "Archiving workflow" below for its seeded shape. Freely editable (rename/remove/add items) by the team leader once established.
- **`cases/{caseId}/samples/{sampleId}`** (subcollection, auto-generated opaque doc ID):
  - `name` (string, required) — unique within the case.
  - `groupName` (string, optional) — for samples that came from the same composite part (e.g. `groupName: "Bearing 1"`, `name: "Ball"`). Purely for display/reference (`groupName - name`, e.g. "Bearing 1 - Ball") — no effect on how the sample is tracked.
  - `zones` (array of strings, optional) — e.g. `["Head", "Shank", "Threads"]`. Empty/absent for a sample with no meaningful sub-locations.
- **`cases/{caseId}/samples/{sampleId}/actions/{actionId}`** (subcollection, auto-generated opaque doc ID) — every action is the same one type, a **free-form action**, and can be added as many times as needed:
  - `name` (string, required) — e.g. "Visual Inspection", "Hardness Test — Head".
  - `zone` (string, nullable) — one of the sample's `zones`, if this instance is specifically about one zone; null/absent if it's whole-sample.
  - `notes` (string) — free text, what was done/observed.
  - `results` (string) — free text, the findings.
  - `executedBy` (string, username, nullable until done), `executedAt` (timestamp, nullable until done).
  - `status` (`"pending" | "done"`).

## Step 1: Case creation
- A "new case" form: `caseNumber` (either typed directly, or a button to auto-generate the next free `tempN`), `name`, `clientName`, `clientCaseNumber` (optional), `startDate`, `expectedTimelineDate`, `caseManager` (pick a `worker` or `team_leader` username). Soft-validate `caseNumber`/`clientCaseNumber` shape per the rule above (warn, don't block).
- Restricted to `role == "team_leader"` (matches SPEC). `admin` can also do this, for testing purposes.
- New case starts at `stage: "new"`.

## Step 2: Samples, zones, and the default lab workflow
- From the case detail view (while `stage == "new"`, though no hard block on adding more samples later if that turns out to be needed): add samples one at a time (`name`, optional `groupName`, optional `zones` — a simple repeatable text-list input). No cap on sample count.
- **Fixed default lab workflow, seeded on every new sample**: three free-form action instances — "Visual Inspection" first, then "Composition Analysis" and "Hardness Test" (these two in parallel with each other, informational-only ordering per the note above). This is hardcoded app behavior for this iteration, not a per-case configurable list.
- From a sample's detail view, add further free-form actions beyond the three defaults, any time, giving each a name (and optionally a `zone`) — this is also how the same test gets repeated per zone (add it again, same name, different `zone`).
- Executing an action: fill in `notes`/`results`, which records `executedBy` (current user) + `executedAt` (now) and flips `status` to `"done"`.

## Step 3: Case lifecycle and stage transitions
- **`new`**: case fields, samples, zones, and the archiving workflow (see Step 4) all get set up here — this single stage covers everything from bare creation through to "ready to start lab." Once the client view exists (Phase plan item 5, not built yet), a case in `new` is already visible there — see the client-visibility note below.
- **`new` → `lab`**: explicit "Start lab" action, team leader (or admin). Requires at least one sample to exist.
- **`lab`**: samples' actions get executed. Show internally (admin/team-leader/worker views) a simple progress indicator per case — how many of its samples have every action `done` — e.g. "8/15 samples complete." This is purely a display convenience, not stored.
- **`lab` → `writing`**: automatic, once every sample has every one of its actions at `status: "done"`. No explicit button needed.
- **`writing`**: the actual report is authored outside this app (closed network) — nothing to build here beyond the transition below.
- **`writing` → `archiving`**: explicit "Publish report" action, team leader. **Blocked unless `researchAddressed == true`** — show why it's blocked if the team leader tries anyway. This is also the point a case would drop out of client visibility, once that view exists.
- **`archiving`**: the archiving workflow's actions (Step 4) get executed the same way sample actions do.
- **`archiving` → `done`**: explicit "Approve & delete" action, **team leader only** (not admin — matches the original spec's "team leader signs off final archiving"). On confirmation: **delete the case document and its entire `samples`/`actions` subtree.** This is real, permanent deletion, matching the existing "archived" behavior already speced — nothing about that changed, just the stage name. (If/when reviews exist, the review record itself is stored independently and survives this — not part of this iteration.)
- `researchAddressed` can be toggled true/false any time by the team leader or case manager, independent of `stage` — it's just a flag that happens to gate one transition.
- **Client visibility (once that view exists, Phase plan item 5)**: a case is visible from the moment it's created, not just once it reaches `lab` — `new` and `lab` both display as **"In lab"** to the client (no distinction shown between them), `writing` displays as **"Writing,"** and the case disappears from view once it reaches `archiving`.

## Step 4: Archiving workflow
- Established during `new` (seeded automatically once a case is created, or the first time its detail view is opened — Claude Code's discretion on exactly when, as long as it exists by the time `stage` reaches `archiving`).
- Seeded shape, using the same free-form action type as sample actions: **Publish → Close-in-access → (Return parts ‖ Archive samples) → Scan** — four sequential steps, with "Return parts" and "Archive samples" as a parallel pair inside the third slot. Ordering is informational/display-only (see note above).
- Freely editable afterward by the team leader like any other set of free-form actions — rename an item (e.g. "Return parts" → "Salvaging" for a case where parts are salvaged instead of returned), remove one (skip a step that doesn't apply), or add more. No special "alternate action" mechanism needed — this is just ordinary editing of the seeded default.

## Step 5: On hold / high priority / research-visibility toggles
- Three booleans on the case (`onHold`, `highPriority`, `showResearchToClient`), settable by the team leader only. All three are pure display badges this iteration — no enforced behavior (an on-hold case's actions can still be executed, nothing checks these flags before allowing anything). Surface them somewhere sensible in the case detail/admin view; the public client view they're ultimately meant for is a separate, later iteration.

## Explicitly NOT in scope for this iteration
- The public client-facing view (Phase plan item 5) — this task only stores the fields it'll need (`stage`, `onHold`, `highPriority`, `showResearchToClient`, `researchAddressed`).
- Verifier sign-off of any kind — the tag itself doesn't exist right now and isn't being redesigned this iteration. No `requiresVerifier`/`verifiedBy`/`verifiedAt` fields at all.
- Reviews and report/docx generation (Phase plan items 6–7).
- A managed workflow catalog UI — the free-form action is the only action type this iteration.
- Real enforcement of the sequential/parallel ordering within a workflow (archiving or lab) — informational/display-only for now.
- Editing or deleting an action once it exists (only marking it done) — revisit if that turns out to be needed in practice.
- What research's own internal structure looks like beyond the single `researchAddressed` flag (checklist / workflow / freeform notes — still an open question in `SPEC.md`).

## Where to build this
`docs/test/` first and only, as usual — this is a genuinely new feature area (Phase plan item 4), not a small patch, so it gets the full proving-out cycle before root ever sees it.

## Definition of done
- Team leader (or admin) can create a case with all the fields above, including `caseNumber`/`clientCaseNumber` soft validation and temp-number generation.
- Team leader (or admin) can add samples (with optional groupName/zones) to a `new`-stage case; each new sample is seeded with the three default free-form actions in the stated order/grouping.
- Free-form actions can be added to a sample at any time (with an optional zone) and executed (notes/results, recording who/when).
- "Start lab" moves a case from `new` to `lab`; the case automatically moves to `writing` once every sample's every action is `done`.
- The archiving workflow is seeded per case (in `new`) and is freely editable; "Publish report" moves `writing` → `archiving` and is blocked unless `researchAddressed` is true; "Approve & delete" (team leader only) moves `archiving` → `done` and deletes the case and its full subtree.
- `onHold`, `highPriority`, `showResearchToClient`, and `researchAddressed` are all settable and stored, even though nothing yet consumes them publicly.

## When done
Log your completion note in `HANDOFF.md` — what you built, the exact schema/field/UI choices you made along the way, any deviation, any blocker, and the current app version reached. Do not write to this file or to `SPEC.md`.
