import { db } from './firebase-init.js?v=0.5.0-t02';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { loadCaseTypes, getCachedCaseTypes, findCaseTypeById } from './case-types-ui.js?v=0.5.0-t02';
import {
  loadClientOrgsAndClients, getCachedClientOrgs, getCachedClientsForOrg, fetchClientsForOrg,
  findClientById, findClientOrgById
} from './clients-ui.js?v=0.5.0-t02';
import {
  emptyWorkflow, seedWorkflow, isTaskDone, currentPathOf, updateAtPath, recomputeAdvancement
} from './workflow.js?v=0.5.0-t02';

// ---------------------------------------------------------------------
// Core case/sample/workflow model. Internal to the lab team -- admin has
// zero rule-level access to any of this now (see setup/firestore.rules),
// and clients get their own, separately-scoped read-only view
// (client-view.js). 0.5.0 replaced the fixed new/lab/write/archive/done
// stage enum and per-sample actions with the generic Workflow/Action/Task
// primitive (see workflow.js and SPEC.md's "The Workflow / Action / Task
// primitive") -- a case now has one top-level Workflow, and samples are
// pure item/zone/name structure with no actions of their own (a task gets
// tagged with which sample(s)/zone(s) it applies to live, at execution
// time, not the other way around).
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
const EDIT_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;

let myProfile = null; // { uid, username, role }
let cases = [];
let infoEditMode = false;
let expandedSamples = new Set();
let editingSamples = new Set();
let notesShown = false;
let viewedPath = null; // null = follow the workflow's real current path (see workflow.js's currentPathOf)

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
      onHold: false,
      highPriority: false,
      showResearchToClient: false,
      dueDateOverride: null,
      // 0.5.0: replaces stage/writingStage/labWorkflowTemplate/
      // archivingWorkflow entirely -- a case now has exactly one top-level
      // Workflow, deep-copied from its case type's authored template at
      // creation time (empty if the case type has none, or none picked).
      // A later edit to the case type itself doesn't retroactively change
      // an already-created case's own copy.
      workflow: seedWorkflow(caseType ? caseType.workflowTemplate : null)
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
// 0.5.0: there's no fixed stage enum anymore -- a case's "stage" is just
// whichever top-level Workflow item its workflow.currentIndex points at,
// named however admin named it (see workflow.js's currentPathOf/
// recomputeAdvancement).
function currentTopLevelLabel(c) {
  const items = (c.workflow && c.workflow.items) || [];
  if (items.length === 0) return 'No workflow';
  const idx = Math.min(c.workflow.currentIndex || 0, items.length - 1);
  return items[idx].name;
}
// On-hold/research act as the status itself (replacing the plain stage
// name) rather than separate tags -- at the user's request, since a case
// that's on hold or under research isn't really "in New/Lab/..." in any
// way worth showing alongside a hold/research flag. High priority doesn't
// replace the status, just marks it with a star. On hold wins if a case
// is somehow both on hold and flagged for research, since "on hold" is
// the more blocking of the two states.
function effectiveStatusText(c) {
  const base = c.onHold ? 'On hold' : c.showResearchToClient ? 'Research' : currentTopLevelLabel(c);
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

// Gates the case's own info fields (name/dates/client/etc.) and deletion --
// unchanged in spirit from 0.4.1. Executing/verifying workflow tasks is
// NOT gated by this (see setup/firestore.rules' new case-update rule):
// under 0.5.0, a task's fields live inside the case doc's own `workflow`
// field rather than a separate staff-writable subcollection, so a plain
// case-staff member who isn't the case manager still needs to be able to
// write that one field even though they can't touch the rest of the case
// doc -- the rule allows any case-staff write as long as `workflow` is the
// only field that changed. This also retires 0.4.1's "auto-advance only
// fires for whoever's allowed to write the case doc, otherwise it's caught
// up next time an authorized user opens the case" workaround entirely --
// every case-staff member can now always save their own advancement.
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
  viewedPath = null;
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

async function renderCaseDetail(caseId) {
  const caseSnap = await getDoc(doc(db, 'test_cases', caseId));
  if (!caseSnap.exists()) {
    caseMainView.innerHTML = '<p class="error">Case not found.</p>';
    return;
  }
  const c = { id: caseId, ...caseSnap.data() };
  if (!c.workflow) c.workflow = emptyWorkflow();

  // 0.5.0: samples no longer have their own actions subcollection -- a
  // task gets tagged against sample(s)/zone(s) live, from inside the
  // workflow section, instead of a sample owning its own action list. No
  // more N+1 per-sample fetch here either.
  const samplesSnap = await getDocs(collection(db, 'test_cases', caseId, 'test_samples'));
  const samples = [];
  samplesSnap.forEach((sDoc) => samples.push({ id: sDoc.id, ...sDoc.data() }));
  samples.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  caseDetailTitle.innerHTML = '';
  caseHeaderLines(c).forEach((line) => {
    const lineEl = document.createElement('div');
    lineEl.textContent = line;
    caseDetailTitle.appendChild(lineEl);
  });
  editInfoBtn.classList.toggle('hidden', !canUpdateCase(c));
  editInfoBtn.classList.toggle('active', infoEditMode);
  deleteCaseBtn.classList.toggle('hidden', myProfile.role !== 'team_leader');
  caseMainView.innerHTML = '';
  const infoSection = buildInfoSection(c);
  if (infoSection) caseMainView.appendChild(infoSection);
  caseMainView.appendChild(buildWorkflowSection(c, samples));
  caseMainView.appendChild(buildSamplesSection(c, samples));
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
// Workflow section (0.5.0 rebuild) -- renders whatever the case's own
// top-level Workflow actually contains, recursing into nested Actions,
// down to whichever Task is being viewed. See workflow.js for the
// underlying primitive and SPEC.md's "The Workflow / Action / Task
// primitive" for the design this replaces the old fixed New/Lab/Write/
// Archive/Done + writing/archiving-workflow machinery with entirely.
// ---------------------------------------------------------------------
function readonlyNote(text) {
  const p = document.createElement('p'); p.className = 'muted';
  p.textContent = text;
  return p;
}

// Long-press (phone) / right-click (desktop) -- same gesture and timing
// already used for the header logo's jump-to-test/root gesture in
// auth-ui.js, reused here for the stage-circle force-jump.
function attachLongPress(el, callback) {
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); callback(); });
  let timer = null;
  el.addEventListener('touchstart', () => { timer = setTimeout(callback, 600); });
  ['touchend', 'touchmove', 'touchcancel'].forEach((evt) => el.addEventListener(evt, () => clearTimeout(timer)));
}

// Long-press a stage circle -> confirm popover -> forces workflowLike's own
// currentIndex to `idx` regardless of whether the automatic advancement
// condition is actually met (SPEC.md's "Manual override"). A plain tap
// only ever *previews* (see buildWorkflowLevel) -- this is the one real
// way to move backward, since recomputeAdvancement itself is forward-only.
function attachForceJump(btn, anchorEl, c, ancestorPath, idx, targetLabel) {
  attachLongPress(btn, () => {
    if (anchorEl.querySelector('.confirm-row')) return;
    const confirmRow = document.createElement('div');
    confirmRow.className = 'confirm-row';
    confirmRow.style.cssText = 'position:absolute; left:0; top:66px; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px; width:230px; z-index:5;';
    const msg = document.createElement('p'); msg.className = 'error'; msg.style.margin = '0 0 8px';
    msg.textContent = `Jump to "${targetLabel}" now, skipping the normal order?`;
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Jump';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '8px';
    cancelBtn.addEventListener('click', () => confirmRow.remove());
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      const updated = updateAtPath(c.workflow, ancestorPath, (level) => ({ ...level, currentIndex: idx }));
      recomputeAdvancement(updated);
      await updateDoc(doc(db, 'test_cases', c.id), { workflow: updated });
      viewedPath = [...ancestorPath, idx];
      await renderCaseDetail(c.id);
    });
    confirmRow.append(msg, confirmBtn, cancelBtn);
    anchorEl.appendChild(confirmRow);
  });
}

function buildWorkflowSection(c, samples) {
  const section = document.createElement('div');
  section.className = 'case-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Workflow';
  section.appendChild(h3);

  if (!c.workflow.items || c.workflow.items.length === 0) {
    section.appendChild(readonlyNote('No workflow defined for this case type yet.'));
    return section;
  }

  if (!viewedPath) viewedPath = currentPathOf(c.workflow);
  section.appendChild(buildWorkflowLevel(c, c.workflow, [], samples, true));
  return section;
}

// One items[]-bearing level (the case's own top-level Workflow, or any
// nested Action's own items) -- a circle strip (reusing the same
// stage-flow visual device 0.4.1 built for the fixed 5-stage case, now
// applied at every nesting depth) plus whichever child is being viewed
// below it. `ancestorLive` threads down whether every ancestor level was
// ALSO pointing at its own real current item -- a Task's controls only go
// live when the *entire* path from the root matches the workflow's real
// current path, otherwise it's a read-only preview (0.4.1's
// read-only-elsewhere rule, generalized to arbitrary depth).
function buildWorkflowLevel(c, workflowLike, ancestorPath, samples, ancestorLive) {
  const wrap = document.createElement('div');
  wrap.className = 'workflow-level';

  const realCurrentIdx = Math.min(workflowLike.currentIndex || 0, workflowLike.items.length - 1);
  const viewedIdx = viewedPath.length > ancestorPath.length ? viewedPath[ancestorPath.length] : realCurrentIdx;

  const flow = document.createElement('div'); flow.className = 'stage-flow';
  workflowLike.items.forEach((node, idx) => {
    if (idx > 0) {
      const line = document.createElement('div');
      line.className = 'stage-flow-line';
      if (idx <= realCurrentIdx) line.classList.add('done');
      flow.appendChild(line);
    }
    const nodePath = [...ancestorPath, idx];
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'stage-flow-node';
    if (idx < realCurrentIdx) btn.classList.add('done');
    if (idx === realCurrentIdx) btn.classList.add('current');
    if (idx === viewedIdx) btn.classList.add('viewed');
    btn.textContent = node.name;
    btn.title = node.name + (idx === realCurrentIdx ? ' (current -- long-press/right-click any circle to force-jump)' : '');
    if (idx === realCurrentIdx) btn.setAttribute('aria-current', 'step');
    btn.addEventListener('click', () => { viewedPath = nodePath; renderCaseDetail(c.id); });
    attachForceJump(btn, flow, c, ancestorPath, idx, node.name);
    flow.appendChild(btn);
  });
  wrap.appendChild(flow);

  const viewedNode = workflowLike.items[viewedIdx];
  const isLiveHere = ancestorLive && viewedIdx === realCurrentIdx;

  if (viewedNode.kind === 'action') {
    if (!viewedNode.items || viewedNode.items.length === 0) {
      wrap.appendChild(readonlyNote(`${viewedNode.name}: no steps yet.`));
    } else {
      wrap.appendChild(buildWorkflowLevel(c, viewedNode, [...ancestorPath, viewedIdx], samples, isLiveHere));
    }
  } else {
    wrap.appendChild(buildTaskPanel(c, viewedNode, [...ancestorPath, viewedIdx], samples, isLiveHere));
  }

  return wrap;
}

function taskStatusSummary(task) {
  if (isTaskDone(task)) return 'Done.';
  if (task.executedBy) return `Executed by ${task.executedBy}${task.isVerifiable && !task.verifiedBy ? ', awaiting verification.' : '.'}`;
  return 'Not started.';
}

function buildValueSummary(values) {
  const wrap = document.createElement('p'); wrap.className = 'muted';
  wrap.textContent = (values && values.length) ? values.map((v) => `${v.name}: ${v.value}`).join(' · ') : '(no values recorded)';
  return wrap;
}

// Live tagging of which sample(s)/zone(s) a task applies to -- a list, set
// at execution time, not something a sample owns (SPEC.md's "Item / Sample
// / Zone"). Plain toggle chips rather than a <select multiple> for
// friendlier touch targets.
function buildAssignmentEditor(c, task, path, samples) {
  const wrap = document.createElement('div'); wrap.className = 'task-assignment';
  const label = document.createElement('label'); label.textContent = 'Samples / zones';
  wrap.appendChild(label);

  const options = [];
  samples.forEach((s) => {
    const base = s.item ? `${s.item} - ${s.name}` : s.name;
    options.push({ sampleId: s.id, zone: null, label: base });
    (s.zones || []).forEach((z) => options.push({ sampleId: s.id, zone: z, label: `${base} (${z})` }));
  });
  if (options.length === 0) {
    wrap.appendChild(readonlyNote('No samples yet.'));
    return wrap;
  }

  const chipsWrap = document.createElement('div');
  chipsWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
  options.forEach((opt) => {
    const isAssigned = (task.assignedTo || []).some((a) => a.sampleId === opt.sampleId && a.zone === opt.zone);
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'btn btn-small' + (isAssigned ? ' active' : '');
    chip.textContent = opt.label;
    chip.addEventListener('click', () => {
      const current = task.assignedTo || [];
      const exists = current.some((a) => a.sampleId === opt.sampleId && a.zone === opt.zone);
      const next = exists
        ? current.filter((a) => !(a.sampleId === opt.sampleId && a.zone === opt.zone))
        : [...current, { sampleId: opt.sampleId, zone: opt.zone }];
      saveTaskField(c, path, { assignedTo: next });
    });
    chipsWrap.appendChild(chip);
  });
  wrap.appendChild(chipsWrap);
  return wrap;
}

// Fills in a task's value-object template: a fixed slot gets one input, a
// duplicable one starts with one and can add more live ("+ Add another"),
// per SPEC.md's Task field list. Shared between Execute (executorValues)
// and Verify (verifierValues, an independent set against the same
// template, not a copy of the executor's numbers).
function buildExecuteForm(c, task, path, label, onSave) {
  const form = document.createElement('div'); form.className = 'task-execute-form';
  const rowsBySlot = new Map();

  (task.values || []).forEach((slot) => {
    const slotWrap = document.createElement('div'); slotWrap.className = 'field';
    const slotLabel = document.createElement('label');
    slotLabel.textContent = slot.name + (slot.mode === 'duplicable' ? ' (add as many as needed)' : '');
    slotWrap.appendChild(slotLabel);
    const inputsWrap = document.createElement('div');
    slotWrap.appendChild(inputsWrap);
    const inputs = [];
    rowsBySlot.set(slot.name, inputs);

    function addInstance() {
      const row = document.createElement('div'); row.className = 'value-row';
      const input = document.createElement('input'); input.className = 'mono';
      row.appendChild(input);
      if (slot.mode === 'duplicable') {
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn btn-small'; rm.textContent = '✕';
        rm.addEventListener('click', () => { row.remove(); inputs.splice(inputs.indexOf(input), 1); });
        row.appendChild(rm);
      }
      inputsWrap.appendChild(row);
      inputs.push(input);
    }
    addInstance();

    if (slot.mode === 'duplicable') {
      const addBtn = document.createElement('button');
      addBtn.type = 'button'; addBtn.className = 'btn btn-small'; addBtn.textContent = '+ Add another';
      addBtn.addEventListener('click', addInstance);
      slotWrap.appendChild(addBtn);
    }
    form.appendChild(slotWrap);
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'btn btn-primary btn-small'; saveBtn.textContent = label;
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const values = [];
    rowsBySlot.forEach((inputs, name) => {
      inputs.forEach((input) => {
        const v = input.value.trim();
        if (v) values.push({ name, value: v });
      });
    });
    await onSave(values);
  });
  form.appendChild(saveBtn);
  return form;
}

async function saveTaskField(c, path, patch) {
  const updated = updateAtPath(c.workflow, path, (node) => ({ ...node, ...patch }));
  recomputeAdvancement(updated);
  await updateDoc(doc(db, 'test_cases', c.id), { workflow: updated });
  await renderCaseDetail(c.id);
}

function buildTaskPanel(c, task, path, samples, isLive) {
  const wrap = document.createElement('div'); wrap.className = 'task-panel';
  const title = document.createElement('h4'); title.textContent = task.name;
  wrap.appendChild(title);

  if (!isLive) {
    wrap.appendChild(readonlyNote(taskStatusSummary(task)));
    return wrap;
  }

  // isComplete -- a plain manual toggle that can force a task done
  // regardless of whether its value objects are filled in (SPEC.md).
  const completeLabel = document.createElement('label'); completeLabel.className = 'checkbox-inline';
  const completeInput = document.createElement('input'); completeInput.type = 'checkbox'; completeInput.checked = !!task.isComplete;
  completeInput.addEventListener('change', () => saveTaskField(c, path, { isComplete: completeInput.checked }));
  completeLabel.append(completeInput, ' Mark complete');
  wrap.appendChild(completeLabel);

  wrap.appendChild(buildAssignmentEditor(c, task, path, samples));

  if (!task.executedBy) {
    // Plain client-side Date, not serverTimestamp() -- the sentinel isn't
    // supported on a value nested inside an array (this task lives inside
    // `workflow`'s items[] tree), same constraint 0.4.1's archiving
    // workflow already hit. Still stored as a real Firestore Timestamp.
    wrap.appendChild(buildExecuteForm(c, task, path, 'Execute', (values) => saveTaskField(c, path, {
      executedBy: myProfile.username, executionTimestamp: new Date(), executorValues: values
    })));
    return wrap;
  }

  const execInfo = document.createElement('p'); execInfo.className = 'muted';
  execInfo.textContent = `Executed by ${task.executedBy}`;
  wrap.appendChild(execInfo);
  wrap.appendChild(buildValueSummary(task.executorValues));

  if (task.isVerifiable) {
    if (task.verifiedBy) {
      const verInfo = document.createElement('p'); verInfo.className = 'muted';
      verInfo.textContent = `Verified by ${task.verifiedBy}`;
      wrap.appendChild(verInfo);
      wrap.appendChild(buildValueSummary(task.verifierValues));
    } else if (task.executedBy !== myProfile.username) {
      wrap.appendChild(buildExecuteForm(c, task, path, 'Verify', (values) => saveTaskField(c, path, {
        verifiedBy: myProfile.username, verificationTimestamp: new Date(), verifierValues: values
      })));
    } else {
      wrap.appendChild(readonlyNote('(awaiting verification by someone else)'));
    }
  }

  const reopenBtn = document.createElement('button');
  reopenBtn.type = 'button'; reopenBtn.className = 'btn btn-small'; reopenBtn.textContent = 'Reopen';
  reopenBtn.style.marginTop = '10px';
  reopenBtn.addEventListener('click', () => saveTaskField(c, path, {
    executedBy: null, executionTimestamp: null, executorValues: [],
    verifiedBy: null, verificationTimestamp: null, verifierValues: []
  }));
  wrap.appendChild(reopenBtn);

  return wrap;
}

// Firestore doesn't cascade-delete subcollections -- every sample and note
// doc has to be deleted individually before the case doc itself. 0.5.0:
// samples no longer have their own actions subcollection (see workflow.js)
// -- the case's own `workflow` field goes away automatically with the case
// doc, nothing extra to clean up there.
async function deleteCaseCascade(caseId) {
  const samplesSnap = await getDocs(collection(db, 'test_cases', caseId, 'test_samples'));
  for (const sDoc of samplesSnap.docs) {
    await deleteDoc(doc(db, 'test_cases', caseId, 'test_samples', sDoc.id));
  }
  const notesSnap = await getDocs(collection(db, 'test_cases', caseId, 'notes'));
  for (const nDoc of notesSnap.docs) {
    await deleteDoc(doc(db, 'test_cases', caseId, 'notes', nDoc.id));
  }
  await deleteDoc(doc(db, 'test_cases', caseId));
}

// ---------------------------------------------------------------------
// Samples. `item` (renamed from `groupName`, 0.4.1) is the optional label
// above a sample; `sample` is the only mandatory unit. Each sample has a
// compact (default) and full (expanded) view. 0.5.0: samples are pure
// item/zone/name structure with no actions of their own -- see workflow.js
// and SPEC.md's "Item / Sample / Zone".
// ---------------------------------------------------------------------

// Repeatable named-row editor -- one text input per row, used for the
// batch-add view's sample-name/zone lists and for editing an existing
// sample's zones in place (buildSampleStructureCard's edit mode). Reuses
// .value-row's flex/wrap styling (built for the action value editors)
// since a single-input row fits that layout fine too. `initialValues`
// pre-populates rows (e.g. a sample's existing zones) without stealing
// focus the way a freshly-added row does.
function buildNameListEditor(addButtonLabel, placeholder, initialValues = []) {
  const wrap = document.createElement('div');
  const rows = document.createElement('div');
  wrap.appendChild(rows);
  function addRow(value, focusNewRow) {
    const row = document.createElement('div'); row.className = 'value-row';
    const input = document.createElement('input'); input.placeholder = placeholder;
    if (value) input.value = value;
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn btn-small'; rm.textContent = '✕';
    rm.addEventListener('click', () => row.remove());
    row.append(input, rm);
    rows.appendChild(row);
    if (focusNewRow) input.focus();
  }
  initialValues.forEach((v) => addRow(v, false));
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-small'; addBtn.textContent = addButtonLabel;
  addBtn.addEventListener('click', () => addRow(null, true));
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
        await addDoc(collection(db, 'test_cases', c.id, 'test_samples'), { item: entry.item, name: entry.name, zones });
      }
      await renderCaseDetail(c.id);
    } catch (ex) {
      err.textContent = `Couldn't add sample(s): ${ex.message}`;
      createBtn.disabled = false;
    }
  });

  samples.forEach((s) => section.appendChild(buildSampleStructureCard(c, s)));
  return section;
}

// Duplicate naming (2026-09-22, at the user's request): strips a trailing
// " (N)" off the sample being duplicated to find its base name, looks at
// every other sample with the same `item` whose name shares that base, and
// names the copy one past the highest number in use -- e.g. duplicating
// "Head (1)" when "Head (2)" already exists produces "Head (3)", not
// "Head (2) (copy)". A sample with no numeric suffix counts as instance 1.
// Queried fresh at click time (not off the possibly-stale render-time
// `samples` list) so concurrent additions by someone else aren't missed.
async function nextDuplicateName(caseId, item, name) {
  const baseMatch = name.match(/^(.*) \((\d+)\)$/);
  const baseName = baseMatch ? baseMatch[1] : name;
  const siblingsSnap = await getDocs(query(collection(db, 'test_cases', caseId, 'test_samples'), where('item', '==', item)));
  let maxNum = 1;
  siblingsSnap.docs.forEach((d) => {
    const siblingName = d.data().name || '';
    const m = siblingName.match(/^(.*) \((\d+)\)$/);
    const siblingBase = m ? m[1] : siblingName;
    if (siblingBase !== baseName) return;
    const n = m ? parseInt(m[2], 10) : 1;
    if (n > maxNum) maxNum = n;
  });
  return `${baseName} (${maxNum + 1})`;
}

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

  const isEditing = editingSamples.has(s.id);

  if (isEditing) {
    // Full inline edit form -- item, name, and a re-populated zones list
    // editor (rename/remove any zone, add new ones), replacing the old
    // read-only display + one-off "+ Zone" quick-add (2026-09-23, at the
    // user's request: "allow sample edit -- name, zone names, deleting
    // zones"). Save writes all three fields in one updateDoc; Cancel just
    // exits edit mode with no write.
    const editForm = document.createElement('div');
    editForm.className = 'sample-edit-form';

    const itemField = document.createElement('div'); itemField.className = 'field';
    const itemLabel = document.createElement('label'); itemLabel.textContent = 'Item';
    const itemInput = document.createElement('input'); itemInput.value = s.item || '';
    itemField.append(itemLabel, itemInput);
    editForm.appendChild(itemField);

    const nameField = document.createElement('div'); nameField.className = 'field';
    const nameLabel = document.createElement('label'); nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input'); nameInput.value = s.name || '';
    nameField.append(nameLabel, nameInput);
    editForm.appendChild(nameField);

    const zonesLabel = document.createElement('label'); zonesLabel.textContent = 'Zones';
    editForm.appendChild(zonesLabel);
    const zoneListEditor = buildNameListEditor('+ Zone', 'Zone name', s.zones || []);
    editForm.appendChild(zoneListEditor);

    const err = document.createElement('div'); err.className = 'error';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'btn btn-small btn-primary'; saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '8px';
    saveBtn.style.marginTop = '10px';
    editForm.append(saveBtn, cancelBtn, err);
    card.appendChild(editForm);

    cancelBtn.addEventListener('click', () => {
      editingSamples.delete(s.id);
      renderCaseDetail(c.id);
    });
    saveBtn.addEventListener('click', async () => {
      const newName = nameInput.value.trim();
      if (!newName) { err.textContent = 'Name is required.'; return; }
      saveBtn.disabled = true;
      await updateDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id), {
        item: itemInput.value.trim() || null,
        name: newName,
        zones: zoneListEditor.getValues()
      });
      editingSamples.delete(s.id);
      await renderCaseDetail(c.id);
    });

    return card;
  }

  // Read-only zones display -- switches to the edit form above via the
  // Edit icon below.
  const zonesRow = document.createElement('div');
  zonesRow.style.display = 'flex'; zonesRow.style.alignItems = 'center'; zonesRow.style.gap = '8px'; zonesRow.style.flexWrap = 'wrap';
  const zonesText = document.createElement('span'); zonesText.className = 'muted';
  zonesText.textContent = s.zones && s.zones.length ? 'Zones: ' + s.zones.join(', ') : 'No zones yet';
  zonesRow.append(zonesText);
  card.appendChild(zonesRow);

  // Edit + Duplicate + Delete -- common per-sample actions, shown as small
  // icon buttons rather than text (at the user's request, 2026-09-22: "for
  // common actions use icons"), matching the icon-btn pattern already used
  // for the case-detail header and overview row (TRASH_ICON_SVG etc.).
  // Edit and Duplicate are open to any case staff (same write permission
  // as adding a sample). Duplicate copies item/name/zones and seeds fresh
  // default actions, exactly like creating a new sample, just pre-filled.
  // Delete stays team_leader-only, matching setup/firestore.rules' samples
  // delete rule (unchanged from Iteration 4); it cascade-deletes the
  // sample's own actions first, same reasoning as case deletion: Firestore
  // doesn't cascade subcollections on its own.
  const actionsRow = document.createElement('div');
  actionsRow.className = 'sample-actions-row';

  const editBtn = document.createElement('button');
  editBtn.type = 'button'; editBtn.className = 'icon-btn icon-btn-small icon-btn-accent';
  editBtn.title = 'Edit sample'; editBtn.setAttribute('aria-label', 'Edit sample');
  editBtn.innerHTML = EDIT_ICON_SVG;
  editBtn.addEventListener('click', () => {
    editingSamples.add(s.id);
    renderCaseDetail(c.id);
  });
  actionsRow.appendChild(editBtn);

  const duplicateBtn = document.createElement('button');
  duplicateBtn.type = 'button'; duplicateBtn.className = 'icon-btn icon-btn-small icon-btn-accent';
  duplicateBtn.title = 'Duplicate sample'; duplicateBtn.setAttribute('aria-label', 'Duplicate sample');
  duplicateBtn.innerHTML = DUPLICATE_ICON_SVG;
  duplicateBtn.addEventListener('click', async () => {
    duplicateBtn.disabled = true;
    try {
      // If the original has no running number yet, give it "(1)" as part
      // of this same operation, so the two samples read as a clear pair
      // ("Screw (1)"/"Screw (2)") instead of one bare and one numbered
      // (2026-09-23, at the user's request). Only the original's own name
      // needs updating -- nextDuplicateName's sibling scan already treats
      // an unnumbered name as instance 1 when computing the copy's number.
      if (!/^(.*) \((\d+)\)$/.test(s.name)) {
        await updateDoc(doc(db, 'test_cases', c.id, 'test_samples', s.id), { name: `${s.name} (1)` });
      }
      const newName = await nextDuplicateName(c.id, s.item, s.name);
      await addDoc(collection(db, 'test_cases', c.id, 'test_samples'), { item: s.item, name: newName, zones: s.zones || [] });
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
      msg.textContent = 'Delete this sample?';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Confirm';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '8px';
      cancelBtn.addEventListener('click', () => confirmRow.remove());
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        // 0.5.0: no more per-sample actions subcollection to cascade --
        // deleting the sample doc is the whole operation now (see
        // workflow.js/deleteCaseCascade's comment).
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
