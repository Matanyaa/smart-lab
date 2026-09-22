import { db, USERNAME_DOMAIN, createAuthAccountWithoutSigningOut } from './firebase-init.js?v=0.4.1-t13';
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { renderCaseTypeList } from './case-types-ui.js?v=0.4.1-t13';
import { renderClientOrgList, getCachedClientOrgs, loadClientOrgsAndClients } from './clients-ui.js?v=0.4.1-t13';

// ---------------------------------------------------------------------
// Admin: add user + edit role + reset another user's password.
// Convenience-only gating here (hide the screen) -- the actual protection
// is the isAdmin() check in setup/firestore.rules.
// Verifier is intentionally not modeled here -- stripped for now, coming
// back later in a different shape. Status is gone too (2026-09-18) --
// delete now covers what "disabled" used to be for, see resetUserPassword.
// "Reset password" here is user-facing wording for what SPEC.md calls
// "reissue" -- neither admin's own row nor a plain self-service password
// change (see auth-ui.js) need this; it's specifically for setting
// *someone else's* password (2026-09-18: stripped from admin's own row --
// admin can just use the ordinary "Change password" button for itself).
// ---------------------------------------------------------------------
const addUserForm = document.getElementById('addUserForm');
const addUserBtn = document.getElementById('addUserBtn');
const addUserError = document.getElementById('addUserError');
const newRoleSelect = document.getElementById('newRole');
const userListBody = document.getElementById('userListBody');
const newUserClientOrgField = document.getElementById('newUserClientOrgField');
const newUserClientOrgSelect = document.getElementById('newUserClientOrg');

let allUsers = [];

// 0.4.1: a client-role account is a shared login for exactly one client
// org (see SPEC.md's "Client org / Client") -- it needs to know which org
// that is, so the field only shows (and is only required) when 'client'
// is picked.
newRoleSelect.addEventListener('change', async () => {
  const isClient = newRoleSelect.value === 'client';
  newUserClientOrgField.hidden = !isClient;
  if (isClient) {
    await loadClientOrgsAndClients();
    newUserClientOrgSelect.innerHTML = '';
    getCachedClientOrgs().forEach((org) => {
      const opt = document.createElement('option');
      opt.value = org.id;
      opt.textContent = org.name;
      newUserClientOrgSelect.appendChild(opt);
    });
  }
});

addUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addUserError.textContent = '';
  addUserBtn.disabled = true;
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = newRoleSelect.value;
  const authEmail = `${username}@${USERNAME_DOMAIN}`;
  if (role === 'client' && !newUserClientOrgSelect.value) {
    addUserError.textContent = 'Pick a client org.';
    addUserBtn.disabled = false;
    return;
  }
  try {
    const newUid = await createAuthAccountWithoutSigningOut(authEmail, password);
    // username is the stable identifier -- a future case/sample/action
    // model should reference people by username, never by uid, since the
    // uid behind a username can change via reissue (see Step 4).
    const profile = { username, role };
    if (role === 'client') profile.clientOrgId = newUserClientOrgSelect.value;
    await setDoc(doc(db, 'users', newUid), profile);
    await setDoc(doc(db, 'usernames', username), { authEmail });
    addUserForm.reset();
    newUserClientOrgField.hidden = true;
    loadUserList();
  } catch (err) {
    addUserError.textContent = err.code === 'auth/email-already-in-use'
      ? 'That username is already taken.'
      : `Couldn't add user: ${err.message}`;
  } finally {
    addUserBtn.disabled = false;
  }
});

// 0.4.1: admin screen gained two more tabs (Case types, Clients) alongside
// the original Users panel -- a plain show/hide toggle, not a router.
document.querySelectorAll('#adminTabs .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#adminTabs .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach((p) => p.classList.add('hidden'));
    const panel = document.getElementById(btn.dataset.tab);
    panel.classList.remove('hidden');
    if (btn.dataset.tab === 'adminCaseTypesPanel') renderCaseTypeList();
    if (btn.dataset.tab === 'adminClientsPanel') renderClientOrgList();
  });
});

export async function loadUserList() {
  userListBody.innerHTML = '<tr><td colspan="3" class="muted">Loading…</td></tr>';
  const snap = await getDocs(collection(db, 'users'));
  allUsers = [];
  snap.forEach((d) => allUsers.push({ uid: d.id, ...d.data() }));
  allUsers.sort((a, b) => a.username.localeCompare(b.username));
  renderUserList();
}

function renderUserList() {
  userListBody.innerHTML = '';
  if (allUsers.length === 0) {
    userListBody.innerHTML = '<tr><td colspan="3" class="muted">No users yet.</td></tr>';
    return;
  }
  allUsers.forEach((u) => userListBody.appendChild(renderUserRow(u)));
}

function renderUserRow(u) {
  const tr = document.createElement('tr');
  const usernameTd = document.createElement('td');
  usernameTd.textContent = u.username;

  // There's exactly one admin account, it isn't editable through this
  // screen (no "admin" option ever appears in the role dropdown either,
  // above), and there's no second admin to promote -- so its own row is
  // read-only display rather than the usual edit controls.
  let roleTd;
  if (u.role === 'admin') {
    roleTd = document.createElement('td'); roleTd.textContent = u.role;
  } else {
    const roleSelect = document.createElement('select');
    ['client', 'team_leader', 'worker'].forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (r === u.role) opt.selected = true;
      roleSelect.appendChild(opt);
    });

    roleSelect.addEventListener('change', () => updateDoc(doc(db, 'users', u.uid), { role: roleSelect.value }));

    roleTd = document.createElement('td'); roleTd.appendChild(roleSelect);
  }

  // Neither action applies to admin's own row: it has no password-reset
  // path here since admin can just use its own "Change password" button
  // (see auth-ui.js), and it's already established elsewhere that admin
  // has no delete/edit controls on itself either.
  const actionTd = document.createElement('td');
  let resetPasswordBtn = null;
  let deleteBtn = null;
  if (u.role !== 'admin') {
    resetPasswordBtn = document.createElement('button');
    resetPasswordBtn.type = 'button';
    resetPasswordBtn.className = 'btn btn-small';
    resetPasswordBtn.textContent = 'Reset password';
    actionTd.appendChild(resetPasswordBtn);

    deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.marginLeft = '6px';
    actionTd.appendChild(deleteBtn);
  }

  tr.appendChild(usernameTd);
  tr.appendChild(roleTd);
  tr.appendChild(actionTd);

  // Shared by Reset password and Delete -- only one inline sub-row open at a time.
  function openInlineRow(build) {
    if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('inline-action-row')) return;
    const inlineTr = document.createElement('tr');
    inlineTr.className = 'inline-action-row';
    const td = document.createElement('td');
    td.colSpan = 3;
    build(td, () => inlineTr.remove());
    inlineTr.appendChild(td);
    tr.after(inlineTr);
  }

  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener('click', () => {
      openInlineRow((td, close) => {
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

        cancelBtn.addEventListener('click', close);
        confirmBtn.addEventListener('click', () => resetUserPassword(u, input.value, errSpan, confirmBtn));

        td.append(input, confirmBtn, cancelBtn, errSpan);
      });
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      openInlineRow((td, close) => {
        const msg = document.createElement('span');
        msg.className = 'error';
        msg.textContent = `Delete ${u.username}'s profile? They'll immediately lose all access. `;
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'btn btn-small btn-primary';
        confirmBtn.textContent = 'Confirm delete';
        confirmBtn.style.marginLeft = '8px';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-small';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.marginLeft = '8px';

        const errSpan = document.createElement('span');
        errSpan.className = 'error';
        errSpan.style.marginLeft = '8px';

        cancelBtn.addEventListener('click', close);
        confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          try {
            // Deleting only users/{uid} left usernames/{username} behind,
            // still pointing at the (now-nonexistent) account -- an
            // orphaned doc sitting in Firestore even though the app
            // itself looked fully deleted. Fixed 2026-09-18: delete both.
            await deleteDoc(doc(db, 'users', u.uid));
            await deleteDoc(doc(db, 'usernames', u.username));
            loadUserList();
          } catch (err) {
            errSpan.textContent = `Failed: ${err.message}`;
            confirmBtn.disabled = false;
          }
        });

        td.append(msg, confirmBtn, cancelBtn, errSpan);
      });
    });
  }

  return tr;
}

// ---------------------------------------------------------------------
// Reset another user's password ("reissue" in SPEC.md's terminology).
// Not a true Admin-SDK password reset (still needs Blaze) -- creates a
// brand-new Auth account under a disambiguated email, copies the profile
// over, repoints usernames/{username} at the new account, and deletes
// the old account's profile doc (2026-09-18: previously just disabled it
// and left it sitting there; the user asked for it to be cleaned up
// automatically instead). This does NOT delete the old account's
// underlying Firebase Auth credential -- that still isn't possible
// client-side without the Admin SDK (Blaze) -- but with its profile doc
// gone, every rule in setup/firestore.rules denies it, so it's a real,
// immediate lockout, not just a UI-hidden one. Net effect for the user:
// same username, new password, everything else unchanged.
// ---------------------------------------------------------------------
async function resetUserPassword(u, newPassword, errSpan, confirmBtn) {
  if (!newPassword) { errSpan.textContent = 'Enter a password.'; return; }
  confirmBtn.disabled = true;
  errSpan.textContent = '';
  try {
    const disambiguatedEmail = `${u.username}.r${Date.now()}@${USERNAME_DOMAIN}`;
    const newUid = await createAuthAccountWithoutSigningOut(disambiguatedEmail, newPassword);
    // Carries clientOrgId forward too (0.4.1) -- otherwise resetting a
    // client account's password would silently strip its org link.
    const profile = { username: u.username, role: u.role };
    if (u.clientOrgId) profile.clientOrgId = u.clientOrgId;
    await setDoc(doc(db, 'users', newUid), profile);
    await updateDoc(doc(db, 'usernames', u.username), { authEmail: disambiguatedEmail });
    await deleteDoc(doc(db, 'users', u.uid));
    loadUserList();
  } catch (err) {
    errSpan.textContent = `Failed: ${err.message}`;
    confirmBtn.disabled = false;
  }
}
