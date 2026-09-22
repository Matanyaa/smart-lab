import { db } from './firebase-init.js?v=0.4.1-t17';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { loadCaseTypes, getCachedCaseTypes, findCaseTypeById } from './case-types-ui.js?v=0.4.1-t17';
import {
  loadClientOrgsAndClients, getCachedClientOrgs, getCachedClientsForOrg, fetchClientsForOrg,
  findClientById, findClientOrgById
} from './clients-ui.js?v=0.4.1-t17';

// ---------------------------------------------------------------------
// Core case/sample/action model (0.4.1 redesign -- see SPEC.md's "Case
// lifecycle" / "Case model"). Internal to the lab team -- admin has zero
// rule-level access to any of this now (see setup/firestore.rules), and
// clients get their own, separately-scoped read-only view (client-view.js).
// ---------------------------------------------------------------------

const casesScreen = document.getElementById('casesScreen');
const caseDetailScreen = document.getElementById('caseDetailScreen');
const caseTypeGroupsContainer = document.getElementById('caseTypeGroups');
const showNewCaseFormBtn = document.getElementById('showNewCaseFormBtn');
const newCaseForm = document.getElementById('newCaseForm');
const newCaseError = document.getElementById('newCaseError');
const backToCasesBtn = document.getElementById('backToCasesBtn');
const toggleNotesBtn = document.getElementById('toggleNotesBtn');
const editInfoBtn = document.getElementById('editInfoBtn');
const deleteCaseBtn = document.getElementById('deleteCaseBtn');
const caseDetailTitle = document.getElementById('caseDetailTitle');
const caseMainView = document.getElementById('caseMainView');
const caseNotesView = document.getElementById('caseNotesView');
const genTempNumberBtn = document.getElementById('genTempNumberBtn');
const newCaseClientOrgSelect = document.getElementById('newCaseClientOrg');
const newCaseClientSelect = document.getElementById('newCaseClient');
const newCaseTypeSelect = document.getElementById('newCaseType');
const newCaseManagerSelect = document.getElementById('newCaseManager');

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;
const DUPLICATE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

let myProfile = null; // { uid, username, role }
let cases = [];
let infoEditMode = false;
let expandedSamples = new Set();
let notesShown = false;
let viewedStage = null; // null = follow the case's real current stage

export function hideCasesScreen() {
  casesScreen.classList.add('hidden');
  caseDetailScreen.classList.add('hidden');
  myProfile = null;
}

export function showCasesScreen(profile) {
  myProfile = profile;
  caseDetailScreen.classList.add('hidden');
  casesScreen.classList.remove('hidden');
  const canCreate = profile.role === 'team_leader';
  showNewCaseFormBtn.classList.toggle('hidden', !canCreate);
  newCaseForm.classList.add('hidden');
  showNewCaseFormBtn.textContent = '+ New case';
  showNewCaseFormBtn.classList.remove('active');
  newCaseForm.reset();
  loadCaseTypes();
  loadClientOrgsAndClients();
  loadCaseList();
}

// ---------------------------------------------------------------------
// Case number / client case number soft validation. Never blocks saving
// -- just a dismissible warning when the shape looks off. Expected shape:
// YYMM (4 digits) + department digit + running number (2-3 digits) = 7-8
// digits total. Department digit itself isn't validated (informational).
// ---------------------------------------------------------------------
function validateCaseNumberShape(value) {
  if (!value) return null;
  if (/^temp\d+$/.test(value)) return null;
  if (!/^\d{7,8}$/.test(value)) return "Doesn't look like YYMMNXX(X) — expected 7-8 digits.";
  const mm = parseInt(value.slice(2, 4), 10);
  if (mm < 1 || mm > 12) return 'Month digits (positions 3-4) should be 01-12.';
  return null;
}

async function nextTempNumber() {
  const snap = await getDocs(collection(db, 'test_cases'));
  const used = new Set();
  snap.forEach((d) => {
    const m = /^temp(\d+)$/.exec(d.data().caseNumber || '');
    if (m) used.add(parseInt(m[1], 10));
  });
  let n = 1;
  while (used.has(n)) n++;
  return `temp${n}`;
}

async function fetchAssignableUsers() {
  const snap = await getDocs(collection(db, 'users'));
  const users = [];
  snap.forEach((d) => {
    const u = d.data();
    if (u.role === 'team_leader' || u.role === 'worker') users.push(u.username);
  });
  users.sort();
  return users;
}

genTempNumberBtn.addEventListener('click', async () => {
  document.getElementById('newCaseNumber').value = await nextTempNumber();
});

// 0.4.1 UI fix: the toggle now visibly flips between "+ New case" and
// "✕ Cancel" (plus a pressed/active style) instead of leaving the same
// label up regardless of state -- testing found the old plain toggle
// unclear about what a second click would do.
showNewCaseFormBtn.addEventListener('click', async () => {
  const willShow = newCaseForm.classList.contains('hidden');
  newCaseForm.classList.toggle('hidden');
  showNewCaseFormBtn.textContent = willShow ? '✕ Cancel' : '+ New case';
  showNewCaseFormBtn.classList.toggle('active', willShow);
  if (willShow) {
    const users = await fetchAssignableUsers();
    newCaseManagerSelect.innerHTML = '<option value="">Unassigned</option>';
    users.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u; opt.textContent = u;
      newCaseManagerSelect.appendChild(opt);
    });

    newCaseClientOrgSelect.innerHTML = '<option value="">(none)</option>';
    getCachedClientOrgs().forEach((org) => {
      const opt = document.createElement('option');
      opt.value = org.id; opt.textContent = org.name;
      newCaseClientOrgSelect.appendChild(opt);
    });
    newCaseClientSelect.innerHTML = '<option value="">(none)</option>';

    newCaseTypeSelect.innerHTML = '<option value="">(none)</option>';
    getCachedCaseTypes().forEach((ct) => {
      const opt = document.createElement('option');
      opt.value = ct.id; opt.textContent = ct.name;
      newCaseTypeSelect.appendChild(opt);
    });
  } else {
    newCaseForm.reset();
  }
});

newCaseClientOrgSelect.addEventListener('change', async () => {
  newCaseClientSelect.innerHTML = '<option value="">(none)</option>';
  if (!newCaseClientOrgSelect.value) return;
  const list = getCachedClientsForOrg(newCaseClientOrgSelect.value);
  list.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    newCaseClientSelect.appendChild(opt);
  });
});

function defaultArchivingWorkflow(template) {
  return (template || []).map((item) => ({ name: item.name, order: item.order, status: 'pending', executedBy: null, executedAt: null }));
}

newCaseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  newCaseError.textContent = '';
  const caseNumber = document.getElementById('newCaseNumber').value.trim();
  const clientCaseNumber = document.getElementById('newClientCaseNumber').value.trim();
  const name = document.getElementById('newCaseName').value.trim();
  const startDate = document.getElementById('newCaseStartDate').value;
  if (!caseNumber) { newCaseError.textContent = 'Case number is required.'; return; }
  // 0.4.1: caseManager is now optional at creation (flagged as a bug in
  // earlier testing that it was required up front) -- openedBy is set
  // automatically, never user-entered.
  const caseType = newCaseTypeSelect.value ? findCaseTypeById(newCaseTypeSelect.value) : null;
  try {
    await addDoc(collection(db, 'test_cases'), {
      caseNumber,
      clientCaseNumber: clientCaseNumber || null,
      name,
      client: newCaseClientSelect.value || null,
      startDate: startDate || null,
      caseManager: newCaseManagerSelect.value || null,
      openedBy: myProfile.username,
      caseType: newCaseTypeSelect.value || null,
      stage: 'new',
      writingStage: null,
      onHold: false,
      highPriority: false,
      showResearchToClient: false,
      dueDateOverride: null,
      // Snapshotted from the case type at creation time -- a later edit or
      // deletion of the case type itself doesn't retroactively change an
      // already-created case's own workflow content.
      labWorkflowTemplate: caseType ? (caseType.labWorkflowTemplate || []) : [],
      archivingWorkflow: defaultArchivingWorkflow(caseType ? caseType.archivingWorkflowTemplate : [])
    });
    newCaseForm.reset();
    newCaseForm.classList.add('hidden');
    showNewCaseFormBtn.textContent = '+ New case';
    showNewCaseFormBtn.classList.remove('active');
    loadCaseList();
  } catch (err) {
    newCaseError.textContent = `Couldn't create case: ${err.message}`;
  }
});

const STAGE_LABELS = { new: 'New', lab: 'Lab', write: 'Write', archive: 'Archive', done: 'Done' };
const STAGE_ORDER = ['new', 'lab', 'write', 'archive', 'done'];
function stageLabel(stage) { return STAGE_LABELS[stage] || stage; }

const WRITING_LABELS = {
  draft: 'Draft', leaderReview: 'Leader review', secondDraft: 'Second draft',
  orgManagerReview: 'Org manager review', published: 'Published'
};

// ---------------------------------------------------------------------
// Derived display fields -- see SPEC.md's "Case model" > "Derived /
// computed display fields."
// ---------------------------------------------------------------------
function onameOf(c) {
  return [c.caseNumber, c.clientCaseNumber, c.name].filter(Boolean).join(' - ');
}
function dayCounterOf(c) {
  if (!c.startDate) return null;
  const start = new Date(c.startDate + 'T00:00:00');
  const ms = Date.now() - start.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}
function dueDateOf(c) {
  if (c.dueDateOverride) return c.dueDateOverride;
  if (!c.startDate || !c.caseType) return null;
  const ct = findCaseTypeById(c.caseType);
  if (!ct || ct.tatGoalDays == null) return null;
  const d = new Date(c.startDate + 'T00:00:00');
  d.setDate(d.getDate() + ct.tatGoalDays);
  return d.toISOString().slice(0, 10);
}
// On-hold/research act as the status itself (replacing the plain stage
// name) rather than separate tags -- at the user's request, since a case
// that's on hold or under research isn't really "in New/Lab/..." in any
// way worth showing alongside a hold/research flag. High priority doesn't
// replace the status, just marks it with a star. On hold wins if a case
// is somehow both on hold and flagged for research, since "on hold" is
// the more blocking of the two states.
function effectiveStatusText(c) {
  const base = c.onHold ? 'On hold' : c.showResearchToClient ? 'Research' : stageLabel(c.stage);
  return c.highPriority ? `★ ${base}` : base;
}
// Header format (0.4.2, revised at the user's direct correction -- the
// "."s in their original shorthand meant line breaks, not literal
// separators on one line): three lines -- title; day, date, status;
// client -- rendered as separate elements, not periods on a single line.
// Third line has no "Client" label, just org - client (clientDisplayText,
// already used for the same pairing in the compact Info row). Case
// manager still dropped from the header entirely (see prior HANDOFF.md
// entry) -- still editable via the Info section.
function caseHeaderLines(c) {
  const dc = dayCounterOf(c);
  const dayText = dc == null ? '—' : `day ${dc}`;
  const line2 = [dayText, dueDateOf(c) || '—', effectiveStatusText(c)].join(', ');
  return [onameOf(c) || '(unnamed)', line2, clientDisplayText(c) || '—'];
}

// A plain worker executing/verifying the last action on someone else's
// case can't write to the case document itself under setup/firestore.rules
// (update = team_leader or that case's own caseManager only, unchanged
// from Iteration 4 -- see TASK.md's rules section #9). Rather than weaken
// that rule, stage auto-advances only actually fire when the current user
// is allowed to; otherwise they're caught up opportunistically the next
// time an authorized user (the case's team leader or manager) opens the
// case -- see the catch-up call in openCaseDetail. Logged as a judgment
// call in HANDOFF.md.
function canUpdateCase(c) {
  return myProfile.role === 'team_leader' || c.caseManager === myProfile.username;
}

async function loadCaseList() {
  caseTypeGroupsContainer.innerHTML = '<p class="muted">Loading…</p>';
  const q = myProfile.role === 'team_leader'
    ? query(collection(db, 'test_cases'), where('openedBy', '==', myProfile.username))
    : collection(db, 'test_cases');
  const snap = await getDocs(q);
  cases = [];
  snap.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  cases.sort((a, b) => (a.caseNumber || '').localeCompare(b.caseNumber || ''));
  renderCaseTypeGroups();
}

// Cases screen groups by case type (each type gets its own card, titled
// with the type's own name instead of a generic "Cases" heading) rather
// than one flat list -- at the user's request. Cases with no case type
// set land in their own "No case type" group, sorted last.
function groupCasesByType(caseList) {
  const groups = new Map();
  caseList.forEach((c) => {
    const key = c.caseType || '__none__';
    if (!groups.has(key)) {
      const name = c.caseType ? (findCaseTypeById(c.caseType)?.name || 'Unknown type') : 'No case type';
      groups.set(key, { name, cases: [] });
    }
    groups.get(key).cases.push(c);
  });
  return groups;
}

function renderCaseTypeGroups() {
  caseTypeGroupsContainer.innerHTML = '';
  if (cases.length === 0) {
    caseTypeGroupsContainer.innerHTML = '<p class="muted">No cases yet.</p>';
    return;
  }
  const groups = Array.from(groupCasesByType(cases).values()).sort((a, b) => {
    if (a.name === 'No case type') return 1;
    if (b.name === 'No case type') return -1;
    return a.name.localeCompare(b.name);
  });
  groups.forEach((group) => caseTypeGroupsContainer.appendChild(buildTypeCard(group)));
}

function buildTypeCard(group) {
  const card = document.createElement('div');
  card.className = 'card type-card';
  const h2 = document.createElement('h2');
  h2.textContent = group.name;
  card.appendChild(h2);
  group.cases.forEach((c, idx) => card.appendChild(renderCaseRow(c, idx + 1)));
  return card;
}

// Two-line row: top is the numbered oname (case# - client case# - name),
// bottom splits worker/day-count/due-date (left) from stage (right) --
// replaces the old single pipe-delimited line. Team leaders also get a
// delete icon on the row itself (0.4.2), matching the delete control in
// case view -- same cascade delete, same team_leader-only gating.
function renderCaseRow(c, number) {
  const row = document.createElement('div');
  row.className = 'case-row-item';

  const content = document.createElement('div');
  content.className = 'case-row-content';

  const top = document.createElement('div');
  top.className = 'case-row-top';
  top.textContent = `${number}. ${onameOf(c) || '(unnamed)'}`;
  // On-hold/priority no longer get separate badges here -- they're folded
  // into the status text on the right instead (see effectiveStatusText()).

  const bottom = document.createElement('div');
  bottom.className = 'case-row-bottom';

  const dc = dayCounterOf(c);
  const meta = document.createElement('div');
  meta.className = 'case-row-meta';
  meta.textContent = `${c.caseManager || 'Unassigned'} | ${dc == null ? '—' : `day ${dc}`} | ${dueDateOf(c) || '—'}`;

  const status = document.createElement('div');
  status.className = 'case-row-status';
  if (c.highPriority) status.classList.add('status-priority');
  status.textContent = effectiveStatusText(c);

  bottom.append(meta, status);
  content.append(top, bottom);
  row.appendChild(content);
  row.addEventListener('click', () => openCaseDetail(c.id));

  if (myProfile.role === 'team_leader') {
    row.appendChild(buildCaseRowDeleteControl(c));
  }

  return row;
}

function buildCaseRowDeleteControl(c) {
  const wrap = document.createElement('div');
  wrap.className = 'case-row-delete';
  // Swallow all clicks inside (icon, confirm, cancel) so they never bubble
  // to the row's own click handler and open the case instead.
  wrap.addEventListener('click', (e) => e.stopPropagation());

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn icon-btn-danger icon-btn-small';
  btn.title = 'Delete case'; btn.setAttribute('aria-label', 'Delete case');
  btn.innerHTML = TRASH_ICON_SVG;
  wrap.appendChild(btn);

  btn.addEventListener('click', () => {
    if (wrap.querySelector('.confirm-row')) return;
    const confirmRow = document.createElement('div');
    confirmRow.className = 'confirm-row';
    confirmRow.style.cssText = 'position:absolute; right:0; top:34px; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px; width:220px; z-index:5;';
    const msg = document.createElement('p'); msg.className = 'error'; msg.style.margin = '0 0 8px';
    msg.textContent = 'Permanently delete this case?';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Confirm delete';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '8px';
    cancelBtn.addEventListener('click', () => confirmRow.remove());
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      await deleteCaseCascade(c.id);
      await loadCaseList();
    });
    confirmRow.append(msg, confirmBtn, cancelBtn);
    wrap.appendChild(confirmRow);
  });

  return wrap;
}

backToCasesBtn.addEventListener('click', () => {
  caseDetailScreen.classList.add('hidden');
  casesScreen.classList.remove('hidden');
  loadCaseList();
});

toggleNotesBtn.addEventListener('click', async () => {
  notesShown = !notesShown;
  toggleNotesBtn.classList.toggle('active', notesShown);
  toggleNotesBtn.title = notesShown ? 'Back to case' : 'Notes';
  toggleNotesBtn.setAttribute('aria-label', toggleNotesBtn.title);
  caseMainView.classList.toggle('hidden', notesShown);
  caseNotesView.classList.toggle('hidden', !notesShown);
  if (notesShown) await renderNotesView(currentCaseId);
});

// Edit info now lives in the case-detail header (0.4.2) rather than inline
// above the Info section -- see buildInfoSection.
editInfoBtn.addEventListener('click', () => {
  infoEditMode = !infoEditMode;
  editInfoBtn.classList.toggle('active', infoEditMode);
  renderCaseDetail(currentCaseId);
});

// Case deletion, moved from a text button at the bottom of the workflow
// section into the header (0.4.2), next to the edit icon. Same cascade
// delete as before, same team_leader-only gating (enforced both by
// deleteCaseBtn's visibility below and by setup/firestore.rules).
deleteCaseBtn.addEventListener('click', () => {
  const existing = document.getElementById('caseDeleteConfirm');
  if (existing) { existing.remove(); return; }
  const bar = document.createElement('div');
  bar.id = 'caseDeleteConfirm';
  bar.className = 'confirm-row';
  bar.style.margin = '0 0 16px';
  const msg = document.createElement('p'); msg.className = 'error';
  msg.textContent = 'This permanently deletes the case and everything in it. This cannot be undone.';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Confirm delete';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '8px';
  cancelBtn.addEventListener('click', () => bar.remove());
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    await deleteCaseCascade(currentCaseId);
    caseDetailScreen.classList.add('hidden');
    casesScreen.classList.remove('hidden');
    loadCaseList();
  });
  bar.append(msg, confirmBtn, cancelBtn);
  document.querySelector('.case-detail-header').insertAdjacentElement('afterend', bar);
});

let currentCaseId = null;

async function openCaseDetail(caseId) {
  currentCaseId = caseId;
  infoEditMode = false;
  expandedSamples = new Set();
  notesShown = false;
  viewedStage = null;
  toggleNotesBtn.classList.remove('active');
  toggleNotesBtn.title = 'Notes';
  toggleNotesBtn.setAttribute('aria-label', 'Notes');
  editInfoBtn.classList.remove('active');
  const existingConfirm = document.getElementById('caseDeleteConfirm');
  if (existingConfirm) existingConfirm.remove();
  caseMainView.classList.remove('hidden');
  caseNotesView.classList.add('hidden');
  casesScreen.classList.add('hidden');
  caseDetailScreen.classList.remove('hidden');
  caseMainView.innerHTML = '<p class="muted">Loading…</p>';
  await renderCaseDetail(caseId);
}

async function saveCaseField(caseId, field, value) {
  await updateDoc(doc(db, 'test_cases', caseId), { [field]: value });
}

// Catches up any stage transition a plain worker couldn't itself write
// (see canUpdateCase above), plus runs the ordinary auto-advance checks.
async function runAutoAdvanceChecks(caseId, c, samples) {
  if (!canUpdateCase(c)) return;
  if (c.stage === 'lab') await maybeAutoAdvanceToWrite(caseId, samples);
  if (c.stage === 'archive') await maybeAutoAdvanceToDone(caseId, c);
}

async function renderCaseDetail(caseId) {
  const caseSnap = await getDoc(doc(db, 'test_cases', caseId));
  if (!caseSnap.exists()) {
    caseMainView.innerHTML = '<p class="error">Case not found.</p>';
    return;
  }
  const c = { id: caseId, ...caseSnap.data() };

  const samplesSnap = await getDocs(collection(db, 'test_cases', caseId, 'test_samples'));
  const samples = [];
  for (const sDoc of samplesSnap.docs) {
    const actionsSnap = await getDocs(collection(db, 'test_cases', caseId, 'test_samples', sDoc.id, 'test_actions'));
    const actions = [];
    actionsSnap.forEach((aDoc) => actions.push({ id: aDoc.id, ...aDoc.data() }));
    samples.push({ id: sDoc.id, ...sDoc.data(), actions });
  }
  samples.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  await runAutoAdvanceChecks(caseId, c, samples);
  // Re-read after a possible auto-advance so the rendered stage is current.
  const freshSnap = await getDoc(doc(db, 'test_cases', caseId));
  const cFresh = { id: caseId, ...freshSnap.data() };

  caseDetailTitle.innerHTML = '';
  caseHeaderLines(cFresh).forEach((line) => {
    const lineEl = document.createElement('div');
    lineEl.textContent = line;
    caseDetailTitle.appendChild(lineEl);
  });
  editInfoBtn.classList.toggle('hidden', !canUpdateCase(cFresh));
  editInfoBtn.classList.toggle('active', infoEditMode);
  deleteCaseBtn.classList.toggle('hidden', myProfile.role !== 'team_leader');
  caseMainView.innerHTML = '';
  const infoSection = buildInfoSection(cFresh);
  if (infoSection) caseMainView.appendChild(infoSection);
  caseMainView.appendChild(buildWorkflowSection(cFresh, samples));
  caseMainView.appendChild(buildSamplesSection(cFresh, samples));
}

// ---------------------------------------------------------------------
// Info section -- compact (default) vs full/editable, toggled via the
// header's edit icon (editInfoBtn). Scope is the case's own info fields
// only, never samples or workflow (see SPEC.md's "Case info display").
// ---------------------------------------------------------------------
function clientDisplayText(c) {
  if (!c.client) return null;
  const client = findClientById(c.client);
  if (!client) return null;
  const org = findClientOrgById(client.clientOrgId);
  return org ? `${org.name} — ${client.name}` : client.name;
}

function buildInfoSection(c) {
  const canEdit = myProfile.role === 'team_leader' || c.caseManager === myProfile.username;

  // Compact view is now nothing at all: case number/client case number/
  // name/due date/client were all already visible in the case header above
  // (see caseHeaderLines(), whose 3rd line covers client -- the standalone
  // "Client" row here was dropped as pure redundancy, at the user's
  // request). Case manager isn't in the header but also isn't shown
  // compact -- only via full edit. On-hold/research/high-priority no
  // longer show as a separate checklist either -- they're folded into the
  // status text itself now (see effectiveStatusText()). Full editing (all
  // fields, all toggles) is still available via the header's edit icon --
  // the compact view just has nothing left to summarize on its own.
  if (!infoEditMode || !canEdit) return null;

  const section = document.createElement('div');
  section.className = 'case-section';

  // Full/editable view.
  const grid = document.createElement('div');
  grid.className = 'case-grid';

  const caseNumInput = document.createElement('input');
  caseNumInput.className = 'mono';
  caseNumInput.value = c.caseNumber || '';
  const caseNumWarn = document.createElement('div'); caseNumWarn.className = 'warn-text hidden';
  function refreshCaseNumWarn() {
    const msg = validateCaseNumberShape(caseNumInput.value.trim());
    caseNumWarn.textContent = msg || '';
    caseNumWarn.classList.toggle('hidden', !msg);
  }
  refreshCaseNumWarn();
  caseNumInput.addEventListener('input', refreshCaseNumWarn);
  caseNumInput.addEventListener('change', () => saveCaseField(c.id, 'caseNumber', caseNumInput.value.trim()));
  grid.appendChild(fieldRow('Case number', caseNumInput, caseNumWarn));

  const clientNumInput = document.createElement('input');
  clientNumInput.className = 'mono';
  clientNumInput.value = c.clientCaseNumber || '';
  const clientNumWarn = document.createElement('div'); clientNumWarn.className = 'warn-text hidden';
  function refreshClientNumWarn() {
    const msg = validateCaseNumberShape(clientNumInput.value.trim());
    clientNumWarn.textContent = msg || '';
    clientNumWarn.classList.toggle('hidden', !msg);
  }
  refreshClientNumWarn();
  clientNumInput.addEventListener('input', refreshClientNumWarn);
  clientNumInput.addEventListener('change', () => saveCaseField(c.id, 'clientCaseNumber', clientNumInput.value.trim() || null));
  grid.appendChild(fieldRow('Client case number', clientNumInput, clientNumWarn));

  grid.appendChild(textField('Name', c.name, 'text', (v) => saveCaseField(c.id, 'name', v)));
  grid.appendChild(textField('Start date', c.startDate, 'date', (v) => saveCaseField(c.id, 'startDate', v || null)));
  grid.appendChild(textField('Due date override', c.dueDateOverride, 'date', (v) => saveCaseField(c.id, 'dueDateOverride', v || null)));

  const orgSelect = document.createElement('select');
  const clientSelect = document.createElement('select');
  const existingClient = c.client ? findClientById(c.client) : null;
  orgSelect.innerHTML = '<option value="">(none)</option>';
  getCachedClientOrgs().forEach((org) => {
    const opt = document.createElement('option');
    opt.value = org.id; opt.textContent = org.name;
    if (existingClient && existingClient.clientOrgId === org.id) opt.selected = true;
    orgSelect.appendChild(opt);
  });
  function refreshClientOptions(selectClientId) {
    clientSelect.innerHTML = '<option value="">(none)</option>';
    if (!orgSelect.value) return;
    getCachedClientsForOrg(orgSelect.value).forEach((cl) => {
      const opt = document.createElement('option');
      opt.value = cl.id; opt.textContent = cl.name;
      if (cl.id === selectClientId) opt.selected = true;
      clientSelect.appendChild(opt);
    });
  }
  refreshClientOptions(c.client);
  orgSelect.addEventListener('change', () => refreshClientOptions(null));
  clientSelect.addEventListener('change', () => saveCaseField(c.id, 'client', clientSelect.value || null));
  grid.appendChild(fieldRow('Client org', orgSelect));
  grid.appendChild(fieldRow('Client', clientSelect));

  const caseTypeSelect = document.createElement('select');
  caseTypeSelect.innerHTML = '<option value="">(none)</option>';
  getCachedCaseTypes().forEach((ct) => {
    const opt = document.createElement('option');
    opt.value = ct.id; opt.textContent = ct.name;
    if (ct.id === c.caseType) opt.selected = true;
    caseTypeSelect.appendChild(opt);
  });
  caseTypeSelect.addEventListener('change', () => saveCaseField(c.id, 'caseType', caseTypeSelect.value || null));
  grid.appendChild(fieldRow('Case type', caseTypeSelect));

  const managerSelect = document.createElement('select');
  managerSelect.innerHTML = '<option value="">Unassigned</option>';
  fetchAssignableUsers().then((users) => {
    users.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u; opt.textContent = u;
      if (u === c.caseManager) opt.selected = true;
      managerSelect.appendChild(opt);
    });
  });
  managerSelect.addEventListener('change', () => saveCaseField(c.id, 'caseManager', managerSelect.value || null));
  grid.appendChild(fieldRow('Case manager', managerSelect));

  section.appendChild(grid);

  const toggles = document.createElement('div');
  toggles.className = 'case-toggles';
  toggles.appendChild(checkboxField('On hold', c.onHold, (v) => saveCaseField(c.id, 'onHold', v)));
  toggles.appendChild(checkboxField('High priority', c.highPriority, (v) => saveCaseField(c.id, 'highPriority', v)));
  toggles.appendChild(checkboxField('Show research to client', c.showResearchToClient, (v) => saveCaseField(c.id, 'showResearchToClient', v)));
  section.appendChild(toggles);

  return section;
}

function fieldRow(labelText, inputEl, warnEl) {
  const wrap = document.createElement('div');
  wrap.className = 'case-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  if (warnEl) wrap.appendChild(warnEl);
  return wrap;
}
function checkboxField(labelText, checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'checkbox-inline';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.append(' ' + labelText);
  return wrap;
}
function textField(labelText, value, type, onSave) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  input.addEventListener('change', () => onSave(input.value.trim()));
  return fieldRow(labelText, input);
}

// ---------------------------------------------------------------------
// Workflow section -- the case's own stage progress (new -> lab -> write
// -> archive -> done), the write stage's nested writing workflow, the
// archiving workflow's items, and case deletion (any stage, team-leader
// judgment call -- see SPEC.md's "Case lifecycle").
// ---------------------------------------------------------------------
function isActionComplete(a) {
  return a.status === true && (a.type !== 'verified' || !!a.verifiedBy);
}

async function maybeAutoAdvanceToWrite(caseId, samples) {
  if (samples.length === 0) return;
  for (const s of samples) {
    if (s.actions.length === 0) return;
    for (const a of s.actions) {
      if (!isActionComplete(a)) return;
    }
  }
  await updateDoc(doc(db, 'test_cases', caseId), { stage: 'write', writingStage: 'draft' });
}

async function maybeAutoAdvanceToDone(caseId, c) {
  const items = c.archivingWorkflow || [];
  if (items.length === 0) return;
  if (items.every((it) => it.status === 'done')) {
    await updateDoc(doc(db, 'test_cases', caseId), { stage: 'done' });
  }
}

// See canUpdateCase's note above -- adding a sample/action, or reopening
// a completed one, pulls a case back from `write` to `lab` if it had
// already auto-advanced there (SPEC.md's reversibility rule). Only fires
// for whoever's allowed to write to the case doc; otherwise it's caught
// up next time an authorized user opens the case (same pattern as the
// forward auto-advances above).
async function reopenToLabIfNeeded(caseId) {
  const snap = await getDoc(doc(db, 'test_cases', caseId));
  if (!snap.exists()) return;
  const c = snap.data();
  if (c.stage === 'write' && canUpdateCase({ id: caseId, ...c })) {
    await updateDoc(doc(db, 'test_cases', caseId), { stage: 'lab', writingStage: null });
  }
}

// Stage flow: a row of named, clickable circles (New/Lab/Write/Archive/
// Done), at the user's request replacing the plain "Workflow — {stage}"
// text heading. Clicking a circle sets `viewedStage` and re-renders --
// this only changes which stage's panel is *displayed* below, never the
// case's real `stage` field. The real current stage still drives which
// panel shows its live, interactive controls (see buildWorkflowSection);
// any other circle shows a read-only preview instead, so browsing past/
// future stages can't accidentally trigger a real transition out of turn.
function buildStageFlow(c, effectiveViewed) {
  const wrap = document.createElement('div');
  wrap.className = 'stage-flow';
  const currentIdx = STAGE_ORDER.indexOf(c.stage);
  STAGE_ORDER.forEach((stage, idx) => {
    if (idx > 0) {
      const line = document.createElement('div');
      line.className = 'stage-flow-line';
      if (idx <= currentIdx) line.classList.add('done');
      wrap.appendChild(line);
    }
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'stage-flow-node';
    if (idx < currentIdx) node.classList.add('done');
    if (stage === c.stage) node.classList.add('current');
    if (stage === effectiveViewed) node.classList.add('viewed');
    node.textContent = stageLabel(stage);
    node.title = stageLabel(stage) + (stage === c.stage ? ' (current stage)' : '');
    if (stage === c.stage) node.setAttribute('aria-current', 'step');
    node.addEventListener('click', () => { viewedStage = stage; renderCaseDetail(c.id); });
    wrap.appendChild(node);
  });
  return wrap;
}

function readonlyNote(text) {
  const p = document.createElement('p'); p.className = 'muted';
  p.textContent = text;
  return p;
}

function buildWorkflowSection(c, samples) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Workflow';
  section.appendChild(h3);

  const effectiveViewed = viewedStage || c.stage;
  section.appendChild(buildStageFlow(c, effectiveViewed));

  const editAllowed = canUpdateCase(c);
  const isCurrentStage = effectiveViewed === c.stage;

  if (effectiveViewed === 'new') {
    if (!isCurrentStage) {
      section.appendChild(readonlyNote(c.startDate ? `Case opened ${c.startDate}.` : 'Case opened here.'));
    } else {
      if (samples.length === 0) {
        section.appendChild(readonlyNote('Add at least one sample before starting lab.'));
      }
      // Exits `new` via an explicit team-leader confirmation only -- not
      // gated on field-completeness (SPEC.md's "Case lifecycle").
      if (myProfile.role === 'team_leader') {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary'; btn.textContent = 'Start lab';
        btn.disabled = samples.length === 0;
        btn.addEventListener('click', async () => {
          await updateDoc(doc(db, 'test_cases', c.id), { stage: 'lab' });
          await renderCaseDetail(c.id);
        });
        section.appendChild(btn);
      }
    }
  } else if (effectiveViewed === 'lab') {
    // Aggregate summary is safe to show regardless of stage (no buttons).
    // The actual per-sample action list -- execute/verify/reopen, add
    // action -- is the real action-execution surface (moved here from the
    // samples section entirely, per the user's request via TASK.md) and
    // only renders when lab is genuinely the case's current stage, same
    // read-only-elsewhere rule as every other stage's live controls.
    const totalActions = samples.reduce((sum, s) => sum + s.actions.length, 0);
    const doneActions = samples.reduce((sum, s) => sum + s.actions.filter(isActionComplete).length, 0);
    const completeSamples = samples.filter((s) => s.actions.length > 0 && s.actions.every(isActionComplete)).length;
    section.appendChild(readonlyNote(`${completeSamples}/${samples.length} samples complete (${doneActions}/${totalActions} actions done). Moves to Write automatically once every sample's actions are done (verified-type actions need sign-off too).`));
    if (isCurrentStage) {
      samples.forEach((s) => section.appendChild(buildSampleActionsCard(c, s)));
    } else if (samples.length > 0) {
      section.appendChild(readonlyNote("This isn't the case's current stage -- actions can only be executed or verified while Lab is active."));
    }
  } else if (effectiveViewed === 'write') {
    if (c.writingStage == null) {
      section.appendChild(readonlyNote('Not reached yet.'));
    } else if (isCurrentStage) {
      section.appendChild(buildWritingWorkflow(c, editAllowed));
    } else {
      section.appendChild(readonlyNote(`Writing stage: ${WRITING_LABELS[c.writingStage] || c.writingStage}`));
    }
  } else if (effectiveViewed === 'archive') {
    // buildArchivingWorkflow(c, false) already suppresses every button
    // (remove/mark-done/add-step) -- reused as-is for the read-only
    // preview, real interactive controls only when archive is current.
    section.appendChild(buildArchivingWorkflow(c, isCurrentStage && editAllowed));
  } else if (effectiveViewed === 'done') {
    section.appendChild(readonlyNote(isCurrentStage ? 'This case is done.' : 'Not reached yet.'));
  }

  return section;
}

// Provisional simplification per SPEC.md, flagged there as not fully
// confirmed: "back" from either review is a plain two-step loop (revise,
// then re-review), no hard cap, and org-manager-review's back is assumed
// to land on secondDraft (same as leaderReview's back), matching "same as
// leader review's back" in SPEC.md.
function buildWritingWorkflow(c, editAllowed) {
  const wrap = document.createElement('div');
  const p = document.createElement('p'); p.className = 'muted';
  p.textContent = `Writing stage: ${WRITING_LABELS[c.writingStage] || c.writingStage}`;
  wrap.appendChild(p);

  if (!editAllowed) return wrap;

  async function setWritingStage(stage) {
    await updateDoc(doc(db, 'test_cases', c.id), { writingStage: stage });
    await renderCaseDetail(c.id);
  }
  async function publish() {
    await updateDoc(doc(db, 'test_cases', c.id), { writingStage: 'published', stage: 'archive' });
    await renderCaseDetail(c.id);
  }

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex'; btnRow.style.gap = '8px'; btnRow.style.flexWrap = 'wrap';

  if (c.writingStage === 'draft') {
    const btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = 'Send to leader review';
    btn.addEventListener('click', () => setWritingStage('leaderReview'));
    btnRow.appendChild(btn);
  } else if (c.writingStage === 'leaderReview') {
    const back = document.createElement('button'); back.className = 'btn'; back.textContent = 'Back to draft (revise)';
    back.addEventListener('click', () => setWritingStage('draft'));
    const advance = document.createElement('button'); advance.className = 'btn btn-primary'; advance.textContent = 'Advance to second draft';
    advance.addEventListener('click', () => setWritingStage('secondDraft'));
    btnRow.append(back, advance);
  } else if (c.writingStage === 'secondDraft') {
    const btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = 'Send to org manager review';
    btn.addEventListener('click', () => setWritingStage('orgManagerReview'));
    btnRow.appendChild(btn);
  } else if (c.writingStage === 'orgManagerReview') {
    const back = document.createElement('button'); back.className = 'btn'; back.textContent = 'Back to second draft (revise)';
    back.addEventListener('click', () => setWritingStage('secondDraft'));
    const pub = document.createElement('button'); pub.className = 'btn btn-primary'; pub.textContent = 'Publish';
    pub.addEventListener('click', publish);
    btnRow.append(back, pub);
  }
  wrap.appendChild(btnRow);
  return wrap;
}

function buildArchivingWorkflow(c, editAllowed) {
  const wrap = document.createElement('div');
  const items = c.archivingWorkflow || [];
  items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => a.item.order - b.item.order)
    .forEach(({ item, idx }) => wrap.appendChild(buildArchivingItemRow(c, item, idx, editAllowed)));

  if (editAllowed) {
    const addForm = document.createElement('form');
    addForm.className = 'add-row';
    const nameInput = document.createElement('input'); nameInput.placeholder = 'New step name'; nameInput.required = true;
    const orderInput = document.createElement('input'); orderInput.type = 'number'; orderInput.placeholder = 'Order'; orderInput.style.maxWidth = '80px';
    const nameField = document.createElement('div'); nameField.className = 'field'; nameField.appendChild(nameInput);
    const orderField = document.createElement('div'); orderField.className = 'field'; orderField.appendChild(orderInput);
    const addBtn = document.createElement('button'); addBtn.type = 'submit'; addBtn.className = 'btn btn-small'; addBtn.textContent = 'Add step';
    addForm.append(nameField, orderField, addBtn);
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      const maxOrder = items.length ? Math.max(...items.map((i) => i.order)) : 0;
      const order = orderInput.value ? parseInt(orderInput.value, 10) : maxOrder + 1;
      const updated = [...items, { name, order, status: 'pending', executedBy: null, executedAt: null }];
      await updateDoc(doc(db, 'test_cases', c.id), { archivingWorkflow: updated });
      await renderCaseDetail(c.id);
    });
    wrap.appendChild(addForm);
  }
  return wrap;
}

function buildArchivingItemRow(c, item, idx, editAllowed) {
  const row = document.createElement('div');
  row.className = 'action-row';
  const label = document.createElement('span');
  label.textContent = item.name + (item.status === 'done' ? ' — done' : '');
  row.appendChild(label);

  const controls = document.createElement('span');
  if (editAllowed) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'btn btn-small'; removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      const updated = c.archivingWorkflow.filter((_, i) => i !== idx);
      await updateDoc(doc(db, 'test_cases', c.id), { archivingWorkflow: updated });
      await renderCaseDetail(c.id);
    });
    controls.appendChild(removeBtn);

    if (item.status !== 'done') {
      const execBtn = document.createElement('button');
      execBtn.type = 'button'; execBtn.className = 'btn btn-small btn-primary'; execBtn.textContent = 'Mark done';
      execBtn.style.marginLeft = '6px';
      execBtn.addEventListener('click', async () => {
        const updated = c.archivingWorkflow.map((it, i) => (i === idx ? { ...it, status: 'done', executedBy: myProfile.username, executedAt: new Date() } : it));
        await updateDoc(doc(db, 'test_cases', c.id), { archivingWorkflow: updated });
        await renderCaseDetail(c.id);
      });
      controls.appendChild(execBtn);
    }
  }
  row.appendChild(controls);
  return row;
}

// Firestore doesn't cascade-delete subcollections -- every sample,
// action, and note doc has to be deleted individually before the case
// doc itself.
async function deleteCaseCascade(caseId) {
  const samplesSnap = await getDocs(collection(db, 'test_cases', caseId, 'test_samples'));
  for (const sDoc of samplesSnap.docs) {
    const actionsSnap = await getDocs(collection(db, 'test_cases', caseId, 'test_samples', sDoc.id, 'test_actions'));
    for (const aDoc of actionsSnap.docs) {
      await deleteDoc(doc(db, 'test_cases', caseId, 'test_samples', sDoc.id, 'test_actions', aDoc.id));
    }
    await deleteDoc(doc(db, 'test_cases', caseId, 'test_samples', sDoc.id));
  }
  const notesSnap = await getDocs(collection(db, 'test_cases', caseId, 'notes'));
  for (const nDoc of notesSnap.docs) {
    await deleteDoc(doc(db, 'test_cases', caseId, 'notes', nDoc.id));
  }
  await deleteDoc(doc(db, 'test_cases', caseId));
}

// ---------------------------------------------------------------------
// Samples + their actions. `item` (renamed from `groupName`, 0.4.1) is
// the optional label above a sample; `sample` is the only mandatory unit.
// Each sample has a compact (default) and full (expanded) view.
// ---------------------------------------------------------------------
function defaultSampleActions(template) {
  return (template && template.length ? template : []).map((t) => ({
    name: t.name, zone: null, type: t.type || 'simple', notes: '',
    environment: [], calibration: [], measurements: [],
    status: false, executedBy: null, executionTimestamp: null,
    verifiedBy: null, verificationTimestamp: null, verifiedMeasurements: []
  }));
}

// Repeatable named-row editor -- one text input per row, used for both
// the batch-add view's sample-name list and its zone list. Reuses
// .value-row's flex/wrap styling (built for the action value editors)
// since a single-input row fits that layout fine too.
function buildNameListEditor(addButtonLabel, placeholder) {
  const wrap = document.createElement('div');
  const rows = document.createElement('div');
  wrap.appendChild(rows);
  function addRow() {
    const row = document.createElement('div'); row.className = 'value-row';
    const input = document.createElement('input'); input.placeholder = placeholder;
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn btn-small'; rm.textContent = '✕';
    rm.addEventListener('click', () => row.remove());
    row.append(input, rm);
    rows.appendChild(row);
    input.focus();
  }
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-small'; addBtn.textContent = addButtonLabel;
  addBtn.addEventListener('click', addRow);
  wrap.appendChild(addBtn);
  wrap.getValues = () => Array.from(rows.querySelectorAll('input')).map((i) => i.value.trim()).filter(Boolean);
  return wrap;
}

// Batch add view (0.4.1 redesign, at the user's request): a toggled panel
// instead of an always-open inline form. Set an item name and optionally
// list out specific sample names -- if none are listed, the item itself is
// treated as a single sample. Zones are entered via repeatable named rows
// instead of a comma-separated string. No "number of copies" field
// (dropped at the user's request, 2026-09-22) -- making several similar
// samples is now done by duplicating an existing one instead (see
// buildSampleStructureCard's duplicate icon).
function buildSamplesSection(c, samples) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Samples';
  section.appendChild(h3);

  const addToggleBtn = document.createElement('button');
  addToggleBtn.type = 'button';
  addToggleBtn.className = 'btn btn-primary btn-small';
  addToggleBtn.textContent = '+ Add';
  section.appendChild(addToggleBtn);

  const addView = document.createElement('div');
  addView.className = 'add-samples-view hidden';

  const topRow = document.createElement('div'); topRow.className = 'add-row';
  const itemField = document.createElement('div'); itemField.className = 'field';
  const itemLabel = document.createElement('label'); itemLabel.textContent = 'Item name';
  const itemInput = document.createElement('input');
  itemField.append(itemLabel, itemInput);
  topRow.append(itemField);
  addView.appendChild(topRow);

  const samplesLabel = document.createElement('label');
  samplesLabel.textContent = 'Samples (optional -- leave empty to treat the whole item as one sample)';
  addView.appendChild(samplesLabel);
  const sampleListEditor = buildNameListEditor('+ Add sample', 'Sample name');
  addView.appendChild(sampleListEditor);

  const zonesLabel = document.createElement('label');
  zonesLabel.textContent = 'Zones (optional)';
  addView.appendChild(zonesLabel);
  const zoneListEditor = buildNameListEditor('+ Set zone', 'Zone name');
  addView.appendChild(zoneListEditor);

  const createBtn = document.createElement('button');
  createBtn.type = 'button'; createBtn.className = 'btn btn-primary'; createBtn.textContent = 'Create';
  createBtn.style.marginTop = '10px';
  addView.appendChild(createBtn);
  const err = document.createElement('div'); err.className = 'error'; addView.appendChild(err);

  section.appendChild(addView);

  addToggleBtn.addEventListener('click', () => {
    const willShow = addView.classList.contains('hidden');
    addView.classList.toggle('hidden');
    addToggleBtn.textContent = willShow ? '✕ Cancel' : '+ Add';
    addToggleBtn.classList.toggle('active', willShow);
  });

  createBtn.addEventListener('click', async () => {
    err.textContent = '';
    const itemName = itemInput.value.trim() || null;
    const zones = zoneListEditor.getValues();
    const sampleNames = sampleListEditor.getValues();

    if (sampleNames.length === 0 && !itemName) {
      err.textContent = 'Enter an item name, or add at least one sample.';
      return;
    }

    createBtn.disabled = true;
    try {
      // No named samples: the whole item is one sample, not a group of
      // one -- no separate `item` grouping label makes sense there.
      const entries = sampleNames.length > 0
        ? sampleNames.map((name) => ({ item: itemName, name }))
        : [{ item: null, name: itemName }];

      for (const entry of entries) {
        const sampleRef = await addDoc(collection(db, 'test_cases', c.id, 'test_samples'), { item: entry.item, name: entry.name, zones });
        for (const action of defaultSampleActions(c.labWorkflowTemplate)) {
          await addDoc(collection(db, 'test_cases', c.id, 'test_samples', sampleRef.id, 'test_actions'), action);
        }
      }
      await reopenToLabIfNeeded(c.id);
      await renderCaseDetail(c.id);
    } catch (ex) {
      err.textContent = `Couldn't add sample(s): ${ex.message}`;
      createBtn.disabled = false;
    }
  });

  samples.forEach((s) => section.appendChild(buildSampleStructureCard(c, s)));
  return section;
}

// Split 2026-09-22 (at the user's request, via TASK.md): the samples
// section shows structure only (item/sample/zone) -- no action execution,
// verification, or status content, which lives exclusively in the
// workflow section's lab panel now (see buildSampleActionsCard below).
// Both functions share `expandedSamples` as their expand/collapse state,
// so expanding a sample in one section expands its counterpart too.
function buildSampleStructureCard(c, s) {
  const card = document.createElement('div');
  card.className = 'sample-card';
  const expanded = expandedSamples.has(s.id);

  const header = document.createElement('div');
  header.className = 'sample-card-header';
  const title = document.createElement('strong');
  title.textContent = s.item ? `${s.item} - ${s.name}` : s.name;
  const toggle = document.createElement('span');
  toggle.className = 'muted';
  toggle.textContent = expanded ? '▲' : '▼';
  header.append(title, toggle);
  header.addEventListener('click', () => {
    if (expandedSamples.has(s.id)) expandedSamples.delete(s.id); else expandedSamples.add(s.id);
    renderCaseDetail(c.id);
  });
  card.appendChild(header);

  if (!expanded) return card;

  // Zones display + per-sample add-zone control (0.4.1 follow-up: zones
  // are set per sample directly, not only at batch-creation time).
  const zonesRow = document.createElement('div');
  zonesRow.style.display = 'flex'; zonesRow.style.alignItems = 'center'; zonesRow.style.gap = '8px'; zonesRow.style.flexWrap = 'wrap';
  const zonesText = document.createElement('span'); zonesText.className = 'muted';
  zonesText.textContent = s.zones && s.zones.length ? 'Zones: ' + s.zones.join(', ') : 'No zones yet';
  const addZoneBtn = document.createElement('button');
  addZoneBtn.type = 'button'; addZoneBtn.className = 'btn btn-small'; addZoneBtn.textContent = '+ Zone';
  zonesRow.append(zonesText, addZoneBtn);
  card.appendChild(zonesRow);

  addZoneBtn.addEventListener('click', () => {
    if (card.querySelector('.add-zone-form')) return;
    const form = document.createElement('div');
    form.className = 'add-zone-form';
    form.style.display = 'flex'; form.style.gap = '6px'; form.style.marginTop = '6px';
    const input = document.createElement('input'); input.placeholder = 'Zone name';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Add';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel';
    form.append(input, confirmBtn, cancelBtn);
    zonesRow.after(form);
    input.focus();
    cancelBtn.addEventListener('click', () => form.remove());
    confirmBtn.addEventListener('click', async () => {
      const zoneName = input.value.trim();
      if (!zoneName) return;
      confirmBtn.disabled = true;
      await updateDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id), { zones: [...(s.zones || []), zoneName] });
      await renderCaseDetail(c.id);
    });
  });

  // Duplicate + Delete -- common per-sample actions, shown as small icon
  // buttons rather than text (at the user's request, 2026-09-22: "for
  // common actions use icons"), matching the icon-btn pattern already used
  // for the case-detail header and overview row (TRASH_ICON_SVG etc.).
  // Duplicate is open to any case staff (same write permission as adding a
  // sample) -- copies item/name/zones and seeds fresh default actions,
  // exactly like creating a new sample, just pre-filled. Delete stays
  // team_leader-only, matching setup/firestore.rules' samples delete rule
  // (unchanged from Iteration 4); it cascade-deletes the sample's own
  // actions first, same reasoning as case deletion: Firestore doesn't
  // cascade subcollections on its own.
  const actionsRow = document.createElement('div');
  actionsRow.className = 'sample-actions-row';

  const duplicateBtn = document.createElement('button');
  duplicateBtn.type = 'button'; duplicateBtn.className = 'icon-btn icon-btn-small icon-btn-accent';
  duplicateBtn.title = 'Duplicate sample'; duplicateBtn.setAttribute('aria-label', 'Duplicate sample');
  duplicateBtn.innerHTML = DUPLICATE_ICON_SVG;
  duplicateBtn.addEventListener('click', async () => {
    duplicateBtn.disabled = true;
    try {
      const newName = s.name ? `${s.name} (copy)` : 'Copy';
      const sampleRef = await addDoc(collection(db, 'test_cases', c.id, 'test_samples'), { item: s.item, name: newName, zones: s.zones || [] });
      for (const action of defaultSampleActions(c.labWorkflowTemplate)) {
        await addDoc(collection(db, 'test_cases', c.id, 'test_samples', sampleRef.id, 'test_actions'), action);
      }
      await reopenToLabIfNeeded(c.id);
      await renderCaseDetail(c.id);
    } catch (ex) {
      duplicateBtn.disabled = false;
    }
  });
  actionsRow.appendChild(duplicateBtn);

  if (myProfile.role === 'team_leader') {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button'; deleteBtn.className = 'icon-btn icon-btn-small icon-btn-danger';
    deleteBtn.title = 'Delete sample'; deleteBtn.setAttribute('aria-label', 'Delete sample');
    deleteBtn.innerHTML = TRASH_ICON_SVG;
    actionsRow.appendChild(deleteBtn);

    deleteBtn.addEventListener('click', () => {
      if (actionsRow.querySelector('.confirm-row')) return;
      const confirmRow = document.createElement('div');
      confirmRow.className = 'confirm-row';
      confirmRow.style.cssText = 'position:absolute; left:0; top:34px; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px; width:240px; z-index:5;';
      const msg = document.createElement('p'); msg.className = 'error'; msg.style.margin = '0 0 8px';
      msg.textContent = 'Delete this sample and its actions?';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Confirm';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '8px';
      cancelBtn.addEventListener('click', () => confirmRow.remove());
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        const actionsSnap = await getDocs(collection(db, 'test_cases', c.id, 'test_samples', s.id, 'test_actions'));
        for (const aDoc of actionsSnap.docs) {
          await deleteDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id, 'test_actions', aDoc.id));
        }
        await deleteDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id));
        expandedSamples.delete(s.id);
        await renderCaseDetail(c.id);
      });
      confirmRow.append(msg, confirmBtn, cancelBtn);
      actionsRow.appendChild(confirmRow);
    });
  }

  card.appendChild(actionsRow);

  return card;
}

// Workflow-section counterpart: a sample's actions (execute/verify/reopen)
// plus the "add action" form -- the entire action-execution surface that
// used to live inline in the samples section. No zones, no delete-sample
// here; those stay purely structural (see buildSampleStructureCard).
function buildSampleActionsCard(c, s) {
  const card = document.createElement('div');
  card.className = 'sample-card';
  const expanded = expandedSamples.has(s.id);

  const header = document.createElement('div');
  header.className = 'sample-card-header';
  const title = document.createElement('strong');
  title.textContent = s.item ? `${s.item} - ${s.name}` : s.name;
  const doneCount = s.actions.filter(isActionComplete).length;
  const countSpan = document.createElement('span');
  countSpan.className = 'muted';
  countSpan.textContent = `${doneCount}/${s.actions.length} done ${expanded ? '▲' : '▼'}`;
  header.append(title, countSpan);
  header.addEventListener('click', () => {
    if (expandedSamples.has(s.id)) expandedSamples.delete(s.id); else expandedSamples.add(s.id);
    renderCaseDetail(c.id);
  });
  card.appendChild(header);

  if (!expanded) return card;

  s.actions.forEach((a) => card.appendChild(buildActionRow(c, s, a)));

  const addForm = document.createElement('form');
  addForm.className = 'add-row';
  const nameInput = document.createElement('input'); nameInput.placeholder = 'Action name'; nameInput.required = true;
  const nameField = document.createElement('div'); nameField.className = 'field'; nameField.appendChild(nameInput);
  addForm.appendChild(nameField);

  const typeSelect = document.createElement('select');
  ['simple', 'verified'].forEach((t) => {
    const opt = document.createElement('option'); opt.value = t; opt.textContent = t;
    typeSelect.appendChild(opt);
  });
  const typeField = document.createElement('div'); typeField.className = 'field'; typeField.appendChild(typeSelect);
  addForm.appendChild(typeField);

  let zoneSelect = null;
  if (s.zones && s.zones.length) {
    zoneSelect = document.createElement('select');
    const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = '(whole sample)';
    zoneSelect.appendChild(noneOpt);
    s.zones.forEach((z) => {
      const opt = document.createElement('option'); opt.value = z; opt.textContent = z;
      zoneSelect.appendChild(opt);
    });
    const zoneField = document.createElement('div'); zoneField.className = 'field'; zoneField.appendChild(zoneSelect);
    addForm.appendChild(zoneField);
  }

  const addActionBtn = document.createElement('button');
  addActionBtn.type = 'submit'; addActionBtn.className = 'btn btn-small'; addActionBtn.textContent = 'Add action';
  addForm.appendChild(addActionBtn);
  card.appendChild(addForm);

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const zone = zoneSelect && zoneSelect.value ? zoneSelect.value : null;
    await addDoc(collection(db, 'test_cases', c.id, 'test_samples', s.id, 'test_actions'), {
      name, zone, type: typeSelect.value, notes: '',
      environment: [], calibration: [], measurements: [],
      status: false, executedBy: null, executionTimestamp: null,
      verifiedBy: null, verificationTimestamp: null, verifiedMeasurements: []
    });
    await reopenToLabIfNeeded(c.id);
    await renderCaseDetail(c.id);
  });

  return card;
}

// ---------------------------------------------------------------------
// value list editor: {name, actualValue, units} rows, used for
// environment / calibration / measurements / verifiedMeasurements.
// ---------------------------------------------------------------------
function buildValueListEditor(label, initialValues) {
  const wrap = document.createElement('div');
  wrap.className = 'value-list';
  const l = document.createElement('label'); l.textContent = label;
  wrap.appendChild(l);
  const rows = document.createElement('div');
  wrap.appendChild(rows);

  function addRow(v) {
    const row = document.createElement('div'); row.className = 'value-row';
    const nameI = document.createElement('input'); nameI.placeholder = 'name'; nameI.value = v?.name || '';
    const actualI = document.createElement('input'); actualI.className = 'mono'; actualI.placeholder = 'value'; actualI.value = v?.actualValue || '';
    const unitsI = document.createElement('input'); unitsI.className = 'mono'; unitsI.placeholder = 'units'; unitsI.value = v?.units || '';
    const rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-small'; rmBtn.textContent = '✕';
    rmBtn.addEventListener('click', () => row.remove());
    row.append(nameI, actualI, unitsI, rmBtn);
    rows.appendChild(row);
  }
  (initialValues || []).forEach(addRow);

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-small'; addBtn.textContent = `+ Add ${label.toLowerCase()} row`;
  addBtn.addEventListener('click', () => addRow(null));
  wrap.appendChild(addBtn);

  wrap.getValues = () => Array.from(rows.children).map((row) => {
    const [nameI, actualI, unitsI] = row.querySelectorAll('input');
    return { name: nameI.value.trim(), actualValue: actualI.value.trim(), units: unitsI.value.trim() };
  }).filter((v) => v.name || v.actualValue || v.units);

  return wrap;
}

function buildActionRow(c, s, a) {
  const row = document.createElement('div');
  row.className = 'action-row';

  const label = document.createElement('span');
  label.textContent = `${a.name}${a.zone ? ` (${a.zone})` : ''} [${a.type}]` + (a.status ? ' — done' : '');
  row.appendChild(label);

  if (!a.status) {
    const execBtn = document.createElement('button');
    execBtn.type = 'button'; execBtn.className = 'btn btn-small'; execBtn.textContent = 'Execute';
    row.appendChild(execBtn);
    execBtn.addEventListener('click', () => {
      if (row.querySelector('.execute-form')) return;
      const form = document.createElement('div');
      form.className = 'execute-form'; form.style.marginTop = '8px'; form.style.width = '100%';
      const notesInput = document.createElement('input'); notesInput.placeholder = 'Notes';
      const envEditor = buildValueListEditor('Environment', a.environment);
      const calEditor = buildValueListEditor('Calibration', a.calibration);
      const measEditor = buildValueListEditor('Measurements', a.measurements);
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-small btn-primary'; saveBtn.textContent = 'Save'; saveBtn.style.marginTop = '6px';
      form.append(notesInput, envEditor, calEditor, measEditor, saveBtn);
      row.appendChild(form);
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        await updateDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id, 'test_actions', a.id), {
          notes: notesInput.value,
          environment: envEditor.getValues(),
          calibration: calEditor.getValues(),
          measurements: measEditor.getValues(),
          status: true,
          executedBy: myProfile.username,
          executionTimestamp: serverTimestamp()
        });
        await renderCaseDetail(c.id);
      });
    });
    return row;
  }

  const info = document.createElement('span'); info.className = 'muted';
  info.textContent = `executed by ${a.executedBy}`;
  row.appendChild(info);

  if (a.type === 'verified') {
    if (a.verifiedBy) {
      const v = document.createElement('span'); v.className = 'muted';
      v.textContent = `verified by ${a.verifiedBy}`;
      row.appendChild(v);
    } else if (a.executedBy !== myProfile.username) {
      const verifyBtn = document.createElement('button');
      verifyBtn.type = 'button'; verifyBtn.className = 'btn btn-small btn-primary'; verifyBtn.textContent = 'Verify';
      row.appendChild(verifyBtn);
      verifyBtn.addEventListener('click', () => {
        if (row.querySelector('.execute-form')) return;
        const form = document.createElement('div');
        form.className = 'execute-form'; form.style.marginTop = '8px'; form.style.width = '100%';
        const measEditor = buildValueListEditor('Verified measurements', a.verifiedMeasurements);
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-small btn-primary'; saveBtn.textContent = 'Save verification'; saveBtn.style.marginTop = '6px';
        form.append(measEditor, saveBtn);
        row.appendChild(form);
        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          await updateDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id, 'test_actions', a.id), {
            verifiedBy: myProfile.username,
            verificationTimestamp: serverTimestamp(),
            verifiedMeasurements: measEditor.getValues()
          });
          await renderCaseDetail(c.id);
        });
      });
    } else {
      const note = document.createElement('span'); note.className = 'muted';
      note.textContent = '(awaiting verification by someone else)';
      row.appendChild(note);
    }
  }

  const reopenBtn = document.createElement('button');
  reopenBtn.type = 'button'; reopenBtn.className = 'btn btn-small'; reopenBtn.textContent = 'Reopen';
  reopenBtn.addEventListener('click', async () => {
    await updateDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id, 'test_actions', a.id), {
      status: false, executedBy: null, executionTimestamp: null,
      verifiedBy: null, verificationTimestamp: null, verifiedMeasurements: []
    });
    await reopenToLabIfNeeded(c.id);
    await renderCaseDetail(c.id);
  });
  row.appendChild(reopenBtn);

  return row;
}

// ---------------------------------------------------------------------
// Notes -- a second, full-screen-swap view on the case (see SPEC.md's
// "Notes" and "Case view"). Nested via a flat subcollection with a
// parentId field, built into a tree client-side.
// ---------------------------------------------------------------------
const NOTE_CATEGORY_LABELS = { noteToSelf: 'Note to self', research: 'Research', information: 'Information' };

async function renderNotesView(caseId) {
  caseNotesView.innerHTML = '<p class="muted">Loading…</p>';
  const snap = await getDocs(collection(db, 'test_cases', caseId, 'notes'));
  const all = [];
  snap.forEach((d) => all.push({ id: d.id, ...d.data() }));
  all.sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));

  caseNotesView.innerHTML = '';
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3'); h3.textContent = 'Notes';
  section.appendChild(h3);
  section.appendChild(buildAddNoteForm(caseId, null));

  const topLevel = all.filter((n) => !n.parentId);
  if (topLevel.length === 0) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No notes yet.';
    section.appendChild(p);
  }
  topLevel.forEach((n) => section.appendChild(buildNoteItem(caseId, n, all)));
  caseNotesView.appendChild(section);
}

function buildAddNoteForm(caseId, parentId) {
  const form = document.createElement('form');
  form.className = 'add-row';
  const textInput = document.createElement('input');
  textInput.placeholder = parentId ? 'Reply…' : 'New note…';
  textInput.required = true;
  const textFieldWrap = document.createElement('div'); textFieldWrap.className = 'field'; textFieldWrap.appendChild(textInput);
  form.appendChild(textFieldWrap);

  let categorySelect = null;
  if (!parentId) {
    categorySelect = document.createElement('select');
    Object.entries(NOTE_CATEGORY_LABELS).forEach(([val, lbl]) => {
      const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
      categorySelect.appendChild(opt);
    });
    const catField = document.createElement('div'); catField.className = 'field'; catField.appendChild(categorySelect);
    form.appendChild(catField);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'submit'; addBtn.className = 'btn btn-small btn-primary';
  addBtn.textContent = parentId ? 'Reply' : 'Add note';
  form.appendChild(addBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    await addDoc(collection(db, 'test_cases', caseId, 'notes'), {
      text,
      writtenBy: myProfile.username,
      timestamp: serverTimestamp(),
      category: categorySelect ? categorySelect.value : null,
      parentId: parentId || null
    });
    await renderNotesView(caseId);
  });

  return form;
}

function buildNoteItem(caseId, note, all) {
  const item = document.createElement('div');
  item.className = 'note-item';
  const meta = document.createElement('div'); meta.className = 'note-meta';
  meta.textContent = `${note.writtenBy}`;
  if (note.category) {
    const cat = document.createElement('span'); cat.className = 'note-category';
    cat.textContent = NOTE_CATEGORY_LABELS[note.category] || note.category;
    meta.appendChild(cat);
  }
  item.appendChild(meta);
  const text = document.createElement('div'); text.textContent = note.text;
  item.appendChild(text);

  const replyBtn = document.createElement('button');
  replyBtn.type = 'button'; replyBtn.className = 'btn btn-small'; replyBtn.textContent = 'Reply';
  replyBtn.style.marginTop = '8px';
  const replyFormHolder = document.createElement('div');
  replyBtn.addEventListener('click', () => {
    if (replyFormHolder.firstChild) { replyFormHolder.innerHTML = ''; return; }
    replyFormHolder.appendChild(buildAddNoteForm(caseId, note.id));
  });
  item.append(replyBtn, replyFormHolder);

  const children = all.filter((n) => n.parentId === note.id);
  if (children.length) {
    const repliesWrap = document.createElement('div'); repliesWrap.className = 'note-replies';
    children.forEach((child) => repliesWrap.appendChild(buildNoteItem(caseId, child, all)));
    item.appendChild(repliesWrap);
  }

  return item;
}
