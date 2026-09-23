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

// Advancement (SPEC.md's Open Questions, resolved 2026-09-23 at the
// user's direct request): current is always the *leftmost not-done item*
// -- fully derived fresh every time, not just cascaded forward. This
// makes it bidirectional for free: adding a new (never-done) item before
// or at the old current position pulls current back to it, and un-marking
// an already-passed item done pulls current back to that item too. An
// all-done level's current sits at its last item.
//
// `exemptPath`, when given, is the path (relative to this call) to a
// level whose own currentIndex was just force-set by a long-press
// override and should be left alone by *this* call -- its own nested
// children are still recomputed normally underneath it, so it stays
// internally consistent, but the forced position itself isn't
// immediately overwritten by the same save that set it. A later,
// unrelated save (no exemptPath) will still re-derive it normally, so a
// force-jump is a real but not permanently-sticky override -- it holds
// until the next real progress/edit anywhere touches this tree. Not
// asked for explicitly; a judgment call reconciling force-jump with the
// new bidirectional rule, logged in HANDOFF.md.
export function recomputeAdvancement(workflowLike, exemptPath = null) {
  if (!workflowLike || !workflowLike.items) return;
  const exemptHere = !!exemptPath && exemptPath.length === 0;
  workflowLike.items.forEach((node, idx) => {
    if (node.kind !== 'container') return;
    const childExempt = exemptPath && exemptPath.length > 0 && exemptPath[0] === idx ? exemptPath.slice(1) : null;
    recomputeAdvancement(node, childExempt);
  });
  if (exemptHere) return;
  if (workflowLike.items.length === 0) { workflowLike.currentIndex = 0; return; }
  let idx = 0;
  while (idx < workflowLike.items.length - 1 && isNodeDone(workflowLike.items[idx])) idx++;
  workflowLike.currentIndex = idx;
}

// [doneCount, totalCount] of terminal actions nested anywhere under a
// node (a terminal node is trivially [1,1] or [0,1]) -- used to show a
// container's own partial-completion progress ("2/5") and proportional
// fill in the stage-circle UI. totalCount 0 (an empty container) has no
// meaningful fraction; callers should treat that as "fully done" (see
// isNodeDone's vacuous-true) rather than dividing by zero.
export function doneFraction(node) {
  if (node.kind === 'terminal') return node.isDone ? [1, 1] : [0, 1];
  let done = 0, total = 0;
  (node.items || []).forEach((child) => {
    const [d, t] = doneFraction(child);
    done += d; total += t;
  });
  return [done, total];
}

// Moves the item at fromIdx to sit at toIdx within one level (a full
// reorder, not just an adjacent swap -- covers both the ↑/↓ buttons and
// drag-and-drop with the same function), keeping currentIndex pointing at
// the same *item* through the move rather than the same numeric slot.
export function moveItem(level, fromIdx, toIdx) {
  if (fromIdx === toIdx) return level;
  const items = [...level.items];
  const [moved] = items.splice(fromIdx, 1);
  items.splice(toIdx, 0, moved);
  let currentIndex = level.currentIndex;
  if (currentIndex === fromIdx) currentIndex = toIdx;
  else if (fromIdx < currentIndex && currentIndex <= toIdx) currentIndex--;
  else if (toIdx <= currentIndex && currentIndex < fromIdx) currentIndex++;
  return { ...level, items, currentIndex };
}
