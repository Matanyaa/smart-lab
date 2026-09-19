import { auth, db, USERNAME_DOMAIN } from './firebase-init.js?v=0.4.1-t02';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { loadUserList } from './admin-ui.js?v=0.4.1-t02';
import { showCasesScreen, hideCasesScreen } from './cases.js?v=0.4.1-t02';
import { showClientView, hideClientView } from './client-view.js?v=0.4.1-t02';

const loginScreen = document.getElementById('loginScreen');
const settingsScreen = document.getElementById('settingsScreen');
const adminScreen = document.getElementById('adminScreen');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const greeting = document.getElementById('greeting');
const logoutBtn = document.getElementById('logoutBtn');
const settingsBtn = document.getElementById('settingsBtn');
const changePasswordForm = document.getElementById('changePasswordForm');
const changePasswordError = document.getElementById('changePasswordError');
const changePasswordSuccess = document.getElementById('changePasswordSuccess');
const headerLogo = document.getElementById('headerLogo');

let currentProfile = null; // { uid, username, role }

settingsBtn.addEventListener('click', () => {
  settingsScreen.classList.toggle('hidden');
});

// Jump from docs/test/ to the launched app at docs/ -- a deliberate
// non-primary gesture (right-click on desktop, long-press on phone) so
// it's never triggered by an ordinary tap/click on the logo.
headerLogo.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  location.href = '../';
});
let logoPressTimer = null;
headerLogo.addEventListener('touchstart', () => {
  logoPressTimer = setTimeout(() => { location.href = '../'; }, 600);
});
['touchend', 'touchmove', 'touchcancel'].forEach((evt) => {
  headerLogo.addEventListener(evt, () => clearTimeout(logoPressTimer));
});

// Self-service password change for the currently signed-in account.
// Reauthenticates with the current password first -- Firebase requires a
// recent sign-in for updatePassword, and this doubles as basic protection
// against changing the password from an unlocked, unattended device.
changePasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  changePasswordError.textContent = '';
  changePasswordSuccess.textContent = '';
  const currentPassword = document.getElementById('currentPassword').value;
  const newOwnPassword = document.getElementById('newOwnPassword').value;
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, newOwnPassword);
    changePasswordSuccess.textContent = 'Password updated.';
    changePasswordForm.reset();
  } catch (err) {
    changePasswordError.textContent = `Couldn't update password: ${err.code || err.message}`;
  }
});

// ---------------------------------------------------------------------
// Login: username -> usernames/{username}.authEmail -> sign in with that
// email. The username is the stable identifier everything else should
// eventually reference (see users/{uid} doc note below) — the uid behind
// it can be swapped out later via reissue without anything else changing.
// ---------------------------------------------------------------------
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const usernameSnap = await getDoc(doc(db, 'usernames', username));
    if (!usernameSnap.exists()) throw new Error('no-such-username');
    const { authEmail } = usernameSnap.data();
    await signInWithEmailAndPassword(auth, authEmail, password);
  } catch (err) {
    console.error('Login failed:', err);
    loginError.textContent = `Login failed: check username and password. (${err.code || err.message})`;
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => signOut(auth));

// Admin's username and role are effectively the same word ("admin | admin"
// reads as redundant), so admin gets just the name; every other role
// keeps "{username} | {role}".
function renderGreeting(profile) {
  greeting.textContent = '';
  const nameEl = document.createElement('strong');
  nameEl.textContent = profile.username;
  if (profile.role === 'admin') {
    greeting.append(nameEl);
  } else {
    greeting.append(nameEl, ` | ${profile.role}`);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    adminScreen.classList.add('hidden');
    greeting.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    settingsBtn.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    settingsScreen.classList.add('hidden');
    changePasswordForm.reset();
    changePasswordError.textContent = '';
    changePasswordSuccess.textContent = '';
    hideCasesScreen();
    hideClientView();
    currentProfile = null;
    return;
  }

  loginScreen.classList.add('hidden');
  logoutBtn.classList.remove('hidden');
  settingsBtn.classList.remove('hidden');
  loginForm.reset();

  const profileSnap = await getDoc(doc(db, 'users', user.uid));
  if (!profileSnap.exists()) {
    greeting.classList.add('hidden');
    adminScreen.classList.add('hidden');
    hideCasesScreen();
    hideClientView();
    currentProfile = null;
    return;
  }
  const profile = profileSnap.data();
  currentProfile = { uid: user.uid, ...profile };

  renderGreeting(profile);
  greeting.classList.remove('hidden');

  if (profile.role === 'admin') {
    adminScreen.classList.remove('hidden');
    loadUserList();
  } else {
    adminScreen.classList.add('hidden');
  }

  // Cases screen is for the working lab team, not admin -- admin's role
  // this iteration is purely user management (2026-09-18, at the user's
  // request; TASK.md had originally allowed admin case access "for
  // testing purposes", but that's been narrowed back down deliberately;
  // 0.4.1 made this exclusion a real rules-level lockout too, not just
  // this UI gate -- see setup/firestore.rules). 0.4.1 also adds a real
  // client-facing view, routed here by role.
  if (['team_leader', 'worker'].includes(profile.role)) {
    hideClientView();
    showCasesScreen(currentProfile);
  } else if (profile.role === 'client') {
    hideCasesScreen();
    showClientView(currentProfile);
  } else {
    hideCasesScreen();
    hideClientView();
  }
});
