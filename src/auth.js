import { onAuthStateChanged, signOut, EmailAuthProvider, linkWithCredential } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp, getDoc } from 'firebase/firestore';
import { BookingError } from './booking/validation.js';
import { getFirebaseSession } from './firebase.js';

export async function ensureProfile(user) {
  const { db } = await getFirebaseSession();
  const ref = doc(db, 'users', user.uid);
  // Используем те же подтверждённые Auth-данные, которые проверяют Security Rules.
  let token = await user.getIdTokenResult();
  if ((user.email && token.claims.email !== user.email) || (user.phoneNumber && token.claims.phone_number !== user.phoneNumber)) {
    token = await user.getIdTokenResult(true);
  }
  const email = typeof token.claims.email === 'string' ? token.claims.email : '';
  const phone = typeof token.claims.phone_number === 'string' ? token.claims.phone_number : '';

  return runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      // Отсутствие email в текущей сессии не означает, что его нужно удалить.
      const contacts = { email: email || existing.data().email || '', phone };
      if (existing.data().email !== contacts.email || existing.data().phone !== contacts.phone) {
        tx.update(ref, { ...contacts, updatedAt: serverTimestamp() });
      }
      return { ...existing.data(), ...contacts, id: user.uid };
    }
    const profile = { uid: user.uid, name: user.displayName || '', email, phone,
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

// Добавляем ещё один способ входа к тому же UID, не создавая второго пользователя.
export async function addEmailToAccount(email, password) {
  const { auth } = await getFirebaseSession();
  const user = auth.currentUser;
  if (!user) throw new BookingError('sign-in-required', 'Сначала войдите в аккаунт.');
  email = email.trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BookingError('invalid-email', 'Введите email в формате name@example.com.');
  }
  if (user.email) {
    // Повтор после сбоя Firestore: не создаём привязку ещё раз.
    if (user.email.toLowerCase() !== email.toLowerCase()) {
      throw new BookingError('email-linked', 'У аккаунта уже есть email. Обновите страницу.');
    }
  } else {
    if (password.length < 6) throw new BookingError('weak-password', 'Пароль должен содержать минимум 6 символов.');
    await linkWithCredential(user, EmailAuthProvider.credential(email, password));
  }
  await user.getIdToken(true);
  try {
    return { user, profile: await ensureProfile(user) };
  } catch {
    throw new BookingError('profile-sync', 'Email добавлен в Authentication, но профиль пока не обновлён. Обновите страницу; при повторной ошибке проверьте опубликованные правила Firestore.');
  }
}
