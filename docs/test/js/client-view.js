import { db } from './firebase-init.js?v=0.6.0-t01';
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { loadClientOrgsAndClients, getCachedClientsForOrg } from './clients-ui.js?v=0.6.0-t01';

// ---------------------------------------------------------------------
// Client-org login case view (0.4.1). Minimal for this pass, per TASK.md
// #4 -- status per case plus a filter to one client within the org, not
// the fuller "lean view"/"shadow cases" design from SPEC.md's older
// no-login public-link section (explicitly retired in favor of this
// login-based model). Rules-level scoping is in setup/firestore.rules
// (clientBelongsToMyOrg); this UI narrows display further (hides
// archived/done cases per SPEC's "Client-facing view" visibility rule),
// it isn't the only thing keeping other orgs' cases out.
// ---------------------------------------------------------------------
const clientViewScreen = document.getElementById('clientViewScreen');
const clientFilterField = document.getElementById('clientFilterField');
const clientFilterSelect = document.getElementById('clientFilterSelect');
const clientCaseListBody = document.getElementById('clientCaseListBody');

let myProfile = null;
let orgClients = [];
let allCases = [];

export function hideClientView() {
  clientViewScreen.classList.add('hidden');
  myProfile = null;
}

export async function showClientView(profile) {
  myProfile = profile;
  clientViewScreen.classList.remove('hidden');
  await loadClientOrgsAndClients();
  orgClients = getCachedClientsForOrg(profile.clientOrgId);

  clientFilterField.hidden = orgClients.length === 0;
  clientFilterSelect.innerHTML = '<option value="">All clients</option>';
  orgClients.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    clientFilterSelect.appendChild(opt);
  });

  await loadCases();
}

clientFilterSelect.addEventListener('change', () => renderCaseList());

async function loadCases() {
  clientCaseListBody.innerHTML = '<tr><td colspan="2" class="muted">Loading…</td></tr>';
  if (orgClients.length === 0) {
    allCases = [];
    clientCaseListBody.innerHTML = '<tr><td colspan="2" class="muted">No clients set up for your org yet.</td></tr>';
    return;
  }
  // Firestore 'in' queries cap at 30 values -- fine at this org size; a
  // client org with more than 30 named clients would need chunking, not
  // built here.
  const clientIds = orgClients.map((c) => c.id).slice(0, 30);
  const snap = await getDocs(query(collection(db, 'test_cases'), where('client', 'in', clientIds)));
  allCases = [];
  snap.forEach((d) => allCases.push({ id: d.id, ...d.data() }));
  renderCaseList();
}

function onameOf(c) {
  return [c.caseNumber, c.clientCaseNumber, c.name].filter(Boolean).join(' - ');
}

// See SPEC.md's "Client-facing view": "In lab" covers both new and lab,
// "Writing" for write, and the case goes invisible again once it reaches
// archive (report published) -- null here means "don't show this case."
function clientStatusText(c) {
  if (c.stage === 'new' || c.stage === 'lab') return 'In lab';
  if (c.stage === 'write') return 'Writing';
  return null;
}

function renderCaseList() {
  const filterClientId = clientFilterSelect.value;
  const visible = allCases
    .filter((c) => !filterClientId || c.client === filterClientId)
    .map((c) => ({ c, status: clientStatusText(c) }))
    .filter(({ status }) => status != null);

  clientCaseListBody.innerHTML = '';
  if (visible.length === 0) {
    clientCaseListBody.innerHTML = '<tr><td colspan="2" class="muted">No cases in progress.</td></tr>';
    return;
  }
  visible.forEach(({ c, status }) => clientCaseListBody.appendChild(renderCaseRow(c, status)));
}

function renderCaseRow(c, status) {
  const tr = document.createElement('tr');
  const titleTd = document.createElement('td');
  let statusText = status;
  if (c.showResearchToClient) statusText += ' (research ongoing)';
  titleTd.textContent = `${onameOf(c) || '(unnamed)'} — ${statusText}`;
  const badgeTd = document.createElement('td');
  if (c.onHold) {
    const b = document.createElement('span'); b.className = 'badge badge-onhold'; b.textContent = 'On hold';
    badgeTd.appendChild(b);
  }
  if (c.highPriority) {
    const b = document.createElement('span'); b.className = 'badge badge-priority'; b.textContent = 'Priority';
    badgeTd.appendChild(b);
  }
  tr.append(titleTd, badgeTd);
  return tr;
}
