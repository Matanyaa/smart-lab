# HANDOFF — smart-lab

**Write-only for Claude Code, read-only for the design session.** This is the one file Claude Code writes to — see `CLAUDE.md`'s "How this project is being run" for why (two writers on the same file was silently losing content; splitting reads from writes fixes that structurally).

**Claude Code:** whenever a task finishes, or you hit a blocker/open question mid-build, append an entry below — never edit `CLAUDE.md`, `SPEC.md`, or `TASK.md` yourself, and don't rewrite or delete earlier entries here, only add your own. Include:
- What you actually built (and the current app version reached — the live `APP_VERSION`, not just what `TASK.md` targeted).
- Any deviation from `TASK.md` or `SPEC.md`.
- Any real design/architecture decision you made along the way (schema shape, library choice, structure change).
- Any question or blocker, if you're stopping mid-task rather than completing it.

**Design session:** read this file, absorb anything durable into `SPEC.md`, and write the next `TASK.md`. **Never write to this file, not even to clear it** — doing that would reopen the exact two-writer collision this file exists to avoid, just in the other direction. Entries are dated, so what's new since the last check is whatever's dated after the last entry already absorbed into `SPEC.md`. If this file ever gets long enough to be unwieldy, that's Claude Code's call to make (e.g. moving old, already-absorbed entries into a dated archive file it also owns) — not the design session's.

---

(No entries yet.)
