import { db } from './firebase-init.js?v=0.4.1-t05';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { loadCaseTypes, getCachedCaseTypes, findCaseTypeById } from './case-types-ui.js?v=0.4.1-t05';
import {
  loadClientOrgsAndClients, getCachedClientOrgs, getCachedClientsForOrg, fetchClientsForOrg,
  findClientById, findClientOrgById
} from './clients-ui.js?v=0.4.1-t05';

// ---------------------------------------------------------------------
// Core case/sample/action model (0.4.1 redesign -- see SPEC.md's "Case
// lifecycle" / "Case model"). Internal to the lab team -- admin has zero
// rule-level access to any of this now (see setup/firestore.rules), and
// clients get their own, separately-scoped read-only view (client-view.js).
// ---------------------------------------------------------------------

const casesScreen = document.getElementById('casesScreen');
const caseDetailScreen = document.getElementById('caseDetailScreen');
const caseListBody = document.getElementById('caseListBody');
const showNewCaseFormBtn = document.getElementById('showNewCaseFormBtn');
const newCaseForm = document.getElementById('newCaseForm');
const newCaseError = document.getElementById('newCaseError');
const backToCasesBtn = document.getElementById('backToCasesBtn');
const toggleNotesBtn = document.getElementById('toggleNotesBtn');
const caseDetailTitle = document.getElementById('caseDetailTitle');
const caseMainView = document.getElementById('caseMainView');
const caseNotesView = document.getElementById('caseNotesView');
const genTempNumberBtn = document.getElementById('genTempNumberBtn');
const newCaseClientOrgSelect = document.getElementById('newCaseClientOrg');
const newCaseClientSelect = document.getElementById('newCaseClient');
const newCaseTypeSelect = document.getElementById('newCaseType');
const newCaseManagerSelect = document.getElementById('newCaseManager');

let myProfile = null; // { uid, username, role }
let cases = [];
let infoEditMode = false;
let expandedSamples = new Set();
let notesShown = false;

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
  const snap = await getDocs(collection(db, 'cases'));
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
    await addDoc(collection(db, 'cases'), {
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
function caseTitle(c) {
  const dc = dayCounterOf(c);
  const parts = [
    onameOf(c) || '(unnamed)',
    c.caseManager || 'Unassigned',
    dc == null ? '—' : `day ${dc}`,
    dueDateOf(c) || '—',
    stageLabel(c.stage)
  ];
  return parts.join(' | ');
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
  caseListBody.innerHTML = '<tr><td colspan="2" class="muted">Loading…</td></tr>';
  const q = myProfile.role === 'team_leader'
    ? query(collection(db, 'cases'), where('openedBy', '==', myProfile.username))
    : collection(db, 'cases');
  const snap = await getDocs(q);
  cases = [];
  snap.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  cases.sort((a, b) => (a.caseNumber || '').localeCompare(b.caseNumber || ''));
  caseListBody.innerHTML = '';
  if (cases.length === 0) {
    caseListBody.innerHTML = '<tr><td colspan="2" class="muted">No cases yet.</td></tr>';
    return;
  }
  cases.forEach((c) => caseListBody.appendChild(renderCaseRow(c)));
}

function renderCaseRow(c) {
  const tr = document.createElement('tr');
  tr.className = 'case-row';
  const titleTd = document.createElement('td'); titleTd.textContent = caseTitle(c);
  const badgeTd = document.createElement('td');
  if (c.onHold) {
    const b = document.createElement('span'); b.className = 'badge badge-onhold'; b.textContent = 'On hold';
    badgeTd.appendChild(b);
  }
  if (c.highPriority) {
    const b = document.createElement('span'); b.className = 'badge badge-priority'; b.textContent = 'Priority';
    badgeTd.appendChild(b);
  }
  tr.append(titleTd, badgeTd);
  tr.addEventListener('click', () => openCaseDetail(c.id));
  return tr;
}

backToCasesBtn.addEventListener('click', () => {
  caseDetailScreen.classList.add('hidden');
  casesScreen.classList.remove('hidden');
  loadCaseList();
});

toggleNotesBtn.addEventListener('click', async () => {
  notesShown = !notesShown;
  toggleNotesBtn.classList.toggle('active', notesShown);
  toggleNotesBtn.textContent = notesShown ? 'Back to case' : 'Notes';
  caseMainView.classList.toggle('hidden', notesShown);
  caseNotesView.classList.toggle('hidden', !notesShown);
  if (notesShown) await renderNotesView(currentCaseId);
});

let currentCaseId = null;

async function openCaseDetail(caseId) {
  currentCaseId = caseId;
  infoEditMode = false;
  expandedSamples = new Set();
  notesShown = false;
  toggleNotesBtn.classList.remove('active');
  toggleNotesBtn.textContent = 'Notes';
  caseMainView.classList.remove('hidden');
  caseNotesView.classList.add('hidden');
  casesScreen.classList.add('hidden');
  caseDetailScreen.classList.remove('hidden');
  caseMainView.innerHTML = '<p class="muted">Loading…</p>';
  await renderCaseDetail(caseId);
}

async function saveCaseField(caseId, field, value) {
  await updateDoc(doc(db, 'cases', caseId), { [field]: value });
}

// Catches up any stage transition a plain worker couldn't itself write
// (see canUpdateCase above), plus runs the ordinary auto-advance checks.
async function runAutoAdvanceChecks(caseId, c, samples) {
  if (!canUpdateCase(c)) return;
  if (c.stage === 'lab') await maybeAutoAdvanceToWrite(caseId, samples);
  if (c.stage === 'archive') await maybeAutoAdvanceToDone(caseId, c);
}

async function renderCaseDetail(caseId) {
  const caseSnap = await getDoc(doc(db, 'cases', caseId));
  if (!caseSnap.exists()) {
    caseMainView.innerHTML = '<p class="error">Case not found.</p>';
    return;
  }
  const c = { id: caseId, ...caseSnap.data() };

  const samplesSnap = await getDocs(collection(db, 'cases', caseId, 'samples'));
  const samples = [];
  for (const sDoc of samplesSnap.docs) {
    const actionsSnap = await getDocs(collection(db, 'cases', caseId, 'samples', sDoc.id, 'actions'));
    const actions = [];
    actionsSnap.forEach((aDoc) => actions.push({ id: aDoc.id, ...aDoc.data() }));
    samples.push({ id: sDoc.id, ...sDoc.data(), actions });
  }
  samples.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  await runAutoAdvanceChecks(caseId, c, samples);
  // Re-read after a possible auto-advance so the rendered stage is current.
  const freshSnap = await getDoc(doc(db, 'cases', caseId));
  const cFresh = { id: caseId, ...freshSnap.data() };

  caseDetailTitle.textContent = caseTitle(cFresh);
  caseMainView.innerHTML = '';
  caseMainView.appendChild(buildInfoSection(cFresh));
  caseMainView.appendChild(buildWorkflowSection(cFresh, samples));
  caseMainView.appendChild(buildSamplesSection(cFresh, samples));
}

// ---------------------------------------------------------------------
// Info section -- compact (default) vs full/editable, toggled via a
// plain "Edit info" button. Scope is the case's own info fields only,
// never samples or workflow (see SPEC.md's "Case info display").
// ---------------------------------------------------------------------
function infoRow(label, valueText) {
  const row = document.createElement('div');
  row.className = 'case-field';
  const l = document.createElement('label'); l.textContent = label;
  const v = document.createElement('div'); v.textContent = valueText || '—';
  row.append(l, v);
  return row;
}

function clientDisplayText(c) {
  if (!c.client) return null;
  const client = findClientById(c.client);
  if (!client) return null;
  const org = findClientOrgById(client.clientOrgId);
  return org ? `${org.name} — ${client.name}` : client.name;
}

function buildInfoSection(c) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Info';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-small';
  editBtn.textContent = infoEditMode ? 'Done editing' : 'Edit info';
  editBtn.addEventListener('click', () => { infoEditMode = !infoEditMode; renderCaseDetail(c.id); });
  h3.appendChild(editBtn);
  section.appendChild(h3);

  const canEdit = myProfile.role === 'team_leader' || c.caseManager === myProfile.username;

  if (!infoEditMode || !canEdit) {
    const grid = document.createElement('div');
    grid.className = 'case-grid';
    grid.appendChild(infoRow('Case number', c.caseNumber));
    grid.appendChild(infoRow('Client case number', c.clientCaseNumber));
    grid.appendChild(infoRow('Name', c.name));
    grid.appendChild(infoRow('Client', clientDisplayText(c)));
    grid.appendChild(infoRow('Start date', c.startDate));
    grid.appendChild(infoRow('Case type', c.caseType ? (findCaseTypeById(c.caseType)?.name) : null));
    grid.appendChild(infoRow('Case manager', c.caseManager));
    grid.appendChild(infoRow('Opened by', c.openedBy));
    grid.appendChild(infoRow('Due date', dueDateOf(c)));
    section.appendChild(grid);

    const toggles = document.createElement('div');
    toggles.className = 'case-toggles';
    [['On hold', c.onHold], ['High priority', c.highPriority], ['Show research to client', c.showResearchToClient]].forEach(([label, val]) => {
      const span = document.createElement('span');
      span.className = 'checkbox-inline';
      span.textContent = `${val ? '✓' : '—'} ${label}`;
      toggles.appendChild(span);
    });
    section.appendChild(toggles);
    return section;
  }

  // Full/editable view.
  const grid = document.createElement('div');
  grid.className = 'case-grid';

  const caseNumInput = document.createElement('input');
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
  await updateDoc(doc(db, 'cases', caseId), { stage: 'write', writingStage: 'draft' });
}

async function maybeAutoAdvanceToDone(caseId, c) {
  const items = c.archivingWorkflow || [];
  if (items.length === 0) return;
  if (items.every((it) => it.status === 'done')) {
    await updateDoc(doc(db, 'cases', caseId), { stage: 'done' });
  }
}

// See canUpdateCase's note above -- adding a sample/action, or reopening
// a completed one, pulls a case back from `write` to `lab` if it had
// already auto-advanced there (SPEC.md's reversibility rule). Only fires
// for whoever's allowed to write to the case doc; otherwise it's caught
// up next time an authorized user opens the case (same pattern as the
// forward auto-advances above).
async function reopenToLabIfNeeded(caseId) {
  const snap = await getDoc(doc(db, 'cases', caseId));
  if (!snap.exists()) return;
  const c = snap.data();
  if (c.stage === 'write' && canUpdateCase({ id: caseId, ...c })) {
    await updateDoc(doc(db, 'cases', caseId), { stage: 'lab', writingStage: null });
  }
}

function buildWorkflowSection(c, samples) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = `Workflow — ${stageLabel(c.stage)}`;
  section.appendChild(h3);

  const editAllowed = canUpdateCase(c);

  if (c.stage === 'new') {
    if (samples.length === 0) {
      const note = document.createElement('p'); note.className = 'muted';
      note.textContent = 'Add at least one sample before starting lab.';
      section.appendChild(note);
    }
    // Exits `new` via an explicit team-leader confirmation only -- not
    // gated on field-completeness (SPEC.md's "Case lifecycle").
    if (myProfile.role === 'team_leader') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary'; btn.textContent = 'Start lab';
      btn.disabled = samples.length === 0;
      btn.addEventListener('click', async () => {
        await updateDoc(doc(db, 'cases', c.id), { stage: 'lab' });
        await renderCaseDetail(c.id);
      });
      section.appendChild(btn);
    }
  } else if (c.stage === 'lab') {
    const totalActions = samples.reduce((sum, s) => sum + s.actions.length, 0);
    const doneActions = samples.reduce((sum, s) => sum + s.actions.filter(isActionComplete).length, 0);
    const completeSamples = samples.filter((s) => s.actions.length > 0 && s.actions.every(isActionComplete)).length;
    const p = document.createElement('p'); p.className = 'muted';
    p.textContent = `${completeSamples}/${samples.length} samples complete (${doneActions}/${totalActions} actions done). Moves to Write automatically once every sample's actions are done (verified-type actions need sign-off too).`;
    section.appendChild(p);
  } else if (c.stage === 'write') {
    section.appendChild(buildWritingWorkflow(c, editAllowed));
  } else if (c.stage === 'archive') {
    section.appendChild(buildArchivingWorkflow(c, editAllowed));
  } else if (c.stage === 'done') {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'This case is done.';
    section.appendChild(p);
  }

  // Deletion: any case, any stage, team-leader judgment call (0.4.1 --
  // no longer tied to reaching `done`; setup/firestore.rules already
  // enforces team_leader-only, unchanged from Iteration 4).
  if (myProfile.role === 'team_leader') {
    section.appendChild(buildDeleteCaseControl(c));
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
    await updateDoc(doc(db, 'cases', c.id), { writingStage: stage });
    await renderCaseDetail(c.id);
  }
  async function publish() {
    await updateDoc(doc(db, 'cases', c.id), { writingStage: 'published', stage: 'archive' });
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
      await updateDoc(doc(db, 'cases', c.id), { archivingWorkflow: updated });
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
      await updateDoc(doc(db, 'cases', c.id), { archivingWorkflow: updated });
      await renderCaseDetail(c.id);
    });
    controls.appendChild(removeBtn);

    if (item.status !== 'done') {
      const execBtn = document.createElement('button');
      execBtn.type = 'button'; execBtn.className = 'btn btn-small btn-primary'; execBtn.textContent = 'Mark done';
      execBtn.style.marginLeft = '6px';
      execBtn.addEventListener('click', async () => {
        const updated = c.archivingWorkflow.map((it, i) => (i === idx ? { ...it, status: 'done', executedBy: myProfile.username, executedAt: new Date() } : it));
        await updateDoc(doc(db, 'cases', c.id), { archivingWorkflow: updated });
        await renderCaseDetail(c.id);
      });
      controls.appendChild(execBtn);
    }
  }
  row.appendChild(controls);
  return row;
}

function buildDeleteCaseControl(c) {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '20px';
  const btn = document.createElement('button');
  btn.className = 'btn'; btn.textContent = 'Delete case';
  wrap.appendChild(btn);

  btn.addEventListener('click', () => {
    if (wrap.querySelector('.confirm-row')) return;
    const confirmRow = document.createElement('div');
    confirmRow.className = 'confirm-row';
    confirmRow.style.marginTop = '10px';
    const msg = document.createElement('p'); msg.className = 'error';
    msg.textContent = 'This permanently deletes the case and everything in it. This cannot be undone.';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Confirm delete';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '8px';
    cancelBtn.addEventListener('click', () => confirmRow.remove());
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      await deleteCaseCascade(c.id);
      caseDetailScreen.classList.add('hidden');
      casesScreen.classList.remove('hidden');
      loadCaseList();
    });
    confirmRow.append(msg, confirmBtn, cancelBtn);
    wrap.appendChild(confirmRow);
  });

  return wrap;
}

// Firestore doesn't cascade-delete subcollections -- every sample,
// action, and note doc has to be deleted individually before the case
// doc itself.
async function deleteCaseCascade(caseId) {
  const samplesSnap = await getDocs(collection(db, 'cases', caseId, 'samples'));
  for (const sDoc of samplesSnap.docs) {
    const actionsSnap = await getDocs(collection(db, 'cases', caseId, 'samples', sDoc.id, 'actions'));
    for (const aDoc of actionsSnap.docs) {
      await deleteDoc(doc(db, 'cases', caseId, 'samples', sDoc.id, 'actions', aDoc.id));
    }
    await deleteDoc(doc(db, 'cases', caseId, 'samples', sDoc.id));
  }
  const notesSnap = await getDocs(collection(db, 'cases', caseId, 'notes'));
  for (const nDoc of notesSnap.docs) {
    await deleteDoc(doc(db, 'cases', caseId, 'notes', nDoc.id));
  }
  await deleteDoc(doc(db, 'cases', caseId));
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

function buildSamplesSection(c, samples) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Samples';
  section.appendChild(h3);

  const form = document.createElement('form');
  form.className = 'add-row';
  const itemInput = document.createElement('input'); itemInput.placeholder = 'Item (optional)';
  const nameInput = document.createElement('input'); nameInput.placeholder = 'Sample name'; nameInput.required = true;
  const zonesInput = document.createElement('input'); zonesInput.placeholder = 'Zones, comma-separated (optional)';
  [itemInput, nameInput, zonesInput].forEach((el) => {
    const f = document.createElement('div'); f.className = 'field'; f.appendChild(el); form.appendChild(f);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'submit'; addBtn.className = 'btn btn-primary'; addBtn.textContent = 'Add sample';
  form.appendChild(addBtn);
  section.appendChild(form);
  const err = document.createElement('div'); err.className = 'error'; section.appendChild(err);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const name = nameInput.value.trim();
    if (!name) { err.textContent = 'Name is required.'; return; }
    const item = itemInput.value.trim() || null;
    const zones = zonesInput.value.trim() ? zonesInput.value.split(',').map((z) => z.trim()).filter(Boolean) : [];
    try {
      const sampleRef = await addDoc(collection(db, 'cases', c.id, 'samples'), { item, name, zones });
      for (const action of defaultSampleActions(c.labWorkflowTemplate)) {
        await addDoc(collection(db, 'cases', c.id, 'samples', sampleRef.id, 'actions'), action);
      }
      await reopenToLabIfNeeded(c.id);
      await renderCaseDetail(c.id);
    } catch (ex) {
      err.textContent = `Couldn't add sample: ${ex.message}`;
    }
  });

  samples.forEach((s) => section.appendChild(buildSampleCard(c, s)));
  return section;
}

function buildSampleCard(c, s) {
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

  if (s.zones && s.zones.length) {
    const zonesP = document.createElement('p'); zonesP.className = 'muted';
    zonesP.textContent = 'Zones: ' + s.zones.join(', ');
    card.appendChild(zonesP);
  }

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
    await addDoc(collection(db, 'cases', c.id, 'samples', s.id, 'actions'), {
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
    const actualI = document.createElement('input'); actualI.placeholder = 'value'; actualI.value = v?.actualValue || '';
    const unitsI = document.createElement('input'); unitsI.placeholder = 'units'; unitsI.value = v?.units || '';
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
        await updateDoc(doc(db, 'cases', c.id, 'samples', s.id, 'actions', a.id), {
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
          await updateDoc(doc(db, 'cases', c.id, 'samples', s.id, 'actions', a.id), {
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
    await updateDoc(doc(db, 'cases', c.id, 'samples', s.id, 'actions', a.id), {
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
  const snap = await getDocs(collection(db, 'cases', caseId, 'notes'));
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
    await addDoc(collection(db, 'cases', caseId, 'notes'), {
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
