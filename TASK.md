# TASK — Iteration 2: Launch 0.1.0, then stand up the test/launch split

**Target app version:** `0.2.0-t01` (after promoting the current build to plain `0.1.0` — see step 1)
**Task drafted/updated:** 2026-09-16 (rev 2 — icon spec finalized)

Read `CLAUDE.md` first, then this file. Two distinct pieces of work below — do them in order, and keep the promotion as its own clean commit separate from the environment-split work.

## Step 1: Promote `0.1.0-t05` to plain `0.1.0`
This is the first real "launch" — dropping the testing suffix, nothing else changes functionally.
1. Set `APP_VERSION` (and wherever else the version string appears, e.g. the manifest if it's duplicated there) from `0.1.0-t05` to `0.1.0`.
2. Commit this alone, with a message that marks it as the launch (e.g. `Launch 0.1.0`), separate from anything else — this is the commit that would mark "what colleagues/clients are on" once real users exist.
3. Push. This becomes the new root/launched baseline for everything below.

## Step 2: Stand up the test/launch split
Per `SPEC.md`'s "Environments" section:
1. Create a `/test/` subfolder in the repo, containing a copy of the current app (`index.html`, `manifest.json`, `icon.svg`, `sw.js`, `firestore.rules` reference, etc.).
   - **Icon:** use `icon-test.svg` (in the repo root, next to `icon.svg`) as `/test/icon.svg`. It's the exact same shape/background as the launched icon — only the accent color changed from green `#4ac98f` to amber `#f5a623` — so it reads as "same app family, test build" (same convention as e.g. Chrome Canary vs. Chrome). Rename the file to `icon.svg` inside `/test/` so `/test/manifest.json` doesn't need a path change.
   - **Manifest:** in `/test/manifest.json`, set `"name": "Smart Lab (Test)"` and `"short_name": "Lab Test"` — the short_name is what shows under the home-screen icon, so it needs to read clearly at that size. Leave `theme_color`/`background_color` as-is (`#141a1f`) — same background ties it visually to root, the icon accent color is what signals "test."
   - This matters now, before anyone installs either build, since a user can install both root and `/test/` to their phone home screen as two separate apps (same manifest scope rules as any PWA), and identical name/icon on both would make them easy to mix up.
2. Create a second Firestore database named `test` in the same Firebase project (`gcloud firestore databases create --database=test --location=... --type=firestore-native` — check first whether the Firebase Console now offers this directly, since that'd be simpler for the user to do manually if you can't run `gcloud` yourself in this environment; if you can't create it yourself, write clear instructions for the user to do it, the same way the original Firebase setup instructions worked).
3. Deploy `firestore.rules` to **both** databases — Security Rules are per-database, so the `test` database needs the same baseline rules applied separately (Console Rules tab, selecting the `test` database, or Firebase CLI with `--database=test` if you set that up).
4. Point the `/test/` build's Firestore connection at the named `test` database (`getFirestore(app, "test")`), while the root build keeps using `getFirestore(app)` (the default database). Everything else about `/test/`'s code can stay identical to root for now — this step is purely about proving the split works, not adding new features yet.
5. Version: `/test/` should display `0.2.0-t01` — going forward, `/test/` is where the *next* feature gets built and tested before it launches, so it starts versioned toward the next minor rather than re-testing `0.1.0`. Root stays at plain `0.1.0` throughout this whole iteration.
6. **Verify isolation actually holds**: from `/test/`, write/read a `ping/latest` doc (same pattern as the existing round-trip test) and confirm it lands in the `test` database, not `(default)` — e.g. by checking the Firebase Console's Firestore data browser for both databases side by side. This is the actual proof the split works, not just "the code looks right."
7. Commit and push.

## Explicitly NOT in scope for this iteration
- Any new user-facing feature (case/sample/action model, etc.) — `/test/` should be functionally identical to root at the end of this iteration, just pointed at different data.
- Auth separation — both builds share the same Firebase Auth users, as settled in `SPEC.md`. Only the Firestore data is split.
- Actually "launching" whatever gets built in `/test/` next — that's a future iteration's job, once there's a real feature there worth promoting.

## Definition of done
- Root (`https://matanyaa.github.io/smart-lab/`) shows plain `0.1.0`, works exactly as it did before, unaffected by anything below.
- `/test/` (`https://matanyaa.github.io/smart-lab/test/`) shows `0.2.0-t01`, logs in with the same account, and its Firestore round-trip writes/reads visibly land in the `test` database — confirmed by the user checking the Firebase Console, not just by the code compiling.

## Versioning
Root: `0.1.0` (launched, step 1). `/test/`: `0.2.0-t01`, bumping `-t02`, `-t03`... if more passes are needed within this iteration.

## When done
- Add a short note below this line: what you built, any deviations, any questions or blockers — especially if you couldn't create the second database yourself and had to hand that step to the user.
- Log any real decisions (exact `gcloud`/Console steps that worked, file structure under `/test/`, anything about the update-check banner needing to know which build it's in) as a dated entry in `SPEC.md`'s Decisions Log.

---

*(Claude Code: add your completion note below this line.)*

**Done — 2026-09-17.** Step 1: `0.1.0` launched (dropped the `-t05` suffix), separate commit, pushed. Step 2: `docs/test/` stood up as a copy of the launched build.

Note the repo was restructured (app code moved to `docs/`, setup docs to `setup/`) between this TASK.md's drafting and today's build — "repo root" and `/test/` in this file's wording map to `docs/` and `docs/test/` respectively; see `CLAUDE.md`'s "Repo layout" and today's two new `SPEC.md` Decisions Log entries.

- `docs/test/icon.svg` — used the design session's `icon-test.svg` (amber `#f5a623` accent), found already dropped at both repo root and `docs/` — removed both stray copies after copying it into place at `docs/test/icon.svg`.
- `docs/test/manifest.json` — `name: "Smart Lab (Test)"`, `short_name: "Lab Test"`; colors unchanged.
- `docs/test/index.html` — `APP_VERSION = '0.2.0-t01'`. Everything else identical to the launched build.
- No separate `docs/test/firestore.rules` — the canonical copy stays in `setup/firestore.rules` (from the earlier restructure), same content applies to both databases.

**Update 2026-09-17 — plan changed mid-build.** Firestore's second-named-database feature (this task's original mechanism for isolating `docs/test/`'s data) turned out to need the paid Blaze plan; the user is on Spark (free), which only allows `(default)`. Rather than silently reverting to the naming-convention approach `SPEC.md` had explicitly rejected, surfaced it as a design fork and asked — user chose to stay on Spark with a collection-name prefix. So `docs/test/index.html` now uses the plain `getFirestore(app)` (same `(default)` database as the launched build) and writes its round-trip test to `test_ping/latest` instead of `ping/latest`. `setup/README.md`'s test-environment section rewritten to match (no database to create; nothing new needed in the Firebase Console beyond what's already set up). Full rationale and the rejected alternatives logged in `SPEC.md`'s Decisions Log.

**Verification still needed from you:** log into `/test/`, run "Test Firestore round-trip," then check the Firebase Console's `(default)` database data browser — you should see both a `ping` doc (from earlier root testing) and a separate `test_ping` doc (from this test), confirming they don't collide.

**Update 2026-09-17 — `/test/` dropped as a separately-installable PWA.** Testing showed Android can't offer two independent home-screen icons when one URL path is nested under the other (`/test/` under `/`) — this is a strict web-platform limitation (manifest `scope` is a prefix match with no way to exclude a subpath), not something fixable with more manifest tweaks; confirmed after trying an explicit `id` field and a full uninstall/reinstall, still collided. Removed `docs/test/manifest.json` and `docs/test/sw.js` — `/test/` is browser bookmark/tab access only now, not home-screen-installable. This walks back one part of this TASK.md's icon/manifest spec (step 1's `icon-test.svg`/manifest naming work), since there's no longer a manifest for it to apply to. Full writeup in `SPEC.md`'s Decisions Log. If a genuinely separate installable test icon ever matters enough, the real fix is a second repo at a sibling (non-nested) path — costs a second repo to keep in sync, not attempted here.

**Task complete — 2026-09-17. Current app versions: root `0.1.0`, `/test/` `0.2.0-t01`.**

Both of this iteration's two steps are done and user-verified: root launched at plain `0.1.0` (dropped `-t05`), and `/test/` stood up and confirmed data-isolated from root — the Firebase Console shows `ping` and `test_ping` as two separate top-level collections in the shared `(default)` database, proving writes from each build don't collide despite sharing everything else (Auth, database, rules).

Net deviations from this TASK.md's original design, all discovered mid-build and resolved with the user rather than guessed silently:
- **Data isolation mechanism changed**: planned second named Firestore database → collection-name prefix (`ping` vs `test_ping`) in the shared `(default)` database, because that feature needs the paid Blaze plan and this project is on Spark (free).
- **`/test/` isn't home-screen-installable**: dropped entirely rather than partially working, because nested URL paths can't produce two independent PWA install identities on Android — a platform limitation, not a bug to keep chasing.
- Repo also got restructured earlier this session (`docs/`/`setup/` split) at the user's request, ahead of and compatible with this iteration's `/test/` work — see the two Decisions Log entries dated earlier today.

No open blockers. Next: a follow-up TASK.md from the design session — likely the actual case/sample/action data model, now that infra + environments are both proven working.
