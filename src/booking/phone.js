import { RecaptchaVerifier, signInWithPhoneNumber, linkWithPhoneNumber } from 'firebase/auth';
import { getFirebaseSession } from '../firebase.js';

let verifier;
export async function sendPhoneCode(phone) {
  const { auth } = await getFirebaseSession();
  verifier?.clear();
  verifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
  try {
    return auth.currentUser && !auth.currentUser.phoneNumber
      ? await linkWithPhoneNumber(auth.currentUser, phone, verifier)
      : await signInWithPhoneNumber(auth, phone, verifier);
  } catch (error) {
    verifier.clear();
    verifier = null;
    throw error;
  }
}

export function clearPhoneVerifier() { verifier?.clear(); verifier = null; }
