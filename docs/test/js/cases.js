import { db } from './firebase-init.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ---------------------------------------------------------------------
// Core case/sample/action model (Phase plan item 4). Internal to the lab
// team -- clients have no view built yet, so this whole screen is hidden
// from them (see showCasesScreen/hideCasesScreen, called from auth-ui.js).
// ---------------------------------------------------------------------

const casesScreen = document.getElementById('casesScreen');
const caseDetailScreen = document.getElementById('caseDetailScreen');
const caseListBody = document.getElementById('caseListBody');
const showNewCaseFormBtn = document.getElementById('showNewCaseFormBtn');
const newCaseForm = document.getElementById('newCaseForm');
const newCaseError = document.getElementById('newCaseError');
const backToCasesBtn = document.getElementById('backToCasesBtn');
const caseDetailContent = document.getElementById('caseDetailContent');
const genTempNumberBtn = document.getElementById('genTempNumberBtn');

let myProfile = null; // { uid, username, role }

export function hideCasesScreen() {
  casesScreen.classList.add('hidden');
  caseDetailScreen.classList.add('hidden');
  myProfile = null;
}

export function showCasesScreen(profile) {
  myProfile = profile;
  caseDetailScreen.classList.add('hidden');
  casesScreen.classList.remove('hidden');
  const canCreate = profile.role === 'admin' || profile.role === 'team_leader';
  showNewCaseFormBtn.classList.toggle('hidden', !canCreate);
  newCaseForm.classList.add('hidden');
  newCaseForm.reset();
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

showNewCaseFormBtn.addEventListener('click', async () => {
  const willShow = newCaseForm.classList.contains('hidden');
  newCaseForm.classList.toggle('hidden');
  if (willShow) {
    const select = document.getElementById('newCaseManager');
    select.innerHTML = '<option value="">Loading…</option>';
    const users = await fetchAssignableUsers();
    select.innerHTML = '';
    users.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      select.appendChild(opt);
    });
  }
});

function defaultArchivingWorkflow() {
  // Publish -> Close-in-access -> (Return parts || Archive samples) -> Scan.
  // `order` is purely for display grouping/sequencing -- the parallel pair
  // shares an order value. Not enforced (informational only, per TASK).
  return [
    { name: 'Publish', order: 1, status: 'pending', executedBy: null, executedAt: null },
    { name: 'Close-in-access', order: 2, status: 'pending', executedBy: null, executedAt: null },
    { name: 'Return parts', order: 3, status: 'pending', executedBy: null, executedAt: null },
    { name: 'Archive samples', order: 3, status: 'pending', executedBy: null, executedAt: null },
    { name: 'Scan', order: 4, status: 'pending', executedBy: null, executedAt: null }
  ];
}

newCaseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  newCaseError.textContent = '';
  const caseNumber = document.getElementById('newCaseNumber').value.trim();
  const clientCaseNumber = document.getElementById('newClientCaseNumber').value.trim();
  const name = document.getElementById('newCaseName').value.trim();
  const clientName = document.getElementById('newCaseClientName').value.trim();
  const startDate = document.getElementById('newCaseStartDate').value;
  const expectedTimelineDate = document.getElementById('newCaseTimeline').value;
  const caseManager = document.getElementById('newCaseManager').value;
  if (!caseNumber) { newCaseError.textContent = 'Case number is required.'; return; }
  if (!caseManager) { newCaseError.textContent = 'Pick a case manager.'; return; }
  try {
    await addDoc(collection(db, 'cases'), {
      caseNumber,
      clientCaseNumber: clientCaseNumber || null,
      name, clientName,
      caseManager,
      startDate: startDate || null,
      expectedTimelineDate: expectedTimelineDate || null,
      stage: 'new',
      onHold: false,
      highPriority: false,
      showResearchToClient: false,
      researchAddressed: false,
      archivingWorkflow: defaultArchivingWorkflow()
    });
    newCaseForm.reset();
    newCaseForm.classList.add('hidden');
    loadCaseList();
  } catch (err) {
    newCaseError.textContent = `Couldn't create case: ${err.message}`;
  }
});

const STAGE_LABELS = { new: 'New', lab: 'In lab', writing: 'Writing', archiving: 'Archiving', done: 'Done' };
function stageLabel(stage) { return STAGE_LABELS[stage] || stage; }

async function loadCaseList() {
  caseListBody.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  const snap = await getDocs(collection(db, 'cases'));
  const cases = [];
  snap.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  cases.sort((a, b) => (a.caseNumber || '').localeCompare(b.caseNumber || ''));
  caseListBody.innerHTML = '';
  if (cases.length === 0) {
    caseListBody.innerHTML = '<tr><td colspan="5" class="muted">No cases yet.</td></tr>';
    return;
  }
  cases.forEach((c) => caseListBody.appendChild(renderCaseRow(c)));
}

function renderCaseRow(c) {
  const tr = document.createElement('tr');
  tr.className = 'case-row';
  const numTd = document.createElement('td'); numTd.textContent = c.caseNumber;
  const nameTd = document.createElement('td'); nameTd.textContent = c.name || '';
  const clientTd = document.createElement('td'); clientTd.textContent = c.clientName || '';
  const stageTd = document.createElement('td'); stageTd.textContent = stageLabel(c.stage);
  const badgeTd = document.createElement('td');
  if (c.onHold) {
    const b = document.createElement('span');
    b.className = 'badge badge-onhold';
    b.textContent = 'On hold';
    badgeTd.appendChild(b);
  }
  if (c.highPriority) {
    const b = document.createElement('span');
    b.className = 'badge badge-priority';
    b.textContent = 'Priority';
    badgeTd.appendChild(b);
  }
  tr.append(numTd, nameTd, clientTd, stageTd, badgeTd);
  tr.addEventListener('click', () => openCaseDetail(c.id));
  return tr;
}

backToCasesBtn.addEventListener('click', () => {
  caseDetailScreen.classList.add('hidden');
  casesScreen.classList.remove('hidden');
  loadCaseList();
});

async function openCaseDetail(caseId) {
  casesScreen.classList.add('hidden');
  caseDetailScreen.classList.remove('hidden');
  caseDetailContent.innerHTML = '<p class="muted">Loading…</p>';
  await renderCaseDetail(caseId);
}

async function saveCaseField(caseId, field, value) {
  await updateDoc(doc(db, 'cases', caseId), { [field]: value });
}

async function renderCaseDetail(caseId) {
  const caseSnap = await getDoc(doc(db, 'cases', caseId));
  if (!caseSnap.exists()) {
    caseDetailContent.innerHTML = '<p class="error">Case not found.</p>';
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
  samples.sort((a, b) => a.name.localeCompare(b.name));

  caseDetailContent.innerHTML = '';
  caseDetailContent.appendChild(buildCaseHeader(c));
  caseDetailContent.appendChild(buildLifecycleSection(c, samples));
  caseDetailContent.appendChild(buildSamplesSection(c, samples));
  caseDetailContent.appendChild(buildArchivingSection(c));
}

// ---------------------------------------------------------------------
// Header: case-level fields. `canEditCore` (admin/team_leader) covers
// most fields; `researchAddressed` also allows the case's own
// caseManager, per TASK's Step 3 note.
// ---------------------------------------------------------------------
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

function checkboxField(labelText, checked, enabled, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'checkbox-inline';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.disabled = !enabled;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.append(' ' + labelText);
  return wrap;
}

function textField(labelText, value, type, disabled, onSave) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  input.disabled = disabled;
  input.addEventListener('change', () => onSave(input.value.trim()));
  return fieldRow(labelText, input);
}

function buildCaseHeader(c) {
  const canEditCore = myProfile.role === 'admin' || myProfile.role === 'team_leader';
  const canToggleResearch = canEditCore || c.caseManager === myProfile.username;

  const container = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'case-grid';

  // Case number (with soft-validation warning)
  const caseNumInput = document.createElement('input');
  caseNumInput.type = 'text';
  caseNumInput.value = c.caseNumber || '';
  caseNumInput.disabled = !canEditCore;
  const caseNumWarn = document.createElement('div');
  caseNumWarn.className = 'warn-text hidden';
  function refreshCaseNumWarn() {
    const msg = validateCaseNumberShape(caseNumInput.value.trim());
    caseNumWarn.textContent = msg || '';
    caseNumWarn.classList.toggle('hidden', !msg);
  }
  refreshCaseNumWarn();
  caseNumInput.addEventListener('input', refreshCaseNumWarn);
  caseNumInput.addEventListener('change', () => saveCaseField(c.id, 'caseNumber', caseNumInput.value.trim()));
  grid.appendChild(fieldRow('Case number', caseNumInput, caseNumWarn));

  // Client case number (same soft-validation)
  const clientNumInput = document.createElement('input');
  clientNumInput.type = 'text';
  clientNumInput.value = c.clientCaseNumber || '';
  clientNumInput.disabled = !canEditCore;
  const clientNumWarn = document.createElement('div');
  clientNumWarn.className = 'warn-text hidden';
  function refreshClientNumWarn() {
    const msg = validateCaseNumberShape(clientNumInput.value.trim());
    clientNumWarn.textContent = msg || '';
    clientNumWarn.classList.toggle('hidden', !msg);
  }
  refreshClientNumWarn();
  clientNumInput.addEventListener('input', refreshClientNumWarn);
  clientNumInput.addEventListener('change', () => saveCaseField(c.id, 'clientCaseNumber', clientNumInput.value.trim() || null));
  grid.appendChild(fieldRow('Client case number', clientNumInput, clientNumWarn));

  grid.appendChild(textField('Name', c.name, 'text', !canEditCore, (v) => saveCaseField(c.id, 'name', v)));
  grid.appendChild(textField('Client name', c.clientName, 'text', !canEditCore, (v) => saveCaseField(c.id, 'clientName', v)));
  grid.appendChild(textField('Start date', c.startDate, 'date', !canEditCore, (v) => saveCaseField(c.id, 'startDate', v || null)));
  grid.appendChild(textField('Expected timeline', c.expectedTimelineDate, 'date', !canEditCore, (v) => saveCaseField(c.id, 'expectedTimelineDate', v || null)));

  container.appendChild(grid);

  // Case manager -- populated async since it needs the assignable-users list.
  const managerSelect = document.createElement('select');
  managerSelect.disabled = !canEditCore;
  managerSelect.innerHTML = `<option value="${c.caseManager}">${c.caseManager}</option>`;
  container.appendChild(fieldRow('Case manager', managerSelect));
  fetchAssignableUsers().then((users) => {
    managerSelect.innerHTML = '';
    users.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (u === c.caseManager) opt.selected = true;
      managerSelect.appendChild(opt);
    });
    managerSelect.addEventListener('change', async () => {
      await saveCaseField(c.id, 'caseManager', managerSelect.value);
      await renderCaseDetail(c.id);
    });
  });

  const toggles = document.createElement('div');
  toggles.className = 'case-toggles';
  toggles.appendChild(checkboxField('On hold', c.onHold, canEditCore, (v) => saveCaseField(c.id, 'onHold', v)));
  toggles.appendChild(checkboxField('High priority', c.highPriority, canEditCore, (v) => saveCaseField(c.id, 'highPriority', v)));
  toggles.appendChild(checkboxField('Show research to client', c.showResearchToClient, canEditCore, (v) => saveCaseField(c.id, 'showResearchToClient', v)));
  toggles.appendChild(checkboxField('Research addressed', c.researchAddressed, canToggleResearch, async (v) => {
    await saveCaseField(c.id, 'researchAddressed', v);
    await renderCaseDetail(c.id);
  }));
  container.appendChild(toggles);

  return container;
}

// ---------------------------------------------------------------------
// Lifecycle: stage display, progress, and the one explicit transition
// button relevant to the current stage. "Start lab" allows admin per
// TASK's explicit "(or admin)"; "Publish report" and "Approve & delete"
// don't get that exception in TASK's wording, so they're team_leader-only
// here even though the underlying rules allow admin to update a case
// broadly -- this is a UI-level restriction, not a rules one, matching
// the "loose enforcement" pattern used elsewhere this iteration. Delete
// is the one exception with real rule enforcement (see firestore.rules).
// ---------------------------------------------------------------------
function buildLifecycleSection(c, samples) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = `Stage: ${stageLabel(c.stage)}`;
  section.appendChild(h3);

  if (c.stage === 'new') {
    const canStart = myProfile.role === 'admin' || myProfile.role === 'team_leader';
    if (samples.length === 0) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = 'Add at least one sample before starting lab.';
      section.appendChild(note);
    }
    if (canStart) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Start lab';
      btn.disabled = samples.length === 0;
      btn.addEventListener('click', async () => {
        await updateDoc(doc(db, 'cases', c.id), { stage: 'lab' });
        await renderCaseDetail(c.id);
      });
      section.appendChild(btn);
    }
  } else if (c.stage === 'lab') {
    const totalActions = samples.reduce((sum, s) => sum + s.actions.length, 0);
    const doneActions = samples.reduce((sum, s) => sum + s.actions.filter((a) => a.status === 'done').length, 0);
    const completeSamples = samples.filter((s) => s.actions.length > 0 && s.actions.every((a) => a.status === 'done')).length;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = `${completeSamples}/${samples.length} samples complete (${doneActions}/${totalActions} actions done). Moves to Writing automatically once every sample's actions are done.`;
    section.appendChild(p);
  } else if (c.stage === 'writing') {
    const canPublish = myProfile.role === 'team_leader';
    if (!c.researchAddressed) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = 'Blocked: mark "Research addressed" above first.';
      section.appendChild(note);
    }
    if (canPublish) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Publish report';
      btn.disabled = !c.researchAddressed;
      btn.addEventListener('click', async () => {
        await updateDoc(doc(db, 'cases', c.id), { stage: 'archiving' });
        await renderCaseDetail(c.id);
      });
      section.appendChild(btn);
    }
  } else if (c.stage === 'archiving') {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Work through the archiving workflow below, then approve to finish.';
    section.appendChild(p);
    if (myProfile.role === 'team_leader') {
      section.appendChild(buildApproveDeleteControl(c));
    }
  } else if (c.stage === 'done') {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'This case is done.';
    section.appendChild(p);
  }

  return section;
}

function buildApproveDeleteControl(c) {
  const wrap = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.textContent = 'Approve & delete';
  wrap.appendChild(btn);

  btn.addEventListener('click', () => {
    if (wrap.querySelector('.confirm-row')) return;
    const confirmRow = document.createElement('div');
    confirmRow.className = 'confirm-row';
    confirmRow.style.marginTop = '10px';
    const msg = document.createElement('p');
    msg.className = 'error';
    msg.textContent = 'This permanently deletes the case and everything in it. This cannot be undone.';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-small btn-primary';
    confirmBtn.textContent = 'Confirm delete';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.marginLeft = '8px';
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

// Firestore doesn't cascade-delete subcollections -- every sample and
// action doc has to be deleted individually before the case doc itself.
async function deleteCaseCascade(caseId) {
  const samplesSnap = await getDocs(collection(db, 'cases', caseId, 'samples'));
  for (const sDoc of samplesSnap.docs) {
    const actionsSnap = await getDocs(collection(db, 'cases', caseId, 'samples', sDoc.id, 'actions'));
    for (const aDoc of actionsSnap.docs) {
      await deleteDoc(doc(db, 'cases', caseId, 'samples', sDoc.id, 'actions', aDoc.id));
    }
    await deleteDoc(doc(db, 'cases', caseId, 'samples', sDoc.id));
  }
  await deleteDoc(doc(db, 'cases', caseId));
}

// ---------------------------------------------------------------------
// Samples + their actions.
// ---------------------------------------------------------------------
function defaultSampleActions() {
  return [
    { name: 'Visual Inspection', zone: null, notes: '', results: '', status: 'pending', executedBy: null, executedAt: null },
    { name: 'Composition Analysis', zone: null, notes: '', results: '', status: 'pending', executedBy: null, executedAt: null },
    { name: 'Hardness Test', zone: null, notes: '', results: '', status: 'pending', executedBy: null, executedAt: null }
  ];
}

function buildSamplesSection(c, samples) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Samples';
  section.appendChild(h3);

  const form = document.createElement('form');
  form.className = 'add-row';
  const nameInput = document.createElement('input'); nameInput.placeholder = 'Sample name'; nameInput.required = true;
  const groupInput = document.createElement('input'); groupInput.placeholder = 'Group (optional)';
  const zonesInput = document.createElement('input'); zonesInput.placeholder = 'Zones, comma-separated (optional)';
  [nameInput, groupInput, zonesInput].forEach((el) => {
    const f = document.createElement('div');
    f.className = 'field';
    f.appendChild(el);
    form.appendChild(f);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'submit'; addBtn.className = 'btn btn-primary'; addBtn.textContent = 'Add sample';
  form.appendChild(addBtn);
  section.appendChild(form);
  const err = document.createElement('div');
  err.className = 'error';
  section.appendChild(err);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const name = nameInput.value.trim();
    if (!name) { err.textContent = 'Name is required.'; return; }
    const groupName = groupInput.value.trim() || null;
    const zones = zonesInput.value.trim() ? zonesInput.value.split(',').map((z) => z.trim()).filter(Boolean) : [];
    try {
      const sampleRef = await addDoc(collection(db, 'cases', c.id, 'samples'), { name, groupName, zones });
      for (const action of defaultSampleActions()) {
        await addDoc(collection(db, 'cases', c.id, 'samples', sampleRef.id, 'actions'), action);
      }
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

  const header = document.createElement('div');
  header.className = 'sample-card-header';
  const title = document.createElement('strong');
  title.textContent = s.groupName ? `${s.groupName} - ${s.name}` : s.name;
  const doneCount = s.actions.filter((a) => a.status === 'done').length;
  const countSpan = document.createElement('span');
  countSpan.className = 'muted';
  countSpan.textContent = `${doneCount}/${s.actions.length} done`;
  header.append(title, countSpan);
  card.appendChild(header);

  if (s.zones && s.zones.length) {
    const zonesP = document.createElement('p');
    zonesP.className = 'muted';
    zonesP.textContent = 'Zones: ' + s.zones.join(', ');
    card.appendChild(zonesP);
  }

  s.actions.forEach((a) => card.appendChild(buildActionRow(c, s, a)));

  const addForm = document.createElement('form');
  addForm.className = 'add-row';
  const nameInput = document.createElement('input'); nameInput.placeholder = 'Action name'; nameInput.required = true;
  const nameField = document.createElement('div'); nameField.className = 'field'; nameField.appendChild(nameInput);
  addForm.appendChild(nameField);

  let zoneSelect = null;
  if (s.zones && s.zones.length) {
    zoneSelect = document.createElement('select');
    const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = '(whole sample)';
    zoneSelect.appendChild(noneOpt);
    s.zones.forEach((z) => {
      const opt = document.createElement('option');
      opt.value = z; opt.textContent = z;
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
      name, zone, notes: '', results: '', status: 'pending', executedBy: null, executedAt: null
    });
    await renderCaseDetail(c.id);
  });

  return card;
}

function buildActionRow(c, s, a) {
  const row = document.createElement('div');
  row.className = 'action-row';

  const label = document.createElement('span');
  label.textContent = a.name + (a.zone ? ` (${a.zone})` : '') + (a.status === 'done' ? ' — done' : '');
  row.appendChild(label);

  if (a.status === 'done') {
    const info = document.createElement('span');
    info.className = 'muted';
    info.textContent = `by ${a.executedBy}`;
    row.appendChild(info);
    return row;
  }

  const execBtn = document.createElement('button');
  execBtn.type = 'button';
  execBtn.className = 'btn btn-small';
  execBtn.textContent = 'Execute';
  row.appendChild(execBtn);

  execBtn.addEventListener('click', () => {
    if (row.querySelector('.execute-form')) return;
    const form = document.createElement('div');
    form.className = 'execute-form';
    form.style.marginTop = '8px';
    form.style.width = '100%';
    const notesInput = document.createElement('input'); notesInput.placeholder = 'Notes';
    const resultsInput = document.createElement('input'); resultsInput.placeholder = 'Results'; resultsInput.style.marginTop = '6px';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-small btn-primary'; saveBtn.textContent = 'Save'; saveBtn.style.marginTop = '6px';
    form.append(notesInput, document.createElement('br'), resultsInput, document.createElement('br'), saveBtn);
    row.appendChild(form);
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      await updateDoc(doc(db, 'cases', c.id, 'samples', s.id, 'actions', a.id), {
        notes: notesInput.value,
        results: resultsInput.value,
        status: 'done',
        executedBy: myProfile.username,
        executedAt: serverTimestamp()
      });
      await maybeAutoAdvanceToWriting(c.id);
      await renderCaseDetail(c.id);
    });
  });

  return row;
}

// "lab" -> "writing" is automatic once every sample's every action is
// done. There's no Cloud Functions / server trigger on this project (see
// SPEC.md's Authentication section on staying off Blaze), so this check
// runs client-side right after whichever action turns out to be the last
// one -- not a true server-side guarantee, but achieves the same result
// for a single-admin-at-a-time tool like this.
async function maybeAutoAdvanceToWriting(caseId) {
  const caseSnap = await getDoc(doc(db, 'cases', caseId));
  if (!caseSnap.exists() || caseSnap.data().stage !== 'lab') return;
  const samplesSnap = await getDocs(collection(db, 'cases', caseId, 'samples'));
  if (samplesSnap.empty) return;
  for (const sDoc of samplesSnap.docs) {
    const actionsSnap = await getDocs(collection(db, 'cases', caseId, 'samples', sDoc.id, 'actions'));
    if (actionsSnap.empty) return;
    for (const aDoc of actionsSnap.docs) {
      if (aDoc.data().status !== 'done') return;
    }
  }
  await updateDoc(doc(db, 'cases', caseId), { stage: 'writing' });
}

// ---------------------------------------------------------------------
// Archiving workflow -- stored as an array field directly on the case
// doc (not a subcollection; see TASK's data model note). Rename/remove/
// add are available to team_leader/admin any time ("established during
// new... freely editable afterward"); "Mark done" only once the case has
// actually reached the archiving stage.
// ---------------------------------------------------------------------
function buildArchivingSection(c) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Archiving workflow';
  section.appendChild(h3);

  const canEdit = myProfile.role === 'team_leader' || myProfile.role === 'admin';
  const canExecute = c.stage === 'archiving';
  const items = c.archivingWorkflow || [];

  items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => a.item.order - b.item.order)
    .forEach(({ item, idx }) => section.appendChild(buildArchivingItemRow(c, item, idx, canEdit, canExecute)));

  if (canEdit) {
    const addForm = document.createElement('form');
    addForm.className = 'add-row';
    const nameInput = document.createElement('input'); nameInput.placeholder = 'New step name'; nameInput.required = true;
    const orderInput = document.createElement('input'); orderInput.type = 'number'; orderInput.placeholder = 'Order'; orderInput.style.maxWidth = '80px';
    const nameField = document.createElement('div'); nameField.className = 'field'; nameField.appendChild(nameInput);
    const orderField = document.createElement('div'); orderField.className = 'field'; orderField.appendChild(orderInput);
    const addBtn = document.createElement('button'); addBtn.type = 'submit'; addBtn.className = 'btn btn-small'; addBtn.textContent = 'Add step';
    addForm.append(nameField, orderField, addBtn);
    section.appendChild(addForm);
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
  }

  return section;
}

function buildArchivingItemRow(c, item, idx, canEdit, canExecute) {
  const row = document.createElement('div');
  row.className = 'action-row';
  const label = document.createElement('span');
  label.textContent = item.name + (item.status === 'done' ? ' — done' : '');
  row.appendChild(label);

  const controls = document.createElement('span');

  if (canEdit) {
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button'; renameBtn.className = 'btn btn-small'; renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      if (row.querySelector('.rename-form')) return;
      const form = document.createElement('span');
      form.className = 'rename-form';
      const input = document.createElement('input');
      input.value = item.name; input.style.width = '140px'; input.style.marginLeft = '6px';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-small'; saveBtn.textContent = 'Save'; saveBtn.style.marginLeft = '6px';
      form.append(input, saveBtn);
      row.appendChild(form);
      saveBtn.addEventListener('click', async () => {
        const updated = c.archivingWorkflow.map((it, i) => (i === idx ? { ...it, name: input.value.trim() || it.name } : it));
        await updateDoc(doc(db, 'cases', c.id), { archivingWorkflow: updated });
        await renderCaseDetail(c.id);
      });
    });
    controls.appendChild(renameBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'btn btn-small'; removeBtn.textContent = 'Remove';
    removeBtn.style.marginLeft = '6px';
    removeBtn.addEventListener('click', async () => {
      const updated = c.archivingWorkflow.filter((_, i) => i !== idx);
      await updateDoc(doc(db, 'cases', c.id), { archivingWorkflow: updated });
      await renderCaseDetail(c.id);
    });
    controls.appendChild(removeBtn);
  }

  if (canExecute && item.status !== 'done') {
    const execBtn = document.createElement('button');
    execBtn.type = 'button'; execBtn.className = 'btn btn-small btn-primary'; execBtn.textContent = 'Mark done';
    execBtn.style.marginLeft = '6px';
    execBtn.addEventListener('click', async () => {
      // serverTimestamp() isn't supported inside array elements, so this
      // uses a plain client-side Date -- still stored as a real Firestore
      // Timestamp, just not the server-computed sentinel.
      const updated = c.archivingWorkflow.map((it, i) => (i === idx ? { ...it, status: 'done', executedBy: myProfile.username, executedAt: new Date() } : it));
      await updateDoc(doc(db, 'cases', c.id), { archivingWorkflow: updated });
      await renderCaseDetail(c.id);
    });
    controls.appendChild(execBtn);
  }

  row.appendChild(controls);
  return row;
}
