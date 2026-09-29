import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

const env = import.meta.env;
export const emulator = env.DEV && env.VITE_USE_FIREBASE_EMULATORS === 'true';
export const testPhoneMode = env.DEV && env.VITE_FIREBASE_TEST_PHONE_AUTH === 'true';
const config = emulator ? {
  apiKey: 'demo-key', authDomain: 'demo-coffepoint.firebaseapp.com',
  projectId: 'demo-coffepoint', appId: 'demo-app',
} : {
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);
let session;
export let app, auth, db;

export function getFirebaseSession() {
  if (!firebaseConfigured) return Promise.reject(new Error('firebase/not-configured'));
  if (session) return session;
  session = (async () => {
    app = initializeApp(config);
    auth = getAuth(app);
    auth.languageCode = 'ru';
    // Production-сборка всегда включает настоящую проверку приложения.
    auth.settings.appVerificationDisabledForTesting = emulator || testPhoneMode;
    db = getFirestore(app);
    if (emulator) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    // Вход сохраняется между страницами; на общем устройстве используйте «Выйти».
    await setPersistence(auth, browserLocalPersistence);
    await auth.authStateReady();
    return { app, auth, db };
  })();
  // Повторный вызов после сбоя перезагрузит страницу, чтобы не подключать эмуляторы дважды.
  return session;
}
