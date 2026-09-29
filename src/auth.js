import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp, getDoc } from 'firebase/firestore';
import { getFirebaseSession } from './firebase.js';

export async function ensureProfile(user) {
  const { db } = await getFirebaseSession();
  const ref = doc(db, 'users', user.uid);
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      const contacts = { email: user.email || '', phone: user.phoneNumber || '' };
      if (existing.data().email !== contacts.email || existing.data().phone !== contacts.phone) {
        tx.update(ref, { ...contacts, updatedAt: serverTimestamp() });
      }
      return { ...existing.data(), ...contacts, id: user.uid };
    }
    const profile = { uid: user.uid, name: user.displayName || '', email: user.email || '', phone: user.phoneNumber || '',
      role: 'user', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    tx.set(ref, profile);
    return profile;
  });
}
export async function requireUser(admin = false) {
  const { auth, db } = await getFirebaseSession();
  const user = auth.currentUser;
  if (!user) { location.replace('/auth.html'); return null; }
  await ensureProfile(user);
  const profile = (await getDoc(doc(db, 'users', user.uid))).data();
  if (admin && profile.role !== 'admin') { location.replace('/profile.html'); return null; }
  return { user, profile, auth, db };
}
export async function initAccountNav() {
  const { auth } = await getFirebaseSession();
  const stop = onAuthStateChanged(auth, (user) => {
    document.querySelectorAll('[data-account]').forEach((link) => {
      link.textContent = user ? 'Личный кабинет' : 'Войти';
      link.href = user ? '/profile.html' : '/auth.html';
    });
  });
  window.addEventListener('pagehide', stop, { once: true });
}
export async function logout() {
  const { auth } = await getFirebaseSession();
  await signOut(auth);
  location.replace('/auth.html');
}
