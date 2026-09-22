import { APP_VERSION } from './firebase-init.js?v=0.4.1-t16';

// Plain-language, user-facing history -- distinct from SPEC.md's Decisions
// Log (design/build rationale) and HANDOFF.md (Claude Code's build notes).
// Keep entries short: the effect a user would notice, not the mechanism
// or any file/code names. Skip a version entirely if nothing user-visible
// changed in it.
const CHANGELOG = [
  {
    version: '0.3.1',
    date: '2026-09-17',
    notes: [
      'The app now keeps working briefly if your connection drops, and catches up automatically once it’s back.',
      'Tidied up the admin screen.'
    ]
  },
  {
    version: '0.4.0',
    date: '2026-09-18',
    notes: [
      'New: track cases, their samples, and the tests run on each one, from creation through to archiving.'
    ]
  },
  {
    version: '0.4.1',
    date: '2026-09-18',
    notes: [
      'Cases now have a Notes tab, and actions can require a second person to verify measurements.',
      'New: case types and client/client-org lookups, used when creating a case.',
      'Clients can now log in to see their own cases’ status.',
      'Case manager is optional when creating a case, and cases can be deleted at any stage.',
      'Clearer "+ New case" button that shows when it’s open.',
      'Case view: Notes and Edit are now icon buttons at the top, and you can delete a case from there or right from the case list, without opening it first.',
      'Case header now shows the case title, day/date/status, and client as three clear lines.',
      'Visual refresh: new typography (a technical sans/mono pairing) and sharper corners app-wide, plus status now shows as a small stamped tag instead of plain text.',
      'Case view: the workflow stage is now a row of named, clickable circles (New/Lab/Write/Archive/Done). Click any of them to preview that stage; the real controls still only appear on the case’s actual current stage.',
      'Removed the redundant "Client" line from the compact case-info view (the header already shows it).',
      'Samples no longer show test status/results inline -- that’s all in the Workflow section’s Lab view now, where you can also execute or verify actions.'
    ]
  }
];

const STORAGE_KEY = 'smartlab_last_seen_version';
const IS_TEST_BUILD = /-t\d+$/.test(APP_VERSION);

const overlay = document.getElementById('changelogOverlay');
const list = document.getElementById('changelogList');
const closeBtn = document.getElementById('changelogCloseBtn');
const versionBadge = document.getElementById('versionBadge');

function entriesSince(lastSeenVersion) {
  if (!lastSeenVersion) return CHANGELOG;
  const idx = CHANGELOG.findIndex((entry) => entry.version === lastSeenVersion);
  return idx === -1 ? CHANGELOG : CHANGELOG.slice(idx + 1);
}

function showChangelog(entries) {
  if (entries.length === 0) return;
  list.innerHTML = '';
  entries.forEach((entry) => {
    const entryEl = document.createElement('div');
    entryEl.className = 'changelog-entry';

    const versionLine = document.createElement('div');
    versionLine.className = 'changelog-version';
    versionLine.textContent = entry.version;
    const dateEl = document.createElement('span');
    dateEl.className = 'changelog-date';
    dateEl.textContent = entry.date;
    versionLine.appendChild(dateEl);

    const ul = document.createElement('ul');
    entry.notes.forEach((note) => {
      const li = document.createElement('li');
      li.textContent = note;
      ul.appendChild(li);
    });

    entryEl.appendChild(versionLine);
    entryEl.appendChild(ul);
    list.appendChild(entryEl);
  });
  overlay.classList.remove('hidden');
}

closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));

// Clicking the version display reopens the popup on demand, showing
// everything regardless of what's already been "seen" -- works the same
// on docs/ and docs/test/.
versionBadge.style.cursor = 'pointer';
versionBadge.title = "What's new";
versionBadge.addEventListener('click', () => showChangelog(CHANGELOG));

// Auto-popup once per new version -- suppressed on docs/test/'s -tNN
// builds specifically, since those are in-progress by nature and would
// otherwise pop up on every testing pass. Root (docs/) only ever runs
// plain versions, so it always auto-triggers.
if (!IS_TEST_BUILD) {
  let lastSeen = null;
  try { lastSeen = localStorage.getItem(STORAGE_KEY); } catch (e) { /* private browsing, etc. */ }
  if (lastSeen !== APP_VERSION) {
    showChangelog(entriesSince(lastSeen));
    try { localStorage.setItem(STORAGE_KEY, APP_VERSION); } catch (e) { /* ignore */ }
  }
}
