// ---------------------------------------------------------------------
// The Workflow / Action primitive (0.6.0) -- see SPEC.md's "The Workflow
// / Action primitive". Replaces 0.5.0's three-concept Workflow/Action/Task
// shape entirely: everything is now an Action, either terminal (atomic,
// just a done/not-done flag -- no executor, no timestamp, no
// verification) or a container (holds its own nested Workflow). One
// shape, both for a case type's authored template and a case's own live
// copy:
//
//   WorkflowLike = { items: [Action, ...], currentIndex: number }
//   Action (terminal)  = { kind:'terminal', id, defId, name, parameters,
//                           assignedTo, isDone }
//   Action (container) = { kind:'container', id, defId, name,
//                           items:[Action,...], currentIndex }
//
// `defId` records which catalog action definition (if any) this node was
// copied from -- null for an ad hoc node authored directly inline. It's
// what makes the catalog's hierarchy-scoping enforceable: the "+ From
// catalog" picker at a given editing context only offers definitions
// whose own parentId matches that context's defId (see catalog-ui.js).
//
// `parameters` (terminal only) is the node's own copy of its definition's
// parameter list ({id, name, mode:'list'|'value', options}) -- immutable
// per instance, just what a live assignment is filled in against.
// `assignedTo` (terminal only) is the live, per-instance list of
// {sampleId, zone, values:[{parameterId, value}]} -- one independent set
// of parameter values per assigned sample/zone, tagged at execution time,
// not something a sample owns (SPEC.md's "Item / Sample / Zone").
// ---------------------------------------------------------------------

export function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newParameter(name, mode) {
  return { id: newId(), name, mode, options: [] };
}

export function newTerminalNode(name, parameters = [], defId = null) {
  return { kind: 'terminal', id: newId(), defId, name, parameters, assignedTo: [], isDone: false };
}

export function newContainerNode(name, defId = null) {
  return { kind: 'container', id: newId(), defId, name, items: [], currentIndex: 0 };
}

export function emptyWorkflow() {
  return { items: [], currentIndex: 0 };
}

// Deep-copies an admin-authored template into a fresh, independent tree
// for a new case. structuredClone is safe here specifically because a
// template's nodes carry only plain data (no Firestore Timestamp is ever
// stored on an Action under this primitive -- there's no timestamp field
// at all anymore).
export function seedWorkflow(template) {
  if (!template) return emptyWorkflow();
  return structuredClone(template);
}

// A terminal action is done when marked done -- that's the entire record,
// no other condition. A container is done once every action nested
// anywhere under it is done (its own nested workflow has reached its
// implicit End). An empty container is vacuously done.
export function isNodeDone(node) {
  if (node.kind === 'terminal') return !!node.isDone;
  return (node.items || []).every(isNodeDone);
}

// Walks currentIndex pointers all the way down to a leaf terminal action,
// returning the path (array of indices) to whichever leaf is genuinely
// "current."
export function currentPathOf(workflowLike) {
  const path = [];
  let cur = workflowLike;
  while (cur && cur.items && cur.items.length) {
    const idx = Math.min(cur.currentIndex || 0, cur.items.length - 1);
    path.push(idx);
    const node = cur.items[idx];
    if (node.kind === 'terminal') break;
    cur = node;
  }
  return path;
}

export function nodeAtPath(workflowLike, path) {
  let cur = workflowLike;
  for (const idx of path) {
    if (!cur || !cur.items || !cur.items[idx]) return null;
    cur = cur.items[idx];
  }
  return cur;
}

// Immutable update: returns a NEW workflowLike with the node at `path`
// replaced by `updater(node)` (path [] means "update the root itself").
// Every untouched branch is shared by reference, only the spine down to
// `path` gets shallow-copied.
export function updateAtPath(workflowLike, path, updater) {
  if (path.length === 0) return updater(workflowLike);
  const [idx, ...rest] = path;
  const items = workflowLike.items.map((node, i) => (i === idx ? updateAtPath(node, rest, updater) : node));
  return { ...workflowLike, items };
}

// Advancement (SPEC.md): the moment the current action in a workflow is
// done, it auto-advances immediately to the next one -- no waiting
// condition on the next action at all (unlike 0.5.0's "next item's first
// task has started" rule; there's no separate "started" state anymore,
// entering an action just is passing its own implicit Start). Forward-
// only, cascading from wherever currentIndex sits, mutating in place
// bottom-up. The long-press force-jump is the only way back -- see
// SPEC.md's Open Questions on whether that should change; not decided,
// not built here.
export function recomputeAdvancement(workflowLike) {
  if (!workflowLike || !workflowLike.items) return;
  workflowLike.items.forEach((node) => {
    if (node.kind === 'container') recomputeAdvancement(node);
  });
  if (workflowLike.items.length === 0) { workflowLike.currentIndex = 0; return; }
  // Clamp first -- a live case's own workflow can be structurally edited
  // (items added/removed) after creation, which can leave a previously-
  // valid currentIndex pointing past the end.
  workflowLike.currentIndex = Math.min(workflowLike.currentIndex || 0, workflowLike.items.length - 1);
  while (
    workflowLike.currentIndex < workflowLike.items.length - 1 &&
    isNodeDone(workflowLike.items[workflowLike.currentIndex])
  ) {
    workflowLike.currentIndex++;
  }
}
