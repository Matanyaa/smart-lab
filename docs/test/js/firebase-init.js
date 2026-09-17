import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// NOTE: icon.svg is referenced with a ?v=<version> query string in the
// <link rel="icon"> and the header <img> in index.html, to bust the
// browser's HTTP cache on every deploy. Bump those alongside this
// constant on every version change.
export const APP_VERSION = '0.3.1-t01';

export const USERNAME_DOMAIN = 'smart-lab.internal';

// --- Firebase config ---
// Safe to keep client-side: Firebase web app config is not a secret key,
// it's an identifier — access is enforced by Firestore/Auth rules instead.
const firebaseConfig = {
  apiKey: "AIzaSyDYCpHcQ640_QXXa9YOVPlh-JdYbXJD40I",
  authDomain: "smart-lab-abd80.firebaseapp.com",
  projectId: "smart-lab-abd80",
  storageBucket: "smart-lab-abd80.firebasestorage.app",
  messagingSenderId: "82399096157",
  appId: "1:82399096157:web:e99b37e6efa3654f5c8cb4"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Persistent cache: reads/writes/listeners keep working briefly offline
// and sync automatically on reconnect. Spark (free) plan only allows the
// (default) database — no second named database available, so this
// shares (default) with the launched build rather than being isolated
// at the database level. See SPEC.md.
export const db = initializeFirestore(app, { localCache: persistentLocalCache({}) });

// Creating a new Firebase Auth account signs that account in on whatever
// auth instance made the call -- so it's done on a throwaway secondary
// app instance instead of the primary one, to avoid signing the admin
// out of their own session. Shared by add-user and reissue.
export async function createAuthAccountWithoutSigningOut(email, password) {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return cred.user.uid;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}
