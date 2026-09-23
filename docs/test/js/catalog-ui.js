import { db } from './firebase-init.js?v=0.5.0-t02';
import {
  collection, doc, getDocs, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { newTaskNode, newActionNode } from './workflow.js?v=0.5.0-t02';

// ---------------------------------------------------------------------
// Admin: reusable Action/Task catalog (0.5.0-t02), at the user's request --
// named definitions ("action definitions" in `test_actionDefs`, "task
// definitions" in `test_taskDefs`) admin builds once and can insert
// wherever needed while authoring a case type's Workflow template
// (case-types-ui.js's "+ From catalog"), instead of freehand-authoring
// every action/task from scratch each time.
//
// An action definition is just {name, parentId} -- parentId points at
// another action definition (or null for top-level), building the
// catalog's own hierarchy directly (e.g. "Make sample" parented under
// "Lab"), the same flat-collection-with-a-parentId-pointer pattern
// already used for case Notes. A task definition adds {isVerifiable,
// values:[{name, mode}]} -- the same authoring-time fields a Task node
// carries in workflow.js, minus every runtime-only field (executedBy,
// etc.), since a catalog entry is a pure template, never executed itself.
//
// Inserting a definition into a case type's Workflow is copy-at-use, not
// a live reference (see nodeFromActionDef/nodeFromTaskDef below) -- same
// "snapshot, not a pointer" semantics already used for case type ->
// case's own Workflow, and item/sample -> a task's live zone tagging.
// Editing a catalog definition later never retroactively changes a
// Workflow it was already copied into.
// ---------------------------------------------------------------------

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

const actionDefAddContainer = document.getElementById('actionDefAddContainer');
const actionDefListBody = document.getElementById('actionDefListBody');
const taskDefAddContainer = document.getElementById('taskDefAddContainer');
const taskDefListBody = document.getElementById('taskDefListBody');

let actionDefs = [];
let taskDefs = [];

export async function loadCatalog() {
  const [aSnap, tSnap] = await Promise.all([
    getDocs(collection(db, 'test_actionDefs')),
    getDocs(collection(db, 'test_taskDefs'))
  ]);
  actionDefs = [];
  aSnap.forEach((d) => actionDefs.push({ id: d.id, ...d.data() }));
  taskDefs = [];
  tSnap.forEach((d) => taskDefs.push({ id: d.id, ...d.data() }));
  actionDefs.sort((a, b) => a.name.localeCompare(b.name));
  taskDefs.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCachedActionDefs() { return actionDefs; }
export function getCachedTaskDefs() { return taskDefs; }
export function findActionDefById(id) { return actionDefs.find((a) => a.id === id) || null; }

// "Lab > Make sample" breadcrumb, so nesting reads clearly in a flat
// dropdown without needing a full tree-picker widget.
export function actionDefPath(id) {
  const def = findActionDefById(id);
  if (!def) return '';
  return def.parentId ? `${actionDefPath(def.parentId)} > ${def.name}` : def.name;
}

// Builds a fresh Node -- brand-new runtime id, empty execution state --
// from a catalog action definition, including every descendant (nested
// action/task defs whose parentId chain leads back to it). See the
// module comment above for why this copies rather than references.
export function nodeFromActionDef(defId) {
  const def = findActionDefById(defId);
  if (!def) return null;
  const node = newActionNode(def.name);
  node.items = [
    ...actionDefs.filter((a) => a.parentId === defId).map((a) => nodeFromActionDef(a.id)),
    ...taskDefs.filter((t) => t.parentId === defId).map((t) => nodeFromTaskDef(t.id))
  ];
  return node;
}

export function nodeFromTaskDef(defId) {
  const def = taskDefs.find((t) => t.id === defId);
  if (!def) return null;
  const node = newTaskNode(def.name);
  node.values = (def.values || []).map((v) => ({ ...v }));
  node.isVerifiable = !!def.isVerifiable;
  return node;
}

export async function renderCatalog() {
  await loadCatalog();
  renderActionDefAdd();
  renderActionDefList();
  renderTaskDefAdd();
  renderTaskDefList();
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------
function buildParentActionSelect() {
  const select = document.createElement('select');
  const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = '(top level)';
  select.appendChild(noneOpt);
  actionDefs.forEach((a) => {
    const opt = document.createElement('option'); opt.value = a.id; opt.textContent = actionDefPath(a.id);
    select.appendChild(opt);
  });
  return select;
}

function renderActionDefAdd() {
  actionDefAddContainer.innerHTML = '';
  const row = document.createElement('div'); row.className = 'add-row';

  const nameField = document.createElement('div'); nameField.className = 'field';
  const nameLabel = document.createElement('label'); nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameField.append(nameLabel, nameInput);

  const parentField = document.createElement('div'); parentField.className = 'field';
  const parentLabel = document.createElement('label'); parentLabel.textContent = 'Parent action';
  const parentSelect = buildParentActionSelect();
  parentField.append(parentLabel, parentSelect);

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-primary'; addBtn.textContent = 'Add action';
  row.append(nameField, parentField, addBtn);

  const err = document.createElement('div'); err.className = 'error';

  addBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { err.textContent = 'Name is required.'; return; }
    addBtn.disabled = true;
    try {
      await addDoc(collection(db, 'test_actionDefs'), { name, parentId: parentSelect.value || null });
      await renderCatalog();
    } catch (ex) {
      err.textContent = `Couldn't add action: ${ex.message}`;
      addBtn.disabled = false;
    }
  });

  actionDefAddContainer.append(row, err);
}

function renderActionDefList() {
  actionDefListBody.innerHTML = '';
  if (actionDefs.length === 0) {
    actionDefListBody.innerHTML = '<p class="muted">No actions defined yet.</p>';
    return;
  }
  actionDefs.filter((a) => !a.parentId).forEach((a) => actionDefListBody.appendChild(buildActionDefRow(a, 0)));
}

// Same flat-with-parentId-built-into-a-tree-client-side approach as case
// Notes -- each action def row recurses into its own children (nested
// action defs and any task defs parented under it), indented by depth.
function buildActionDefRow(def, depth) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'action-row';
  row.style.paddingLeft = `${depth * 20}px`;
  const label = document.createElement('span'); label.textContent = def.name;
  row.appendChild(label);
  row.appendChild(buildDeleteControl(
    'Delete this action and everything nested under it?',
    () => deleteActionDefCascade(def.id)
  ));
  wrap.appendChild(row);

  const childActions = actionDefs.filter((a) => a.parentId === def.id);
  const childTasks = taskDefs.filter((t) => t.parentId === def.id);
  childActions.forEach((a) => wrap.appendChild(buildActionDefRow(a, depth + 1)));
  childTasks.forEach((t) => wrap.appendChild(buildTaskDefRow(t, depth + 1)));

  return wrap;
}

async function deleteActionDefCascade(id) {
  for (const a of actionDefs.filter((x) => x.parentId === id)) await deleteActionDefCascade(a.id);
  for (const t of taskDefs.filter((x) => x.parentId === id)) await deleteDoc(doc(db, 'test_taskDefs', t.id));
  await deleteDoc(doc(db, 'test_actionDefs', id));
}

// ---------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------
function renderTaskDefAdd() {
  taskDefAddContainer.innerHTML = '';

  const row = document.createElement('div'); row.className = 'add-row';
  const nameField = document.createElement('div'); nameField.className = 'field';
  const nameLabel = document.createElement('label'); nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameField.append(nameLabel, nameInput);

  const parentField = document.createElement('div'); parentField.className = 'field';
  const parentLabel = document.createElement('label'); parentLabel.textContent = 'Parent action';
  const parentSelect = buildParentActionSelect();
  parentField.append(parentLabel, parentSelect);
  row.append(nameField, parentField);
  taskDefAddContainer.appendChild(row);

  const verifiableLabel = document.createElement('label'); verifiableLabel.className = 'checkbox-inline';
  verifiableLabel.style.margin = '10px 0';
  const verifiableInput = document.createElement('input'); verifiableInput.type = 'checkbox';
  verifiableLabel.append(verifiableInput, ' Requires verification');
  taskDefAddContainer.appendChild(verifiableLabel);

  const valuesLabel = document.createElement('label'); valuesLabel.textContent = 'Value fields';
  taskDefAddContainer.appendChild(valuesLabel);
  const valueRows = document.createElement('div');
  taskDefAddContainer.appendChild(valueRows);
  const valueEntries = [];
  function addValueRow() {
    const r = document.createElement('div'); r.className = 'value-row';
    const vName = document.createElement('input'); vName.placeholder = 'Field name (e.g. temperature)';
    const vMode = document.createElement('select');
    [['fixed', 'Fixed'], ['duplicable', 'Duplicable']].forEach(([val, lbl]) => {
      const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
      vMode.appendChild(opt);
    });
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn btn-small'; rm.textContent = '✕';
    const entry = { nameInput: vName, modeSelect: vMode };
    rm.addEventListener('click', () => { r.remove(); valueEntries.splice(valueEntries.indexOf(entry), 1); });
    r.append(vName, vMode, rm);
    valueRows.appendChild(r);
    valueEntries.push(entry);
  }
  const addValueBtn = document.createElement('button');
  addValueBtn.type = 'button'; addValueBtn.className = 'btn btn-small'; addValueBtn.textContent = '+ Value field';
  addValueBtn.addEventListener('click', addValueRow);
  taskDefAddContainer.appendChild(addValueBtn);

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-primary'; addBtn.textContent = 'Add task';
  addBtn.style.cssText = 'margin-top:10px; display:block;';
  const err = document.createElement('div'); err.className = 'error';

  addBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { err.textContent = 'Name is required.'; return; }
    addBtn.disabled = true;
    try {
      const values = valueEntries
        .map((e) => ({ name: e.nameInput.value.trim(), mode: e.modeSelect.value }))
        .filter((v) => v.name);
      await addDoc(collection(db, 'test_taskDefs'), {
        name, parentId: parentSelect.value || null, isVerifiable: verifiableInput.checked, values
      });
      await renderCatalog();
    } catch (ex) {
      err.textContent = `Couldn't add task: ${ex.message}`;
      addBtn.disabled = false;
    }
  });

  taskDefAddContainer.append(addBtn, err);
}

function renderTaskDefList() {
  taskDefListBody.innerHTML = '';
  const topLevel = taskDefs.filter((t) => !t.parentId);
  if (topLevel.length === 0) {
    taskDefListBody.innerHTML = '<p class="muted">No top-level tasks -- tasks nested under an action show in the Actions list above.</p>';
    return;
  }
  topLevel.forEach((t) => taskDefListBody.appendChild(buildTaskDefRow(t, 0)));
}

function buildTaskDefRow(def, depth) {
  const row = document.createElement('div'); row.className = 'action-row';
  row.style.paddingLeft = `${depth * 20}px`;
  const label = document.createElement('span');
  label.textContent = def.name + (def.isVerifiable ? ' (verifiable)' : '');
  row.appendChild(label);
  row.appendChild(buildDeleteControl('Delete this task?', () => deleteDoc(doc(db, 'test_taskDefs', def.id))));
  return row;
}

// Shared inline confirm-then-delete control, same pattern used throughout
// this app (case/sample/case-type delete).
function buildDeleteControl(confirmText, onConfirm) {
  const wrap = document.createElement('span'); wrap.style.position = 'relative';
  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.className = 'icon-btn icon-btn-small icon-btn-danger';
  delBtn.title = 'Delete'; delBtn.setAttribute('aria-label', 'Delete');
  delBtn.innerHTML = TRASH_ICON_SVG;
  delBtn.addEventListener('click', () => {
    if (wrap.querySelector('.confirm-row')) return;
    const confirmRow = document.createElement('span');
    confirmRow.className = 'confirm-row'; confirmRow.style.marginLeft = '8px';
    const msg = document.createElement('span'); msg.className = 'error'; msg.textContent = confirmText + ' ';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-small btn-primary'; confirmBtn.textContent = 'Confirm';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-small'; cancelBtn.textContent = 'Cancel'; cancelBtn.style.marginLeft = '6px';
    cancelBtn.addEventListener('click', () => confirmRow.remove());
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      await onConfirm();
      await renderCatalog();
    });
    confirmRow.append(msg, confirmBtn, cancelBtn);
    wrap.appendChild(confirmRow);
  });
  wrap.appendChild(delBtn);
  return wrap;
}
