import { BOOKING, dateLimits, startTime } from './catalog.js';
import { normalizePhone, validateBooking } from './validation.js';
import { watchAvailability, createReservation } from './service.js';
import { sendPhoneCode, clearPhoneVerifier } from './phone.js';
import { errorMessage } from './errors.js';
import { firebaseConfigured, emulator, testPhoneMode, getFirebaseSession } from '../firebase.js';

import { listCafes, getCafe, listDrinks } from '../services/cafes.js';
import { ensureProfile } from '../auth.js';
import { onAuthStateChanged } from 'firebase/auth';

let cafes = [], drinks = [];
let cafeCursor, drinkCursor;
const $ = (id) => document.getElementById(id);
const money = (amount) => `${new Intl.NumberFormat('ru-RU').format(amount)} ₸`;
const dateFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: BOOKING.timeZone, day: 'numeric', month: 'long' });
const quantities = new Map(drinks.map((drink) => [drink.id, 0]));
let cafe;
let selectedTable = '';
let selectedTime = '';
let occupied = new Map();
let availabilityReady = false;
let unsubscribe;
let availabilityVersion = 0;
let confirmation;
let sentPhone = '';
let verifiedPhone = '';
let nextCodeAt = 0;
let authBusy = false;
let saving = false;
let pendingRequest;
let finished = false;

function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).dataset.error = String(error);
}

function selection() {
  return {
    cafeId: cafe.id, date: $('visit-date').value, time: selectedTime,
    tableId: selectedTable, guests: Number($('guests').value),
    fullName: $('full-name').value, phone: normalizePhone($('phone').value),
    consent: $('consent').checked,
    drinks: [...quantities].filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })),
  };
}

function isTaken(tableId) {
  return occupied.has(tableId) && occupied.get(tableId) !== pendingRequest?.id;
}

function renderCafes() {
  const fragment = document.createDocumentFragment();
  cafes.forEach((item) => {
    const card = $('cafe-template').content.cloneNode(true);
    const radio = card.querySelector('input');
    radio.value = item.id;
    radio.checked = item.id === cafe.id;
    card.querySelector('img').src = item.image;
    card.querySelector('small').textContent = item.name;
    card.querySelector('strong').textContent = item.address;
    fragment.append(card);
  });
  $('cafe-options').replaceChildren(fragment);
}

function renderTimes() {
  const now = new Date();
  const date = $('visit-date').value;
  const { min, max } = dateLimits(now);
  $('visit-date').min = min;
  $('visit-date').max = max;
  const validDate = $('visit-date').validity.valid;
  const validTimes = BOOKING.times.filter((time) => validDate && startTime(date, time) > now);
  if (!validTimes.includes(selectedTime)) selectedTime = validTimes[0] ?? '';
  const fragment = document.createDocumentFragment();
  BOOKING.times.forEach((time) => {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'time'; input.value = time;
    input.checked = time === selectedTime; input.disabled = !validTimes.includes(time);
    const text = document.createElement('span'); text.textContent = time;
    label.append(input, text); fragment.append(label);
  });
  $('time-options').replaceChildren(fragment);
}

function renderTables() {
  const previousFocus = document.activeElement?.dataset.table;
  const fragment = document.createDocumentFragment();
  cafe.tables.forEach((table) => {
    const tooSmall = table.seats < Number($('guests').value);
    const taken = isTaken(table.id);
    if (selectedTable === table.id && (tooSmall || taken) && !saving) selectedTable = '';
    const label = document.createElement('label'); label.className = 'choice table-choice';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'table'; input.value = table.id; input.dataset.table = table.id;
    input.checked = selectedTable === table.id;
    input.disabled = tooSmall || taken || !selectedTime;
    const body = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = `Столик ${table.number}`;
    const seats = document.createElement('small'); seats.textContent = `${table.seats} места · ${table.label}`;
    const state = document.createElement('em');
    state.textContent = tooSmall ? 'Мало мест' : taken ? 'Занят' : !availabilityReady ? 'Доступность уточняется' : 'Свободен';
    body.append(title, seats, state); label.append(input, body); fragment.append(label);
  });
  $('table-options').replaceChildren(fragment);
  if (previousFocus) $('table-options').querySelector(`[data-table="${previousFocus}"]`)?.focus();
}

function renderDrinks() {
  const fragment = document.createDocumentFragment();
  drinks.forEach((drink) => {
    const row = $('drink-template').content.cloneNode(true);
    row.querySelector('.drink-row').dataset.drink = drink.id;
    row.querySelector('strong').textContent = drink.name;
    row.querySelector('.drink-meta').textContent = `${drink.size} · ${money(drink.price)}`;
    row.querySelector('[data-delta="-1"]').setAttribute('aria-label', `Убрать: ${drink.name}`);
    row.querySelector('[data-delta="1"]').setAttribute('aria-label', `Добавить: ${drink.name}`);
    row.querySelector('output').setAttribute('aria-label', `Количество: ${drink.name}`);
    fragment.append(row);
  });
  $('drink-options').replaceChildren(fragment);
  updateQuantities();
}

function updateQuantities() {
  const total = [...quantities.values()].reduce((sum, number) => sum + number, 0);
  $('drink-options').querySelectorAll('.drink-row').forEach((row) => {
    const quantity = quantities.get(row.dataset.drink);
    row.querySelector('output').textContent = String(quantity);
    row.querySelector('[data-delta="-1"]').disabled = quantity === 0;
    row.querySelector('[data-delta="1"]').disabled = quantity >= BOOKING.maxQuantity || total >= BOOKING.maxDrinks || (quantity === 0 && [...quantities.values()].filter((n) => n > 0).length >= 6);
  });
}

function updateSummary() {
  const data = selection();
  $('summary-cafe').textContent = cafe.address;
  $('summary-date').textContent = data.date && selectedTime
    ? `${dateFormat.format(startTime(data.date, selectedTime))} · ${selectedTime} · 2 часа` : 'Выберите дату и время';
  const table = cafe.tables.find((item) => item.id === selectedTable);
  $('summary-table').textContent = table ? `№ ${table.number} · Гостей: ${data.guests}` : 'Выберите столик';
  const fragment = document.createDocumentFragment();
  let total = 0;
  data.drinks.forEach(({ id, quantity }) => {
    const drink = drinks.find((item) => item.id === id);
    total += drink.price * quantity;
    const line = document.createElement('p'); line.textContent = `${drink.name} × ${quantity}`; fragment.append(line);
  });
  if (!data.drinks.length) fragment.append(document.createTextNode('Напитки можно заказать на месте.'));
  $('summary-drinks').replaceChildren(fragment);
  $('summary-total').textContent = money(total);
  updateControls();
}

function updateControls() {
  const verified = Boolean(verifiedPhone && verifiedPhone === normalizePhone($('phone').value));
  $('verified-badge').hidden = !verified;
  $('phone').readOnly = authBusy || saving;
  $('send-code').hidden = verified;
  const remaining = Math.max(0, Math.ceil((nextCodeAt - Date.now()) / 1000));
  $('send-code').disabled = authBusy || saving || remaining > 0 || !firebaseConfigured;
  $('send-code').textContent = authBusy ? 'Подождите…' : remaining > 0 ? `Повторить через ${remaining} с` : confirmation ? 'Отправить код ещё раз' : 'Получить код';
  $('verify-code').disabled = authBusy || saving;
  $('submit-booking').disabled = saving || authBusy || finished || !availabilityReady || !selectedTable || !verified || !$('consent').checked;
  $('submit-booking').textContent = saving ? 'Сохраняем заявку…' : 'Отправить заявку ↗';
  $('submit-hint').textContent = !availabilityReady ? 'Дождитесь проверки доступности столиков.' : !selectedTable ? 'Выберите столик.' : !verified ? 'Подтвердите номер телефона.' : !$('consent').checked ? 'Нужно согласие на обработку контактов.' : 'Заявка будет сохранена после нажатия кнопки.';
}

async function refreshAvailability() {
  const version = ++availabilityVersion;
  unsubscribe?.(); unsubscribe = undefined;
  availabilityReady = false; occupied = new Map();
  $('retry-availability').hidden = true;
  renderTables(); updateSummary();
  if (!selectedTime) {
    status('availability-message', 'На эту дату доступного времени нет. Выберите другой день.');
    return;
  }
  status('availability-message', 'Проверяем доступность столиков…');
  const fail = (error) => {
    if (version !== availabilityVersion) return;
    availabilityReady = false;
    status('availability-message', errorMessage(error), true);
    $('retry-availability').hidden = false;
    renderTables(); updateSummary();
  };
  try {
    const stop = await watchAvailability(cafe.id, startTime($('visit-date').value, selectedTime), (tables, ready) => {
      if (version !== availabilityVersion) return;
      occupied = tables; availabilityReady = ready;
      const free = cafe.tables.filter((table) => table.seats >= Number($('guests').value) && !isTaken(table.id)).length;
      status('availability-message', !ready ? 'Нет актуальных данных. Проверяем соединение…' : free ? 'Доступность обновляется автоматически.' : 'Подходящих свободных столиков нет. Попробуйте другое время.');
      renderTables(); updateSummary();
    }, fail);
    if (version !== availabilityVersion) stop(); else unsubscribe = stop;
  } catch (error) { fail(error); }
}

$('cafe-options').addEventListener('change', (event) => {
  cafe = cafes.find((item) => item.id === event.target.value);
  selectedTable = ''; void refreshAvailability();
});
$('visit-date').addEventListener('change', () => { selectedTable = ''; renderTimes(); void refreshAvailability(); });
$('time-options').addEventListener('change', (event) => { selectedTime = event.target.value; selectedTable = ''; void refreshAvailability(); });
$('guests').addEventListener('change', () => { renderTables(); updateSummary(); });
$('table-options').addEventListener('change', (event) => { selectedTable = event.target.value; updateSummary(); });
$('drink-options').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-delta]');
  if (!button || button.disabled) return;
  const id = button.closest('[data-drink]').dataset.drink;
  quantities.set(id, quantities.get(id) + Number(button.dataset.delta));
  updateQuantities(); updateSummary();
});
$('phone').addEventListener('input', () => {
  if (normalizePhone($('phone').value) !== sentPhone) {
    confirmation = undefined; $('otp-panel').hidden = true; $('sms-code').value = '';
  }
  status('phone-status', ''); updateControls();
});
$('consent').addEventListener('change', updateControls);

$('send-code').addEventListener('click', async () => {
  if (authBusy || Date.now() < nextCodeAt) return;
  const phone = normalizePhone($('phone').value);
  if (!phone) { status('phone-status', 'Введите телефон с кодом страны.', true); $('phone').focus(); return; }
  if (!$('consent').checked) { $('consent').reportValidity(); return; }
  authBusy = true; updateControls(); status('phone-status', 'Запрашиваем код…');
  try {
    confirmation = await sendPhoneCode(phone); sentPhone = phone;
    nextCodeAt = Date.now() + 60000;
    $('otp-panel').hidden = false;
    status('phone-status', emulator ? 'Код доступен в локальном эмуляторе Authentication.' : testPhoneMode ? 'Введите код, заданный для этого тестового номера в Firebase Console. SMS не отправляется.' : `Код отправлен на ${phone}.`);
    $('sms-code').focus();
  } catch (error) { status('phone-status', errorMessage(error), true); }
  finally { authBusy = false; updateControls(); }
});

$('verify-code').addEventListener('click', async () => {
  if (authBusy || !confirmation) return;
  const code = $('sms-code').value.trim();
  if (!/^\d{6}$/.test(code)) { status('phone-status', 'Введите 6 цифр кода.', true); $('sms-code').focus(); return; }
  authBusy = true; updateControls(); status('phone-status', 'Проверяем код…');
  try {
    const result = await confirmation.confirm(code);
    await result.user.getIdToken(true);
    await ensureProfile(result.user);
    verifiedPhone = result.user.phoneNumber ?? '';
    $('otp-panel').hidden = true; $('sms-code').value = '';
    clearPhoneVerifier(); status('phone-status', 'Телефон подтверждён. Теперь можно отправить заявку.');
  } catch (error) { status('phone-status', errorMessage(error), true); }
  finally { authBusy = false; updateControls(); }
});

$('booking-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || authBusy || finished) return;
  if (!$('booking-form').reportValidity()) return;
  if (!availabilityReady || !selectedTable || !verifiedPhone) {
    status('booking-status', 'Выберите доступный столик и подтвердите телефон.', true); return;
  }
  const data = selection();
  const signature = JSON.stringify(data);
  if (pendingRequest?.signature !== signature) pendingRequest = { signature, id: crypto.randomUUID() };
  const payload = { ...data, requestId: pendingRequest.id };
  try { validateBooking(payload, new Date(), { cafes, drinks }); }
  catch (error) { status('booking-status', errorMessage(error), true); return; }
  saving = true; $('form-body').disabled = true; updateControls(); status('booking-status', 'Сохраняем заявку…');
  try {
    const saved = await createReservation(payload, validateBooking(payload, new Date(), { cafes, drinks }).drinksTotal);
    finished = true; unsubscribe?.(); availabilityVersion++;
    $('booking-layout').hidden = true;
    $('booking-success').hidden = false;
    $('success-details').textContent = `${saved.address}\n${dateFormat.format(startTime(data.date, data.time))}, ${data.time} · Столик ${saved.tableNumber}\nГостей: ${saved.guests} · Напитки: ${money(saved.drinksTotal)}\nНомер заявки: ${saved.id}`;
    $('full-name').value = ''; $('phone').value = ''; $('sms-code').value = '';
    $('booking-success').focus();
    $('booking-success').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    status('booking-status', errorMessage(error), true);
    if (error.code === 'table-taken') { selectedTable = ''; void refreshAvailability(); }
  } finally { saving = false; $('form-body').disabled = false; updateControls(); }
});

$('retry-availability').addEventListener('click', () => void refreshAvailability());
window.addEventListener('online', () => { if (!finished && cafe) void refreshAvailability(); });
const timer = setInterval(() => { if (!finished && cafe) updateControls(); }, 1000);
window.addEventListener('pagehide', () => { unsubscribe?.(); clearPhoneVerifier(); clearInterval(timer); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cafe && !finished && !saving) { renderTimes(); void refreshAvailability(); }
});

if (emulator || testPhoneMode) {
  $('test-notice').hidden = false;
  $('test-notice').textContent = emulator
    ? 'Локальное тестирование: заявки хранятся в эмуляторе, настоящие SMS не отправляются.'
    : 'Тестирование: используйте вымышленный номер и код из Firebase Console. Заявки сохраняются в учебном Firebase-проекте.';
}
const limits = dateLimits();
$('visit-date').min = limits.min; $('visit-date').max = limits.max; $('visit-date').value = limits.min;
async function boot() {
  $('form-body').disabled = true;
  status('booking-status', 'Загружаем кофейни и меню…');
  try {
    const [cafePage, drinkPage, session] = await Promise.all([listCafes({ size: 10 }), listDrinks(), getFirebaseSession()]);
    cafes = cafePage.items; drinks = drinkPage.items;
    cafeCursor = cafePage.cursor; drinkCursor = drinkPage.cursor;
    const selectedId = new URLSearchParams(location.search).get('cafe');
    if (selectedId && !cafes.some((item) => item.id === selectedId)) {
      const selected = await getCafe(selectedId);
      if (selected?.active) cafes.unshift(selected);
    }
    cafe = cafes.find((item) => item.id === selectedId) || cafes[0];
    if (!cafe) throw new Error('empty-catalog');
    drinks.forEach((drink) => quantities.set(drink.id, 0));
    $('more-cafes').hidden = !cafePage.more; $('more-drinks').hidden = !drinkPage.more;
    const stopAuth = onAuthStateChanged(session.auth, (user) => {
      verifiedPhone = user?.phoneNumber || '';
      if (verifiedPhone) $('phone').value = verifiedPhone;
      updateControls();
    });
    window.addEventListener('pagehide', stopAuth, { once: true });
    renderCafes(); renderTimes(); renderTables(); renderDrinks(); updateSummary();
    $('form-body').disabled = false;
    status('booking-status', '');
    await refreshAvailability();
  } catch (error) {
    status('booking-status', error.message === 'empty-catalog' ? 'Каталог пока пуст. Администратор должен добавить кофейни.' : errorMessage(error), true);
  }
}
$('more-cafes').addEventListener('click', async () => {
  $('more-cafes').disabled = true;
  try {
    const page = await listCafes({ size: 10, cursor: cafeCursor });
    cafes.push(...page.items.filter((item) => !cafes.some((c) => c.id === item.id)));
    cafeCursor = page.cursor; $('more-cafes').hidden = !page.more; renderCafes();
  } catch (error) { status('booking-status', errorMessage(error), true); }
  finally { $('more-cafes').disabled = false; }
});
$('more-drinks').addEventListener('click', async () => {
  $('more-drinks').disabled = true;
  try {
    const page = await listDrinks(drinkCursor);
    drinks.push(...page.items); page.items.forEach((item) => quantities.set(item.id, 0));
    drinkCursor = page.cursor; $('more-drinks').hidden = !page.more; renderDrinks();
  } catch (error) { status('booking-status', errorMessage(error), true); }
  finally { $('more-drinks').disabled = false; }
});
void boot();
