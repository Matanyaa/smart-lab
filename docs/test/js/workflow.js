// ---------------------------------------------------------------------
// The Workflow / Action / Task primitive (0.5.0) -- see SPEC.md's "The
// Workflow / Action / Task primitive". One recursive shape used both for
// a case type's authored template and a case's own live, executing copy:
//
//   WorkflowLike = { items: [Node, ...], currentIndex: number }
//   Node = Task | Action
//   Task   = { kind:'task', id, name, values:[{name, mode}],
//              isVerifiable, executedBy, executionTimestamp, executorValues,
//              verifiedBy, verificationTimestamp, verifierValues,
//              isComplete, assignedTo:[{sampleId, zone}] }
//   Action = { kind:'action', id, name, items:[Node,...], currentIndex }
//
// A template's nodes are shaped identically to a live case's -- every
// runtime field (executedBy, values, etc.) just starts null/empty -- so
// seeding a case is a pure structural clone, nothing needs remapping.
// There's deliberately no separate "task sequence" vs "nested workflow"
// variant of Action: a task sequence is just an Action whose items happen
// to all be Tasks, and "trivially just one Task" means putting a bare Task
// directly in the parent's items[] with no Action wrapper at all -- the
// same shape covers all three cases TASK.md describes, per SPEC's "no
// separate wrapper concept distinct from workflow" framing.
// ---------------------------------------------------------------------

export function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newTaskNode(name) {
  return {
    kind: 'task', id: newId(), name,
    values: [], isVerifiable: false,
    executedBy: null, executionTimestamp: null, executorValues: [],
    verifiedBy: null, verificationTimestamp: null, verifierValues: [],
    isComplete: false, assignedTo: []
  };
}

export function newActionNode(name) {
  return { kind: 'action', id: newId(), name, items: [], currentIndex: 0 };
}

export function emptyWorkflow() {
  return { items: [], currentIndex: 0 };
}

// Deep-copies an admin-authored template into a fresh, independent tree for
// a new case. structuredClone is safe here specifically because a template
// never holds a Firestore Timestamp (every runtime field is still
// null/empty at authoring time) -- only a live case's tree ever does, and
// that one is never re-cloned this way (see updateAtPath below instead).
export function seedWorkflow(template) {
  if (!template) return emptyWorkflow();
  return structuredClone(template);
}

function valueSlotFilled(slotName, filledValues) {
  return (filledValues || []).some((v) => v.name === slotName && v.value != null && v.value !== '');
}

// "All required fields filled in" (TASK.md's open question, Claude Code's
// call, logged in HANDOFF.md): a value slot -- fixed or duplicable -- counts
// as filled once at least one non-empty entry shares its name. One rule
// covers both: a fixed slot expects exactly one instance, a duplicable one
// expects at least one, and "at least one" is the correct check either way.
function requiredValuesFilled(task, filledValues) {
  return (task.values || []).every((slot) => valueSlotFilled(slot.name, filledValues));
}

export function isTaskDone(task) {
  if (task.isComplete) return true;
  if (!task.executedBy) return false;
  if (!requiredValuesFilled(task, task.executorValues)) return false;
  if (task.isVerifiable) {
    if (!task.verifiedBy) return false;
    if (!requiredValuesFilled(task, task.verifierValues)) return false;
  }
  return true;
}

// A node (task or action) is "done" once every task nested anywhere under
// it is done. An empty action is vacuously done.
export function isNodeDone(node) {
  if (node.kind === 'task') return isTaskDone(node);
  return (node.items || []).every(isNodeDone);
}

export function firstTaskOf(node) {
  if (node.kind === 'task') return node;
  if (!node.items || node.items.length === 0) return null;
  return firstTaskOf(node.items[0]);
}

export function firstTaskStarted(node) {
  const t = firstTaskOf(node);
  return !!(t && t.executedBy);
}

// Walks currentIndex pointers all the way down to a leaf Task, returning
// the path (array of indices) to whichever leaf is genuinely "current."
export function currentPathOf(workflowLike) {
  const path = [];
  let cur = workflowLike;
  while (cur && cur.items && cur.items.length) {
    const idx = Math.min(cur.currentIndex || 0, cur.items.length - 1);
    path.push(idx);
    const node = cur.items[idx];
    if (node.kind === 'task') break;
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

// Advancement (SPEC.md's "The Workflow / Action / Task primitive"): moving
// from one item to the next happens once every task under the current item
// is done AND the next item's own first task has been "started" (has an
// executedBy). This is deliberately forward-only, cascading from wherever
// currentIndex currently sits, mutating in place bottom-up (children fixed
// up before their parent's own cascade is evaluated). It never moves an
// index backward on its own -- SPEC's advancement rule for the new
// primitive only describes forward movement (unlike 0.4.1's separate
// "editing an already-done action pulls the case back" rule, which isn't
// carried forward here); the long-press force-jump is the only way back.
export function recomputeAdvancement(workflowLike) {
  if (!workflowLike || !workflowLike.items) return;
  workflowLike.items.forEach((node) => {
    if (node.kind === 'action') recomputeAdvancement(node);
  });
  if (workflowLike.items.length === 0) { workflowLike.currentIndex = 0; return; }
  // Clamp first -- a live case's own workflow can now be structurally
  // edited (items added/removed) after creation, which can leave a
  // previously-valid currentIndex pointing past the end.
  workflowLike.currentIndex = Math.min(workflowLike.currentIndex || 0, workflowLike.items.length - 1);
  while (
    workflowLike.currentIndex < workflowLike.items.length - 1 &&
    isNodeDone(workflowLike.items[workflowLike.currentIndex]) &&
    firstTaskStarted(workflowLike.items[workflowLike.currentIndex + 1])
  ) {
    workflowLike.currentIndex++;
  }
}
