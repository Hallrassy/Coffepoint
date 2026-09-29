import { signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged } from 'firebase/auth';
import { getFirebaseSession } from './firebase.js';
import { ensureProfile, initAccountNav } from './auth.js';
import { sendPhoneCode, clearPhoneVerifier } from './booking/phone.js';
import { normalizePhone } from './booking/validation.js';
import { $, action, message, report } from './ui.js';
let confirmation;
let nextCodeAt = 0;
async function signedIn(user) { await user.getIdToken(true); await ensureProfile(user); location.assign('/profile.html'); }
async function emailLogin() {
  if (!$('email-form').reportValidity()) return;
  const buttons = [$('email-login'), $('reset-password')];
  buttons.forEach((item) => { item.disabled = true; });
  message('Входим…');
  try {
    const { auth } = await getFirebaseSession();
    if (auth.currentUser) { message('Вы уже вошли. Добавьте email в личном кабинете.'); return; }
    const result = await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    await signedIn(result.user);
  } catch (error) { report(error); }
  finally { buttons.forEach((item) => { item.disabled = false; }); }
}
$('email-form').addEventListener('submit', (event) => { event.preventDefault(); void emailLogin(); });
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
    const { auth } = await getFirebaseSession();
    if (auth.currentUser) { message('Вы уже вошли. Перейдите в личный кабинет.'); return; }
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
document.querySelectorAll('[data-auth-method]').forEach((button) => {
  button.addEventListener('click', () => {
    const email = button.dataset.authMethod === 'email';
    $('email-panel').hidden = !email; $('phone-panel').hidden = email;
    document.querySelectorAll('[data-auth-method]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    message(email ? 'Войдите по email, который уже добавлен к вашему аккаунту.' : 'Войдите по номеру телефона. Email добавляется в кабинете.');
  });
});
void getFirebaseSession().then(({ auth }) => {
  const stop = onAuthStateChanged(auth, (user) => {
    $('auth-methods').hidden = Boolean(user); $('signed-in-panel').hidden = !user;
    message(user ? 'Вы уже вошли. Перейдите в личный кабинет.' : 'Выберите один способ входа.');
  });
  window.addEventListener('pagehide', () => { stop(); clearPhoneVerifier(); }, { once: true });
}).catch(report);
void initAccountNav().catch(() => {});
