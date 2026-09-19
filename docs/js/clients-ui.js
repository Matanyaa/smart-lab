import { db } from './firebase-init.js?v=0.4.1';
import {
  doc, deleteDoc, collection, getDocs, addDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ---------------------------------------------------------------------
// Admin: client org / client CRUD (0.4.1). Replaces the old free-typed
// `clientName` field on a case -- a case's `client` is now a reference to
// one of these `clients/{id}` docs, itself scoped to a `clientOrgs/{id}`.
// ---------------------------------------------------------------------
const addClientOrgForm = document.getElementById('addClientOrgForm');
const addClientOrgError = document.getElementById('addClientOrgError');
const clientOrgListBody = document.getElementById('clientOrgListBody');

let clientOrgs = [];
let clientsByOrg = {}; // orgId -> [{id, name, clientOrgId}]

export async function loadClientOrgsAndClients() {
  const orgSnap = await getDocs(collection(db, 'clientOrgs'));
  clientOrgs = [];
  orgSnap.forEach((d) => clientOrgs.push({ id: d.id, ...d.data() }));
  clientOrgs.sort((a, b) => a.name.localeCompare(b.name));

  const clientSnap = await getDocs(collection(db, 'clients'));
  clientsByOrg = {};
  clientSnap.forEach((d) => {
    const c = { id: d.id, ...d.data() };
    (clientsByOrg[c.clientOrgId] = clientsByOrg[c.clientOrgId] || []).push(c);
  });
  Object.values(clientsByOrg).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));

  return { clientOrgs, clientsByOrg };
}

export function getCachedClientOrgs() { return clientOrgs; }
export function getCachedClientsForOrg(orgId) { return clientsByOrg[orgId] || []; }

export function findClientById(id) {
  for (const orgId in clientsByOrg) {
    const found = clientsByOrg[orgId].find((c) => c.id === id);
    if (found) return found;
  }
  return null;
}
export function findClientOrgById(id) {
  return clientOrgs.find((o) => o.id === id) || null;
}

export async function fetchClientsForOrg(orgId) {
  const snap = await getDocs(query(collection(db, 'clients'), where('clientOrgId', '==', orgId)));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

export async function renderClientOrgList() {
  await loadClientOrgsAndClients();
  clientOrgListBody.innerHTML = '';
  if (clientOrgs.length === 0) {
    clientOrgListBody.innerHTML = '<p class="muted">No client orgs yet.</p>';
    return;
  }
  clientOrgs.forEach((org) => clientOrgListBody.appendChild(renderClientOrgCard(org)));
}

function renderClientOrgCard(org) {
  const card = document.createElement('div');
  card.className = 'sample-card';

  const header = document.createElement('div');
  header.className = 'sample-card-header';
  const title = document.createElement('strong');
  title.textContent = org.name;
  const delOrgBtn = document.createElement('button');
  delOrgBtn.type = 'button';
  delOrgBtn.className = 'btn btn-small';
  delOrgBtn.textContent = 'Delete org';
  delOrgBtn.addEventListener('click', async () => {
    if (!confirm(`Delete client org "${org.name}"? This does not delete its clients or any cases referencing them.`)) return;
    await deleteDoc(doc(db, 'clientOrgs', org.id));
    renderClientOrgList();
  });
  header.append(title, delOrgBtn);
  card.appendChild(header);

  const list = document.createElement('ul');
  list.style.margin = '8px 0';
  (clientsByOrg[org.id] || []).forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c.name + ' ';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-small';
    delBtn.textContent = 'Remove';
    delBtn.style.marginLeft = '6px';
    delBtn.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'clients', c.id));
      renderClientOrgList();
    });
    li.appendChild(delBtn);
    list.appendChild(li);
  });
  card.appendChild(list);

  const addForm = document.createElement('form');
  addForm.className = 'add-row';
  const nameInput = document.createElement('input');
  nameInput.placeholder = 'New client name';
  nameInput.required = true;
  const field = document.createElement('div'); field.className = 'field'; field.appendChild(nameInput);
  const addBtn = document.createElement('button');
  addBtn.type = 'submit'; addBtn.className = 'btn btn-small'; addBtn.textContent = 'Add client';
  addForm.append(field, addBtn);
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    await addDoc(collection(db, 'clients'), { name, clientOrgId: org.id });
    renderClientOrgList();
  });
  card.appendChild(addForm);

  return card;
}

addClientOrgForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addClientOrgError.textContent = '';
  const name = document.getElementById('newClientOrgName').value.trim();
  if (!name) { addClientOrgError.textContent = 'Name is required.'; return; }
  try {
    await addDoc(collection(db, 'clientOrgs'), { name });
    addClientOrgForm.reset();
    renderClientOrgList();
  } catch (err) {
    addClientOrgError.textContent = `Couldn't add client org: ${err.message}`;
  }
});
