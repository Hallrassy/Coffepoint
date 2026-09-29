import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { requireUser, logout, addEmailToAccount } from './auth.js';
import { watchMyBookings } from './services/reservations.js';
import { changeStatus } from './booking/service.js';
import { $, el, link, button, action, message, report, dateText, money, statuses } from './ui.js';
let context;
const feeds = [];
function renderProfile() {
  const { user, profile } = context;
  const methods = [user.email ? 'по email' : '', user.phoneNumber ? 'по телефону' : ''].filter(Boolean).join(' и ');
  $('profile-details').textContent = `Email: ${profile.email || user.email || 'не указан'}\nТелефон: ${user.phoneNumber || 'не подтверждён'}\nРегистрация: ${dateText(profile.createdAt)}\nВход: ${methods}`;
  $('link-email-panel').hidden = Boolean(user.email);
}
$('link-email-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action($('link-email-submit'), async () => {
    message('Привязываем email…', false, $('link-email-status'));
    const result = await addEmailToAccount($('link-email-address').value, $('link-email-password').value);
    Object.assign(context, result);
    $('link-email-form').reset(); renderProfile();
    message('Email добавлен. Теперь можно входить по email или телефону.');
  }, $('link-email-status'));
});
function bookingCard(snapshot) {
  const item = snapshot.data(); const card = el('article');
  card.append(el('h3', item.address), el('p', `${dateText(item.startsAt)} · 2 часа · Столик ${item.tableNumber} · Гостей: ${item.guests}`),
    el('p', `${statuses[item.status]} · Напитки: ${money(item.drinksTotal)}`),
    el('p', Object.entries(item.drinks).filter(([, n]) => n).map(([id, n]) => `${id} × ${n}`).join(', ') || 'Без предзаказа напитков'));
  const actions = el('div', undefined, 'actions');
  actions.append(link('Кофейня и отзыв', `/cafe.html?id=${encodeURIComponent(item.cafeId)}`));
  if (['pending', 'confirmed'].includes(item.status) && item.startsAt.toMillis() > Date.now()) {
    actions.append(button('Отменить', async () => {
      await changeStatus(snapshot.id, 'cancelled'); message('Бронирование отменено, столик освобождён.');
    }));
  }
  card.append(actions); return card;
}
function feed(prefix, states) {
  let pages = [], stops = [], generation = 0, alive = true;
  const more = $(`${prefix}-more`), container = $(`${prefix}-bookings`);
  const clear = () => { generation++; stops.forEach((stop) => stop()); stops = []; pages = []; };
  async function load(cursor) {
    more.disabled = true;
    if (!pages.length) container.replaceChildren(el('p', 'Загрузка…'));
    const version = generation, index = pages.length;
    pages.push(null);
    try {
      const stop = await watchMyBookings(context.user.uid, states, cursor, (snapshot) => {
        if (!alive || version !== generation) return;
        const previous = pages[index];
        // Удаление из запроса (отмена/завершение) сдвигает курсоры следующих страниц.
        if (previous && previous.docs.map((d) => d.id).join() !== snapshot.docs.map((d) => d.id).join() && pages.length > 1) {
          clear(); void load(); return;
        }
        pages[index] = snapshot;
        const unique = new Map(pages.filter(Boolean).flatMap((page) => page.docs).map((d) => [d.id, d]));
        container.replaceChildren(...[...unique.values()].map(bookingCard));
        if (!unique.size) container.append(el('p', 'Пока нет бронирований.'));
        more.hidden = pages.at(-1)?.size !== 10; more.disabled = false;
      }, (error) => { if (version === generation) { report(error); more.disabled = false; } });
      if (!alive || version !== generation) stop(); else stops.push(stop);
    } catch (error) { report(error); more.disabled = false; }
  }
  more.addEventListener('click', () => void load(pages.at(-1)?.docs.at(-1)));
  void load();
  feeds.push(() => { alive = false; clear(); });
}
$('profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action($('save-profile'), async () => {
    const name = $('profile-name').value.trim();
    if (!name) { message('Введите имя.', true); return; }
    await updateDoc(doc(context.db, 'users', context.user.uid), { name, updatedAt: serverTimestamp() });
    message('Изменения сохранены.');
  });
});
$('logout').addEventListener('click', () => action($('logout'), logout));
void (async () => {
  try {
    context = await requireUser(); if (!context) return;
    const { user, profile, auth } = context;
    $('profile-content').hidden = false; $('profile-name').value = profile.name;
    renderProfile();
    $('admin-link').hidden = profile.role !== 'admin'; message('');
    feed('active', ['pending', 'confirmed']); feed('history', ['completed', 'cancelled']);
    const stop = onAuthStateChanged(auth, (current) => { if (current?.uid !== user.uid) { feeds.forEach((cleanup) => cleanup()); location.replace('/auth.html'); } });
    window.addEventListener('pagehide', () => { stop(); feeds.forEach((cleanup) => cleanup()); }, { once: true });
  } catch (error) { report(error); }
})();
