import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, onAuthStateChanged } from 'firebase/auth';
import { getFirebaseSession } from './firebase.js';
import { ensureProfile, initAccountNav } from './auth.js';
import { sendPhoneCode, clearPhoneVerifier } from './booking/phone.js';
import { normalizePhone } from './booking/validation.js';
import { $, action, message, report } from './ui.js';
let confirmation;
let nextCodeAt = 0;
async function signedIn(user) { await user.getIdToken(true); await ensureProfile(user); location.assign('/profile.html'); }
async function emailAuth(register) {
  if (!$('email-form').reportValidity()) return;
  const buttons = [$('email-login'), $('email-register'), $('reset-password')];
  buttons.forEach((item) => { item.disabled = true; });
  message(register ? 'Создаём аккаунт…' : 'Входим…');
  try {
    const { auth } = await getFirebaseSession();
    const result = await (register ? createUserWithEmailAndPassword : signInWithEmailAndPassword)(auth, $('email').value.trim(), $('password').value);
    if (register) await updateProfile(result.user, { displayName: $('auth-name').value.trim() });
    await signedIn(result.user);
  } catch (error) { report(error); }
  finally { buttons.forEach((item) => { item.disabled = false; }); }
}
$('email-form').addEventListener('submit', (event) => { event.preventDefault(); void emailAuth(false); });
$('email-register').addEventListener('click', () => void emailAuth(true));
$('reset-password').addEventListener('click', () => action($('reset-password'), async () => {
  if (!$('email').reportValidity()) return;
  const { auth } = await getFirebaseSession();
  await sendPasswordResetEmail(auth, $('email').value.trim());
  message('Если аккаунт существует, письмо для восстановления отправлено. Проверьте почту.');
}));
$('phone-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action($('send-phone'), async () => {
    if (Date.now() < nextCodeAt) { message('Повторный код можно запросить через минуту.'); return; }
    const phone = normalizePhone($('login-phone').value);
    if (!phone) { message('Введите телефон с кодом страны.', true); return; }
    message('Запрашиваем код…');
    confirmation = await sendPhoneCode(phone); nextCodeAt = Date.now() + 60000;
    $('code-form').hidden = false; $('login-phone').readOnly = true;
    message('Введите код из SMS; в эмуляторе код выводится в терминале.');
  });
});
$('code-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action($('confirm-phone'), async () => {
    const result = await confirmation.confirm($('login-code').value.trim());
    clearPhoneVerifier(); await signedIn(result.user);
  });
});
void getFirebaseSession().then(({ auth }) => {
  const stop = onAuthStateChanged(auth, (user) => message(user ? 'Вы уже вошли. Перейдите в личный кабинет или выйдите из аккаунта там.' : 'Войдите по телефону или email.'));
  window.addEventListener('pagehide', () => { stop(); clearPhoneVerifier(); }, { once: true });
}).catch(report);
void initAccountNav().catch(() => {});
