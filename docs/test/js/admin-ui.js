import { db, USERNAME_DOMAIN, createAuthAccountWithoutSigningOut } from './firebase-init.js';
import {
  doc, setDoc, updateDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ---------------------------------------------------------------------
// Admin: add user + edit role/status + reissue password.
// Convenience-only gating here (hide the screen) -- the actual protection
// is the isAdmin() check in setup/firestore.rules.
// Verifier is intentionally not modeled here -- stripped for now, coming
// back later in a different shape.
// ---------------------------------------------------------------------
const addUserForm = document.getElementById('addUserForm');
const addUserBtn = document.getElementById('addUserBtn');
const addUserError = document.getElementById('addUserError');
const newRoleSelect = document.getElementById('newRole');
const userListBody = document.getElementById('userListBody');
const statusToggle = document.getElementById('statusToggle');
const filterButtons = statusToggle.querySelectorAll('button');

let allUsers = [];
let userListFilter = 'active';

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    userListFilter = btn.dataset.filter;
    filterButtons.forEach((b) => b.classList.toggle('active', b === btn));
    statusToggle.classList.toggle('is-disabled', userListFilter === 'disabled');
    renderUserList();
  });
});

addUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addUserError.textContent = '';
  addUserBtn.disabled = true;
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = newRoleSelect.value;
  const authEmail = `${username}@${USERNAME_DOMAIN}`;
  try {
    const newUid = await createAuthAccountWithoutSigningOut(authEmail, password);
    // username is the stable identifier -- a future case/sample/action
    // model should reference people by username, never by uid, since the
    // uid behind a username can change via reissue (see Step 4).
    await setDoc(doc(db, 'users', newUid), { username, role, status: 'active' });
    await setDoc(doc(db, 'usernames', username), { authEmail });
    addUserForm.reset();
    loadUserList();
  } catch (err) {
    addUserError.textContent = err.code === 'auth/email-already-in-use'
      ? 'That username is already taken.'
      : `Couldn't add user: ${err.message}`;
  } finally {
    addUserBtn.disabled = false;
  }
});

export async function loadUserList() {
  userListBody.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
  const snap = await getDocs(collection(db, 'users'));
  allUsers = [];
  snap.forEach((d) => allUsers.push({ uid: d.id, ...d.data() }));
  allUsers.sort((a, b) => a.username.localeCompare(b.username));
  renderUserList();
}

// Active users only by default -- the "Disabled" toggle swaps the view
// rather than showing both at once, so a growing disabled list doesn't
// clutter the common case.
function renderUserList() {
  const rows = allUsers.filter((u) => u.status === userListFilter);
  userListBody.innerHTML = '';
  if (rows.length === 0) {
    userListBody.innerHTML = `<tr><td colspan="4" class="muted">No ${userListFilter} users.</td></tr>`;
    return;
  }
  rows.forEach((u) => userListBody.appendChild(renderUserRow(u)));
}

function renderUserRow(u) {
  const tr = document.createElement('tr');
  const usernameTd = document.createElement('td');
  usernameTd.textContent = u.username;

  // There's exactly one admin account, it isn't editable through this
  // screen (no "admin" option ever appears in the role dropdown either,
  // above), and there's no second admin to promote -- so its own row is
  // read-only display rather than the usual edit controls.
  let roleTd, statusTd;
  if (u.role === 'admin') {
    roleTd = document.createElement('td'); roleTd.textContent = u.role;
    statusTd = document.createElement('td'); statusTd.textContent = u.status;
  } else {
    const roleSelect = document.createElement('select');
    ['client', 'team_leader', 'worker'].forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (r === u.role) opt.selected = true;
      roleSelect.appendChild(opt);
    });

    const statusSelect = document.createElement('select');
    ['active', 'disabled'].forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === u.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });

    async function saveField(field, value) {
      await updateDoc(doc(db, 'users', u.uid), { [field]: value });
    }
    roleSelect.addEventListener('change', () => saveField('role', roleSelect.value));
    statusSelect.addEventListener('change', async () => {
      await saveField('status', statusSelect.value);
      loadUserList(); // changing status may move this row out of the current filter
    });

    roleTd = document.createElement('td'); roleTd.appendChild(roleSelect);
    statusTd = document.createElement('td'); statusTd.appendChild(statusSelect);
  }

  const actionTd = document.createElement('td');
  const reissueBtn = document.createElement('button');
  reissueBtn.type = 'button';
  reissueBtn.className = 'btn btn-small';
  reissueBtn.textContent = 'Reissue';
  actionTd.appendChild(reissueBtn);

  tr.appendChild(usernameTd);
  tr.appendChild(roleTd);
  tr.appendChild(statusTd);
  tr.appendChild(actionTd);

  reissueBtn.addEventListener('click', () => {
    if (tr.querySelector('.reissue-row')) return; // already open
    const reissueTr = document.createElement('tr');
    reissueTr.className = 'reissue-row';
    const td = document.createElement('td');
    td.colSpan = 4;
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'New password';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-small btn-primary';
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.marginLeft = '8px';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.marginLeft = '8px';
    const errSpan = document.createElement('span');
    errSpan.className = 'error';
    errSpan.style.marginLeft = '8px';

    cancelBtn.addEventListener('click', () => reissueTr.remove());
    confirmBtn.addEventListener('click', () => reissueUser(u, input.value, errSpan, confirmBtn));

    td.appendChild(input);
    td.appendChild(confirmBtn);
    td.appendChild(cancelBtn);
    td.appendChild(errSpan);
    reissueTr.appendChild(td);
    tr.after(reissueTr);
  });

  return tr;
}

// ---------------------------------------------------------------------
// Reissue. Not a true Admin-SDK password reset (still needs Blaze) --
// creates a brand-new Auth account under a disambiguated email, copies
// the profile over, disables the old account's doc, and repoints
// usernames/{username} at the new account. Net effect for the user: same
// username, new password, everything else unchanged.
// ---------------------------------------------------------------------
async function reissueUser(u, newPassword, errSpan, confirmBtn) {
  if (!newPassword) { errSpan.textContent = 'Enter a password.'; return; }
  confirmBtn.disabled = true;
  errSpan.textContent = '';
  try {
    const disambiguatedEmail = `${u.username}.r${Date.now()}@${USERNAME_DOMAIN}`;
    const newUid = await createAuthAccountWithoutSigningOut(disambiguatedEmail, newPassword);
    await setDoc(doc(db, 'users', newUid), {
      username: u.username, role: u.role, status: 'active'
    });
    await updateDoc(doc(db, 'users', u.uid), { status: 'disabled' });
    await updateDoc(doc(db, 'usernames', u.username), { authEmail: disambiguatedEmail });
    loadUserList();
  } catch (err) {
    errSpan.textContent = `Failed: ${err.message}`;
    confirmBtn.disabled = false;
  }
}
