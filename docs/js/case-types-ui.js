import { db } from './firebase-init.js?v=1.0.0';
import {
  doc, updateDoc, deleteDoc, collection, getDocs, addDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { newTerminalNode, newParameter, emptyWorkflow, updateAtPath, moveItem } from './workflow.js?v=1.0.0';
import { loadCatalog, actionDefsForContext, actionDefPath, nodeFromActionDef } from './catalog-ui.js?v=1.0.0';

// ---------------------------------------------------------------------
// Admin: case type CRUD, plus the Workflow-template authoring screen. A
// case type's `workflowTemplate` (replacing 0.4.1's
// `labWorkflowTemplate`/`archivingWorkflowTemplate` split) is what a new
// case's own Workflow gets deep-copied from at creation -- see
// cases.js/workflow.js.
//
// 0.6.0: Task retired -- everything is an Action, either terminal (a
// plain done/not-done step, optionally parametrized) or a container that
// holds its own nested items. "+ Action" always adds a terminal action;
// "+ Sub-action" on any existing action promotes it to a container (if it
// isn't one already) so it can hold children -- there's no separate
// upfront "which kind am I creating" choice in this editor, unlike the
// catalog's own authoring form (catalog-ui.js), which keeps an explicit
// Kind selector since a reusable library definition is a more deliberate
// choice. Items can be reordered within their own level by dragging the
// ⠿ handle, or with the ↑/↓ buttons.
//
// The "+ From catalog" picker is context-filtered (SPEC.md's hierarchy-
// scoping): at the template root it only offers case-level
// (`parentId: null`) definitions; inside a container node's own nested
// editor it only offers definitions parented under THAT node's own
// `defId` (which catalog action, if any, it was copied from -- an ad hoc
// container has no `defId`, so nothing in the catalog can ever be placed
// inside it until it's replaced with a catalog pick).
// ---------------------------------------------------------------------
const addCaseTypeForm = document.getElementById('addCaseTypeForm');
const addCaseTypeError = document.getElementById('addCaseTypeError');
const caseTypeListBody = document.getElementById('caseTypeListBody');

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

let caseTypes = [];
let expandedWorkflows = new Set();

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
  // The catalog picker (buildCatalogPicker below) needs actionDefs loaded
  // regardless of whether the admin has visited the Workflow tab yet this
  // session.
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
      await deleteDoc(doc(db, 'caseTypes', ct.id));
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
  container.appendChild(buildItemsEditor(ct, [], ct.workflowTemplate || emptyWorkflow(), null));
  td.appendChild(container);
  tr.appendChild(td);
  return tr;
}

async function saveTemplate(ct, newWorkflow) {
  await updateDoc(doc(db, 'caseTypes', ct.id), { workflowTemplate: newWorkflow });
  ct.workflowTemplate = newWorkflow;
  const container = document.getElementById('wfEditor-' + ct.id);
  if (container) container.replaceChildren(buildItemsEditor(ct, [], ct.workflowTemplate, null));
}

// Recursive: renders one items[] level (the template root, or a
// container's own nested items) with an add-action control plus each
// child's own inline editor. `path` is the index path from the template
// root to THIS items[] array; `contextDefId` is the catalog definition id
// this level corresponds to (null at the template root = case-level) --
// used to filter the "+ From catalog" picker per SPEC's hierarchy-scoping.
// Read-modify-write-back-whole-field-then-rerender-just-this-editor, same
// pattern as the rest of the app's structural editors (archiving
// workflow, sample edit).
function buildItemsEditor(ct, path, workflowLike, contextDefId) {
  const wrap = document.createElement('div');
  wrap.className = 'workflow-editor-level';

  (workflowLike.items || []).forEach((node, idx) => {
    wrap.appendChild(buildNodeEditor(ct, [...path, idx], node, workflowLike.items.length));
  });

  const addRow = document.createElement('div');
  addRow.style.cssText = 'display:flex; gap:8px; margin-top:8px;';
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-small'; addBtn.textContent = '+ Action';
  addBtn.addEventListener('click', () => addNode(ct, path, newTerminalNode('New action')));
  addRow.append(addBtn);
  wrap.appendChild(addRow);
  wrap.appendChild(buildCatalogPicker(ct, path, contextDefId));

  return wrap;
}

// Picks an existing catalog action definition (see catalog-ui.js), scoped
// to whatever's valid at this exact nesting context, and inserts a fresh
// copy at this level -- picking a container brings its whole catalog
// subtree along, since that's the point of defining "Make sample" once
// under "Lab" rather than rebuilding it inline in every case type.
function buildCatalogPicker(ct, path, contextDefId) {
  const defs = actionDefsForContext(contextDefId);
  const row = document.createElement('div'); row.className = 'catalog-picker-row';
  if (defs.length === 0) {
    row.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'No catalog actions defined at this level yet.' }));
    return row;
  }
  const select = document.createElement('select');
  const blankOpt = document.createElement('option'); blankOpt.value = ''; blankOpt.textContent = '(pick from catalog)';
  select.appendChild(blankOpt);
  defs.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = actionDefPath(a.id);
    select.appendChild(opt);
  });

  const insertBtn = document.createElement('button');
  insertBtn.type = 'button'; insertBtn.className = 'btn btn-small'; insertBtn.textContent = '+ From catalog';
  insertBtn.addEventListener('click', () => {
    if (!select.value) return;
    const node = nodeFromActionDef(select.value);
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

async function moveNode(ct, path, toIdx) {
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  await mutateNode(ct, parentPath, (level) => moveItem(level, idx, toIdx));
}

function buildNodeEditor(ct, path, node, siblingCount) {
  const idx = path[path.length - 1];
  const box = document.createElement('div');
  box.className = 'workflow-node-editor';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;';

  // Native HTML5 drag-and-drop, triggered only from this small handle so
  // dragging doesn't fight with selecting/editing text in the name input.
  const dragHandle = document.createElement('span');
  dragHandle.className = 'drag-handle'; dragHandle.title = 'Drag to reorder'; dragHandle.textContent = '⠿';
  dragHandle.setAttribute('draggable', 'true');
  box.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
    box.classList.add('dragging');
  });
  box.addEventListener('dragend', () => box.classList.remove('dragging'));
  box.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; box.classList.add('drag-over'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('drag-over');
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(fromIdx) || fromIdx === idx) return;
    moveNode(ct, [...path.slice(0, -1), fromIdx], idx);
  });

  const upBtn = document.createElement('button');
  upBtn.type = 'button'; upBtn.className = 'btn btn-small'; upBtn.textContent = '↑'; upBtn.title = 'Move up';
  upBtn.disabled = idx === 0;
  upBtn.addEventListener('click', () => moveNode(ct, path, idx - 1));

  const downBtn = document.createElement('button');
  downBtn.type = 'button'; downBtn.className = 'btn btn-small'; downBtn.textContent = '↓'; downBtn.title = 'Move down';
  downBtn.disabled = idx === siblingCount - 1;
  downBtn.addEventListener('click', () => moveNode(ct, path, idx + 1));

  const nameInput = document.createElement('input');
  nameInput.value = node.name;
  nameInput.style.flex = '1'; nameInput.style.minWidth = '100px';
  nameInput.addEventListener('change', () => mutateNode(ct, path, (n) => ({ ...n, name: nameInput.value.trim() || n.name })));

  // Turns this action into a container (if it isn't one already), so it
  // can hold its own sub-actions -- e.g. adding "Draft" under "Writing".
  // Promoting a terminal action drops its own parameters (a container's
  // "content" is its nested workflow, not data entry of its own).
  const subActionBtn = document.createElement('button');
  subActionBtn.type = 'button'; subActionBtn.className = 'btn btn-small'; subActionBtn.textContent = '+ Sub-action';
  subActionBtn.addEventListener('click', () => {
    if (node.kind === 'container') return;
    mutateNode(ct, path, (n) => ({ kind: 'container', id: n.id, defId: n.defId, name: n.name, items: [], currentIndex: 0 }));
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button'; removeBtn.className = 'icon-btn icon-btn-small icon-btn-danger';
  removeBtn.title = 'Remove'; removeBtn.setAttribute('aria-label', 'Remove');
  removeBtn.innerHTML = TRASH_ICON_SVG;
  removeBtn.addEventListener('click', () => removeNode(ct, path));
  header.append(dragHandle, upBtn, downBtn, nameInput, subActionBtn, removeBtn);
  box.appendChild(header);

  if (node.kind === 'terminal') {
    box.appendChild(buildParameterFields(ct, path, node));
  } else {
    const nested = document.createElement('div');
    nested.className = 'workflow-node-nested';
    // A node's own `defId` (which catalog definition it was copied from,
    // if any) is what scopes catalog picks inside IT -- an ad hoc
    // container (defId null) has no matching catalog entries until it's
    // replaced with a real catalog pick (see buildCatalogPicker).
    nested.appendChild(buildItemsEditor(ct, path, node, node.defId || null));
    box.appendChild(nested);
  }

  return box;
}

// Parameters -- terminal-only (SPEC.md's default: a container's "content"
// is its nested workflow, not data entry of its own).
function buildParameterFields(ct, path, action) {
  const wrap = document.createElement('div'); wrap.className = 'workflow-task-fields';

  const paramsLabel = document.createElement('label'); paramsLabel.textContent = 'Parameters';
  wrap.appendChild(paramsLabel);
  (action.parameters || []).forEach((p, pIdx) => wrap.appendChild(buildParameterRow(ct, path, action, pIdx)));

  const addParamBtn = document.createElement('button');
  addParamBtn.type = 'button'; addParamBtn.className = 'btn btn-small'; addParamBtn.textContent = '+ Parameter';
  addParamBtn.addEventListener('click', () => mutateNode(ct, path, (n) => ({
    ...n, parameters: [...(n.parameters || []), newParameter('New field', 'value')]
  })));
  wrap.appendChild(addParamBtn);

  return wrap;
}

function buildParameterRow(ct, path, action, pIdx) {
  const p = action.parameters[pIdx];
  const wrap = document.createElement('div');

  const row = document.createElement('div'); row.className = 'value-row'; row.style.flexWrap = 'wrap';
  const nameInput = document.createElement('input'); nameInput.value = p.name; nameInput.placeholder = 'Parameter name';
  const modeSelect = document.createElement('select');
  [['list', 'Choose from list'], ['value', 'Free value']].forEach(([val, lbl]) => {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
    if (val === p.mode) opt.selected = true;
    modeSelect.appendChild(opt);
  });
  const rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-small'; rmBtn.textContent = '✕';
  rmBtn.addEventListener('click', () => mutateNode(ct, path, (n) => ({ ...n, parameters: n.parameters.filter((_, i) => i !== pIdx) })));

  function save() {
    mutateNode(ct, path, (n) => ({
      ...n,
      parameters: n.parameters.map((val, i) => (i === pIdx ? { ...val, name: nameInput.value.trim() || val.name, mode: modeSelect.value } : val))
    }));
  }
  nameInput.addEventListener('change', save);
  modeSelect.addEventListener('change', save);
  row.append(nameInput, modeSelect, rmBtn);
  wrap.appendChild(row);

  if (p.mode === 'list') {
    const optionsWrap = document.createElement('div'); optionsWrap.style.cssText = 'margin:4px 0 8px 12px;';
    (p.options || []).forEach((optVal, oIdx) => {
      const optRow = document.createElement('div'); optRow.className = 'value-row';
      const optInput = document.createElement('input'); optInput.value = optVal; optInput.placeholder = 'Option value';
      optInput.addEventListener('change', () => mutateNode(ct, path, (n) => ({
        ...n,
        parameters: n.parameters.map((val, i) => (i === pIdx
          ? { ...val, options: val.options.map((o, oi) => (oi === oIdx ? optInput.value.trim() : o)) }
          : val))
      })));
      const optRm = document.createElement('button'); optRm.type = 'button'; optRm.className = 'btn btn-small'; optRm.textContent = '✕';
      optRm.addEventListener('click', () => mutateNode(ct, path, (n) => ({
        ...n,
        parameters: n.parameters.map((val, i) => (i === pIdx ? { ...val, options: val.options.filter((_, oi) => oi !== oIdx) } : val))
      })));
      optRow.append(optInput, optRm);
      optionsWrap.appendChild(optRow);
    });
    const addOptBtn = document.createElement('button');
    addOptBtn.type = 'button'; addOptBtn.className = 'btn btn-small'; addOptBtn.textContent = '+ Option';
    addOptBtn.addEventListener('click', () => mutateNode(ct, path, (n) => ({
      ...n,
      parameters: n.parameters.map((val, i) => (i === pIdx ? { ...val, options: [...(val.options || []), 'New option'] } : val))
    })));
    optionsWrap.appendChild(addOptBtn);
    wrap.appendChild(optionsWrap);
  }

  return wrap;
}

addCaseTypeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addCaseTypeError.textContent = '';
  const name = document.getElementById('newCaseTypeName').value.trim();
  const tatRaw = document.getElementById('newCaseTypeTat').value;
  if (!name) { addCaseTypeError.textContent = 'Name is required.'; return; }
  try {
    await addDoc(collection(db, 'caseTypes'), {
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
