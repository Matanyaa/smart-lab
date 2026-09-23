import { db } from './firebase-init.js?v=0.5.0-t03';
import {
  doc, updateDoc, deleteDoc, collection, getDocs, addDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { newTaskNode, newActionNode, emptyWorkflow, updateAtPath } from './workflow.js?v=0.5.0-t03';
import { loadCatalog, getCachedActionDefs, getCachedTaskDefs, actionDefPath, nodeFromActionDef, nodeFromTaskDef } from './catalog-ui.js?v=0.5.0-t03';

// ---------------------------------------------------------------------
// Admin: case type CRUD, plus the 0.5.0 Workflow-template authoring
// screen. A case type's `workflowTemplate` (replacing 0.4.1's
// `labWorkflowTemplate`/`archivingWorkflowTemplate` split, and the
// "Seed default workflow" checkbox that stood in for a real editor) is
// what a new case's own Workflow gets deep-copied from at creation --
// see cases.js/workflow.js. Phase 1 per TASK.md: plain top-to-bottom
// add/remove/edit, no drag-reorder. 0.5.0-t03 added the reusable Action/Task
// catalog (catalog-ui.js, the new admin Workflow tab) -- every level of
// this editor now also offers "+ From catalog" alongside "+ Task"/
// "+ Action", inserting a copy of a catalog definition (see
// buildCatalogPicker below).
// ---------------------------------------------------------------------
const addCaseTypeForm = document.getElementById('addCaseTypeForm');
const addCaseTypeError = document.getElementById('addCaseTypeError');
const caseTypeListBody = document.getElementById('caseTypeListBody');

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

let caseTypes = [];
let expandedWorkflows = new Set();

export async function loadCaseTypes() {
  const snap = await getDocs(collection(db, 'test_caseTypes'));
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
  // The catalog picker (buildCatalogPicker below) needs actionDefs/
  // taskDefs loaded regardless of whether the admin has visited the
  // Workflow tab yet this session.
  await Promise.all([loadCaseTypes(), loadCatalog()]);
  caseTypeListBody.innerHTML = '';
  if (caseTypes.length === 0) {
    caseTypeListBody.innerHTML = '<tr><td colspan="3" class="muted">No case types yet.</td></tr>';
    return;
  }
  caseTypes.forEach((ct) => {
    caseTypeListBody.appendChild(renderCaseTypeRow(ct));
    if (expandedWorkflows.has(ct.id)) caseTypeListBody.appendChild(buildWorkflowEditorRow(ct));
  });
}

function renderCaseTypeRow(ct) {
  const tr = document.createElement('tr');
  const nameTd = document.createElement('td'); nameTd.textContent = ct.name;
  const tatTd = document.createElement('td'); tatTd.textContent = ct.tatGoalDays != null ? `${ct.tatGoalDays}d` : '—';
  const actionTd = document.createElement('td');

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-small' + (expandedWorkflows.has(ct.id) ? ' active' : '');
  editBtn.textContent = 'Edit workflow';
  editBtn.addEventListener('click', () => {
    if (expandedWorkflows.has(ct.id)) expandedWorkflows.delete(ct.id); else expandedWorkflows.add(ct.id);
    renderCaseTypeList();
  });
  actionTd.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-small';
  deleteBtn.textContent = 'Delete';
  deleteBtn.style.marginLeft = '6px';
  actionTd.appendChild(deleteBtn);
  deleteBtn.addEventListener('click', () => {
    if (actionTd.querySelector('.confirm-row')) return;
    const confirmRow = document.createElement('span');
    confirmRow.className = 'confirm-row';
    confirmRow.style.marginLeft = '8px';
    const msg = document.createElement('span'); msg.className = 'error';
    msg.textContent = `Delete "${ct.name}"? Existing cases keep their own copy of any seeded workflow. `;
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Confirm';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '6px';
    cancelBtn.addEventListener('click', () => confirmRow.remove());
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      await deleteDoc(doc(db, 'test_caseTypes', ct.id));
      expandedWorkflows.delete(ct.id);
      renderCaseTypeList();
    });
    confirmRow.append(msg, confirmBtn, cancelBtn);
    actionTd.appendChild(confirmRow);
  });

  tr.append(nameTd, tatTd, actionTd);
  return tr;
}

function buildWorkflowEditorRow(ct) {
  const tr = document.createElement('tr');
  tr.id = 'wfEditorRow-' + ct.id;
  const td = document.createElement('td'); td.colSpan = 3;
  const container = document.createElement('div');
  container.id = 'wfEditor-' + ct.id;
  container.appendChild(buildItemsEditor(ct, [], ct.workflowTemplate || emptyWorkflow()));
  td.appendChild(container);
  tr.appendChild(td);
  return tr;
}

async function saveTemplate(ct, newWorkflow) {
  await updateDoc(doc(db, 'test_caseTypes', ct.id), { workflowTemplate: newWorkflow });
  ct.workflowTemplate = newWorkflow;
  const container = document.getElementById('wfEditor-' + ct.id);
  if (container) container.replaceChildren(buildItemsEditor(ct, [], ct.workflowTemplate));
}

// Recursive: renders one items[] level (the template root, or an action's
// own nested items) with add-task/add-action controls plus each child's own
// inline editor. `path` is the index path from the template root to THIS
// items[] array. Read-modify-write-back-whole-field-then-rerender-just-
// this-editor, same pattern as the rest of the app's structural editors
// (archiving workflow, sample edit).
function buildItemsEditor(ct, path, workflowLike) {
  const wrap = document.createElement('div');
  wrap.className = 'workflow-editor-level';

  (workflowLike.items || []).forEach((node, idx) => {
    wrap.appendChild(buildNodeEditor(ct, [...path, idx], node));
  });

  const addRow = document.createElement('div');
  addRow.style.cssText = 'display:flex; gap:8px; margin-top:8px;';
  const addTaskBtn = document.createElement('button');
  addTaskBtn.type = 'button'; addTaskBtn.className = 'btn btn-small'; addTaskBtn.textContent = '+ Task';
  addTaskBtn.addEventListener('click', () => addNode(ct, path, newTaskNode('New task')));
  const addActionBtn = document.createElement('button');
  addActionBtn.type = 'button'; addActionBtn.className = 'btn btn-small'; addActionBtn.textContent = '+ Action';
  addActionBtn.addEventListener('click', () => addNode(ct, path, newActionNode('New action')));
  addRow.append(addTaskBtn, addActionBtn);
  wrap.appendChild(addRow);
  wrap.appendChild(buildCatalogPicker(ct, path));

  return wrap;
}

// Picks an existing catalog Action/Task definition (see catalog-ui.js) and
// inserts a fresh copy of it at this level -- picking an action brings its
// whole catalog subtree along (nested action/task defs), since that's the
// point of defining "Make sample" once under "Lab" rather than rebuilding
// it inline in every case type.
function buildCatalogPicker(ct, path) {
  const row = document.createElement('div'); row.className = 'catalog-picker-row';
  const select = document.createElement('select');
  const blankOpt = document.createElement('option'); blankOpt.value = ''; blankOpt.textContent = '(pick from catalog)';
  select.appendChild(blankOpt);
  getCachedActionDefs().forEach((a) => {
    const opt = document.createElement('option');
    opt.value = `action:${a.id}`; opt.textContent = `Action: ${actionDefPath(a.id)}`;
    select.appendChild(opt);
  });
  getCachedTaskDefs().forEach((t) => {
    const opt = document.createElement('option');
    opt.value = `task:${t.id}`;
    opt.textContent = `Task: ${t.parentId ? actionDefPath(t.parentId) + ' > ' + t.name : t.name}`;
    select.appendChild(opt);
  });

  const insertBtn = document.createElement('button');
  insertBtn.type = 'button'; insertBtn.className = 'btn btn-small'; insertBtn.textContent = '+ From catalog';
  insertBtn.addEventListener('click', () => {
    if (!select.value) return;
    const [kind, id] = select.value.split(':');
    const node = kind === 'action' ? nodeFromActionDef(id) : nodeFromTaskDef(id);
    if (node) addNode(ct, path, node);
  });

  row.append(select, insertBtn);
  return row;
}

async function addNode(ct, path, node) {
  const workflow = ct.workflowTemplate || emptyWorkflow();
  const updated = updateAtPath(workflow, path, (level) => ({ ...level, items: [...level.items, node] }));
  await saveTemplate(ct, updated);
}

async function mutateNode(ct, path, mutator) {
  const workflow = ct.workflowTemplate || emptyWorkflow();
  const updated = updateAtPath(workflow, path, mutator);
  await saveTemplate(ct, updated);
}

async function removeNode(ct, path) {
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  await mutateNode(ct, parentPath, (level) => ({ ...level, items: level.items.filter((_, i) => i !== idx) }));
}

function buildNodeEditor(ct, path, node) {
  const box = document.createElement('div');
  box.className = 'workflow-node-editor';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; gap:8px; align-items:center;';
  const kindTag = document.createElement('span');
  kindTag.className = 'badge';
  kindTag.textContent = node.kind === 'action' ? 'Action' : 'Task';
  const nameInput = document.createElement('input');
  nameInput.value = node.name;
  nameInput.style.flex = '1';
  nameInput.addEventListener('change', () => mutateNode(ct, path, (n) => ({ ...n, name: nameInput.value.trim() || n.name })));
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button'; removeBtn.className = 'icon-btn icon-btn-small icon-btn-danger';
  removeBtn.title = 'Remove'; removeBtn.setAttribute('aria-label', 'Remove');
  removeBtn.innerHTML = TRASH_ICON_SVG;
  removeBtn.addEventListener('click', () => removeNode(ct, path));
  header.append(kindTag, nameInput, removeBtn);
  box.appendChild(header);

  if (node.kind === 'task') {
    box.appendChild(buildTaskTemplateFields(ct, path, node));
  } else {
    const nested = document.createElement('div');
    nested.className = 'workflow-node-nested';
    nested.appendChild(buildItemsEditor(ct, path, node));
    box.appendChild(nested);
  }

  return box;
}

function buildTaskTemplateFields(ct, path, task) {
  const wrap = document.createElement('div'); wrap.className = 'workflow-task-fields';

  const verifiableLabel = document.createElement('label'); verifiableLabel.className = 'checkbox-inline';
  const verifiableInput = document.createElement('input'); verifiableInput.type = 'checkbox'; verifiableInput.checked = !!task.isVerifiable;
  verifiableInput.addEventListener('change', () => mutateNode(ct, path, (n) => ({ ...n, isVerifiable: verifiableInput.checked })));
  verifiableLabel.append(verifiableInput, ' Requires verification');
  wrap.appendChild(verifiableLabel);

  const valuesLabel = document.createElement('label'); valuesLabel.textContent = 'Value fields';
  wrap.appendChild(valuesLabel);
  (task.values || []).forEach((v, vIdx) => wrap.appendChild(buildValueTemplateRow(ct, path, task, vIdx)));

  const addValueBtn = document.createElement('button');
  addValueBtn.type = 'button'; addValueBtn.className = 'btn btn-small'; addValueBtn.textContent = '+ Value field';
  addValueBtn.addEventListener('click', () => mutateNode(ct, path, (n) => ({ ...n, values: [...(n.values || []), { name: 'New field', mode: 'fixed' }] })));
  wrap.appendChild(addValueBtn);

  return wrap;
}

function buildValueTemplateRow(ct, path, task, vIdx) {
  const row = document.createElement('div'); row.className = 'value-row';
  const v = task.values[vIdx];
  const nameInput = document.createElement('input'); nameInput.value = v.name; nameInput.placeholder = 'Field name (e.g. temperature)';
  const modeSelect = document.createElement('select');
  [['fixed', 'Fixed'], ['duplicable', 'Duplicable']].forEach(([val, lbl]) => {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
    if (val === v.mode) opt.selected = true;
    modeSelect.appendChild(opt);
  });
  const rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-small'; rmBtn.textContent = '✕';

  function save() {
    mutateNode(ct, path, (n) => ({
      ...n,
      values: n.values.map((val, i) => (i === vIdx ? { name: nameInput.value.trim() || val.name, mode: modeSelect.value } : val))
    }));
  }
  nameInput.addEventListener('change', save);
  modeSelect.addEventListener('change', save);
  rmBtn.addEventListener('click', () => mutateNode(ct, path, (n) => ({ ...n, values: n.values.filter((_, i) => i !== vIdx) })));

  row.append(nameInput, modeSelect, rmBtn);
  return row;
}

addCaseTypeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addCaseTypeError.textContent = '';
  const name = document.getElementById('newCaseTypeName').value.trim();
  const tatRaw = document.getElementById('newCaseTypeTat').value;
  if (!name) { addCaseTypeError.textContent = 'Name is required.'; return; }
  try {
    await addDoc(collection(db, 'test_caseTypes'), {
      name,
      tatGoalDays: tatRaw ? parseInt(tatRaw, 10) : null,
      workflowTemplate: emptyWorkflow()
    });
    addCaseTypeForm.reset();
    renderCaseTypeList();
  } catch (err) {
    addCaseTypeError.textContent = `Couldn't add case type: ${err.message}`;
  }
});
