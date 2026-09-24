import { db } from './firebase-init.js?v=0.6.0-t07';
import {
  collection, doc, getDocs, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { newTerminalNode, newContainerNode } from './workflow.js?v=0.6.0-t07';

// ---------------------------------------------------------------------
// Admin: reusable Action catalog (0.6.0 -- retired the separate `taskDefs`
// collection from 0.5.0-t02; Task folded into Action as the terminal
// kind). A definition is `{name, kind:'terminal'|'container', parentId,
// parameters}` in `test_actionDefs` -- `parentId` is now **hierarchy-
// scoped and load-bearing** (SPEC.md), not just organizational: a
// definition with no parent is case-level (only usable in a case's own
// top-level workflow); one parented under another action definition is
// only usable inside THAT specific action's own nested workflow. Only a
// container-kind definition is a valid parent (a terminal action can't
// hold children) -- enforced in the "parent action" picker below.
//
// Inserting a definition into a workflow (case-types-ui.js / cases.js's
// "+ From catalog") is copy-at-use, not a live reference -- see
// nodeFromActionDef below -- and must filter to only the definitions
// whose parentId matches the CURRENT editing context (see
// actionDefsForContext), enforcing the hierarchy-scoping as a real
// placement rule, not just a suggestion.
// ---------------------------------------------------------------------

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

const actionDefAddContainer = document.getElementById('actionDefAddContainer');
const actionDefListBody = document.getElementById('actionDefListBody');

let actionDefs = [];

export async function loadCatalog() {
  const snap = await getDocs(collection(db, 'test_actionDefs'));
  actionDefs = [];
  snap.forEach((d) => actionDefs.push({ id: d.id, ...d.data() }));
  actionDefs.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCachedActionDefs() { return actionDefs; }
export function findActionDefById(id) { return actionDefs.find((a) => a.id === id) || null; }

// The definitions valid for insertion at a given editing context --
// `contextDefId` is null for a case-level workflow root, or the defId of
// whichever container node is currently being edited/navigated into.
export function actionDefsForContext(contextDefId) {
  return actionDefs.filter((a) => a.parentId === contextDefId);
}

// "Lab > Make sample" breadcrumb, so nesting reads clearly in a flat
// dropdown without needing a full tree-picker widget.
export function actionDefPath(id) {
  const def = findActionDefById(id);
  if (!def) return '';
  return def.parentId ? `${actionDefPath(def.parentId)} > ${def.name}` : def.name;
}

// Builds a fresh Action node -- brand-new runtime id, empty live state --
// from a catalog definition. For a container definition, every descendant
// (nested action defs whose parentId chain leads back to it, any kind) is
// copied in recursively too, since picking a container should bring its
// whole nested structure along. See the module comment above for why this
// copies rather than references.
export function nodeFromActionDef(defId) {
  const def = findActionDefById(defId);
  if (!def) return null;
  if (def.kind === 'container') {
    const node = newContainerNode(def.name, def.id);
    node.items = actionDefsForContext(defId).map((a) => nodeFromActionDef(a.id));
    return node;
  }
  return newTerminalNode(def.name, (def.parameters || []).map((p) => ({ ...p })), def.id);
}

export async function renderCatalog() {
  await loadCatalog();
  renderActionDefAdd();
  renderActionDefList();
}

// ---------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------
function buildParentActionSelect() {
  const select = document.createElement('select');
  const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = '(case level)';
  select.appendChild(noneOpt);
  // Only a container-kind definition is a valid parent -- a terminal
  // action can't hold children, so it's excluded here rather than just
  // discouraged (TASK.md: "make an invalid placement impossible to pick
  // in the UI, not just discouraged").
  actionDefs.filter((a) => a.kind === 'container').forEach((a) => {
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

  const kindField = document.createElement('div'); kindField.className = 'field';
  const kindLabel = document.createElement('label'); kindLabel.textContent = 'Kind';
  const kindSelect = document.createElement('select');
  [['terminal', 'Terminal (a single done/not-done step)'], ['container', 'Container (holds its own nested actions)']].forEach(([val, lbl]) => {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
    kindSelect.appendChild(opt);
  });
  kindField.append(kindLabel, kindSelect);

  const parentField = document.createElement('div'); parentField.className = 'field';
  const parentLabel = document.createElement('label'); parentLabel.textContent = 'Upper level';
  const parentSelect = buildParentActionSelect();
  parentField.append(parentLabel, parentSelect);

  row.append(nameField, kindField, parentField);
  actionDefAddContainer.appendChild(row);

  // Parameters -- terminal-only (SPEC.md's default assumption, logged in
  // HANDOFF.md: a container's "content" is its nested workflow, not data
  // entry of its own).
  const paramsWrap = document.createElement('div');
  actionDefAddContainer.appendChild(paramsWrap);
  const paramEntries = []; // { nameInput, modeSelect, optionInputs:[] }

  function renderParamsSection() {
    paramsWrap.innerHTML = '';
    if (kindSelect.value !== 'terminal') return;
    const label = document.createElement('label'); label.textContent = 'Parameters';
    paramsWrap.appendChild(label);
    const rows = document.createElement('div');
    paramsWrap.appendChild(rows);
    paramEntries.length = 0;

    function addParamRow() {
      const prow = document.createElement('div'); prow.className = 'value-row'; prow.style.flexWrap = 'wrap';
      const pName = document.createElement('input'); pName.placeholder = 'Parameter name';
      const pMode = document.createElement('select');
      [['list', 'Choose from list'], ['value', 'Free value']].forEach(([val, lbl]) => {
        const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
        pMode.appendChild(opt);
      });
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn btn-small'; rm.textContent = '✕';
      const entry = { nameInput: pName, modeSelect: pMode, optionInputs: [] };
      rm.addEventListener('click', () => { prow.remove(); optionsRow.remove(); paramEntries.splice(paramEntries.indexOf(entry), 1); });
      prow.append(pName, pMode, rm);
      rows.appendChild(prow);

      const optionsRow = document.createElement('div');
      optionsRow.style.cssText = 'margin:4px 0 8px 12px;';
      rows.appendChild(optionsRow);
      function refreshOptionsVisibility() {
        optionsRow.classList.toggle('hidden', pMode.value !== 'list');
      }
      function addOptionInput() {
        const optRow = document.createElement('div'); optRow.className = 'value-row';
        const optInput = document.createElement('input'); optInput.placeholder = 'Option value';
        const optRm = document.createElement('button'); optRm.type = 'button'; optRm.className = 'btn btn-small'; optRm.textContent = '✕';
        optRm.addEventListener('click', () => { optRow.remove(); entry.optionInputs.splice(entry.optionInputs.indexOf(optInput), 1); });
        optRow.append(optInput, optRm);
        optionsRow.appendChild(optRow);
        entry.optionInputs.push(optInput);
      }
      const addOptBtn = document.createElement('button');
      addOptBtn.type = 'button'; addOptBtn.className = 'btn btn-small'; addOptBtn.textContent = '+ Option';
      addOptBtn.addEventListener('click', addOptionInput);
      optionsRow.appendChild(addOptBtn);
      pMode.addEventListener('change', refreshOptionsVisibility);
      refreshOptionsVisibility();

      paramEntries.push(entry);
    }
    const addParamBtn = document.createElement('button');
    addParamBtn.type = 'button'; addParamBtn.className = 'btn btn-small'; addParamBtn.textContent = '+ Parameter';
    addParamBtn.addEventListener('click', addParamRow);
    paramsWrap.appendChild(addParamBtn);
  }
  kindSelect.addEventListener('change', renderParamsSection);
  renderParamsSection();

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-primary'; addBtn.textContent = 'Add action';
  addBtn.style.cssText = 'margin-top:10px; display:block;';
  const err = document.createElement('div'); err.className = 'error';

  addBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { err.textContent = 'Name is required.'; return; }
    addBtn.disabled = true;
    try {
      const parameters = kindSelect.value === 'terminal'
        ? paramEntries
          .filter((e) => e.nameInput.value.trim())
          .map((e) => ({
            id: (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
            name: e.nameInput.value.trim(),
            mode: e.modeSelect.value,
            options: e.modeSelect.value === 'list' ? e.optionInputs.map((i) => i.value.trim()).filter(Boolean) : []
          }))
        : [];
      await addDoc(collection(db, 'test_actionDefs'), {
        name, kind: kindSelect.value, parentId: parentSelect.value || null, parameters
      });
      await renderCatalog();
    } catch (ex) {
      err.textContent = `Couldn't add action: ${ex.message}`;
      addBtn.disabled = false;
    }
  });

  actionDefAddContainer.append(addBtn, err);
}

// ---------------------------------------------------------------------
// List
// ---------------------------------------------------------------------
function renderActionDefList() {
  actionDefListBody.innerHTML = '';
  if (actionDefs.length === 0) {
    actionDefListBody.innerHTML = '<p class="muted">No actions defined yet.</p>';
    return;
  }
  actionDefs.filter((a) => !a.parentId).forEach((a) => actionDefListBody.appendChild(buildActionDefRow(a, 0)));
}

// Same flat-with-parentId-built-into-a-tree-client-side approach as case
// Notes -- each row recurses into its own children (other action defs
// whose parentId points back to it), indented by depth.
function buildActionDefRow(def, depth) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'action-row';
  row.style.paddingLeft = `${depth * 20}px`;
  const label = document.createElement('span');
  label.textContent = def.name + ` (${def.kind}` + (def.parameters && def.parameters.length ? `, ${def.parameters.length} param${def.parameters.length > 1 ? 's' : ''}` : '') + ')';
  row.appendChild(label);
  row.appendChild(buildDeleteControl(
    def.kind === 'container' ? `Delete "${def.name}" and everything nested under it?` : `Delete "${def.name}"?`,
    () => deleteActionDefCascade(def.id)
  ));
  wrap.appendChild(row);

  actionDefsForContext(def.id).forEach((child) => wrap.appendChild(buildActionDefRow(child, depth + 1)));
  return wrap;
}

async function deleteActionDefCascade(id) {
  for (const a of actionDefsForContext(id)) await deleteActionDefCascade(a.id);
  await deleteDoc(doc(db, 'test_actionDefs', id));
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
