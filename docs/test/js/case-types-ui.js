import { db } from './firebase-init.js?v=0.4.1-t07';
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ---------------------------------------------------------------------
// Admin: case type CRUD (0.4.1). A case type's `labWorkflowTemplate` /
// `archivingWorkflowTemplate` are what a new case's own lab/archiving
// workflows get seeded from at creation (see cases.js). Building a full
// nested-workflow template editor is out of scope for this pass -- the
// "Seed default workflow" checkbox below is the pragmatic stand-in for
// TASK's "seed one case type for this pass: failure analysis, with its
// case type workflow set to the existing default..." A case type left
// unchecked just gets empty template arrays, matching SPEC's "a case type
// with no template gives its cases an empty case workflow to build
// manually." Logged as a judgment call in HANDOFF.md.
// ---------------------------------------------------------------------
const addCaseTypeForm = document.getElementById('addCaseTypeForm');
const addCaseTypeError = document.getElementById('addCaseTypeError');
const caseTypeListBody = document.getElementById('caseTypeListBody');

export const DEFAULT_LAB_WORKFLOW_TEMPLATE = [
  { name: 'Visual Inspection', type: 'simple' },
  { name: 'Composition Analysis', type: 'simple' },
  { name: 'Hardness Test', type: 'simple' }
];
export const DEFAULT_ARCHIVING_WORKFLOW_TEMPLATE = [
  { name: 'Publish', order: 1 },
  { name: 'Close-in-access', order: 2 },
  { name: 'Return parts', order: 3 },
  { name: 'Archive samples', order: 3 },
  { name: 'Scan', order: 4 }
];

let caseTypes = [];

export async function loadCaseTypes() {
  const snap = await getDocs(collection(db, 'caseTypes'));
  caseTypes = [];
  snap.forEach((d) => caseTypes.push({ id: d.id, ...d.data() }));
  caseTypes.sort((a, b) => a.name.localeCompare(b.name));
  return caseTypes;
}

export function getCachedCaseTypes() {
  return caseTypes;
}

export function findCaseTypeById(id) {
  return caseTypes.find((ct) => ct.id === id) || null;
}

export async function renderCaseTypeList() {
  await loadCaseTypes();
  caseTypeListBody.innerHTML = '';
  if (caseTypes.length === 0) {
    caseTypeListBody.innerHTML = '<tr><td colspan="3" class="muted">No case types yet.</td></tr>';
    return;
  }
  caseTypes.forEach((ct) => caseTypeListBody.appendChild(renderCaseTypeRow(ct)));
}

function renderCaseTypeRow(ct) {
  const tr = document.createElement('tr');
  const nameTd = document.createElement('td'); nameTd.textContent = ct.name;
  const tatTd = document.createElement('td'); tatTd.textContent = ct.tatGoalDays != null ? `${ct.tatGoalDays}d` : '—';
  const actionTd = document.createElement('td');
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-small';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete case type "${ct.name}"? Existing cases keep their own copy of any seeded workflow, so this doesn't affect them.`)) return;
    await deleteDoc(doc(db, 'caseTypes', ct.id));
    renderCaseTypeList();
  });
  actionTd.appendChild(deleteBtn);
  tr.append(nameTd, tatTd, actionTd);
  return tr;
}

addCaseTypeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addCaseTypeError.textContent = '';
  const name = document.getElementById('newCaseTypeName').value.trim();
  const tatRaw = document.getElementById('newCaseTypeTat').value;
  const seedDefault = document.getElementById('newCaseTypeSeedDefault').checked;
  if (!name) { addCaseTypeError.textContent = 'Name is required.'; return; }
  try {
    await addDoc(collection(db, 'caseTypes'), {
      name,
      tatGoalDays: tatRaw ? parseInt(tatRaw, 10) : null,
      labWorkflowTemplate: seedDefault ? DEFAULT_LAB_WORKFLOW_TEMPLATE : [],
      archivingWorkflowTemplate: seedDefault ? DEFAULT_ARCHIVING_WORKFLOW_TEMPLATE : []
    });
    addCaseTypeForm.reset();
    renderCaseTypeList();
  } catch (err) {
    addCaseTypeError.textContent = `Couldn't add case type: ${err.message}`;
  }
});
