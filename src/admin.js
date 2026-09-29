import { collection, doc, query, where, orderBy, limit, startAfter, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, getCountFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { sampleData } from '../scripts/sample-data.js';
import { requireUser } from './auth.js';
import { cafes as examples } from './booking/catalog.js';
import { searchKeywords } from './services/cafes.js';
import { changeStatus } from './booking/service.js';
import { $, el, link, button, action, message, report, dateText, money, statuses } from './ui.js';
let context, section = 'cafes', cursor, editing;
let generation = 0;
let statusFilter = '';
const cafeFields = [
  ['name', 'Название', 'text', 80], ['description', 'Описание', 'textarea', 2000], ['address', 'Адрес', 'text', 200],
  ['image', 'Фото: /images/… или https://…', 'text', 1000],
  ['district', 'Район', ['Алмалинский', 'Медеуский', 'Бостандыкский', 'Другой']],
  ['features', 'Особенности', 'text', 200], ['rating', 'Рейтинг каталога (редакционный, 0–5)', 'number'], ['active', 'Принимает бронирования', 'checkbox'],
];
const drinkFields = [['name', 'Название', 'text', 80], ['size', 'Объём', 'text', 40], ['price', 'Цена, ₸', 'number'], ['available', 'Доступен', 'checkbox']];
function openEditor(item) {
  editing = item;
  $('editor-title').textContent = item ? 'Редактирование' : 'Новая запись';
  $('edit-fields').replaceChildren();
  for (const [name, title, type, maxLength] of section === 'cafes' ? cafeFields : drinkFields) {
    const label = el('label', title, 'field');
    const field = el(Array.isArray(type) ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    field.name = name;
    if (Array.isArray(type)) type.forEach((value) => { const option = el('option', value); field.append(option); });
    else if (type !== 'textarea') field.type = type;
    if (maxLength) field.maxLength = maxLength;
    if (type === 'checkbox') field.checked = item?.[name] ?? true;
    else {
      field.value = item?.[name] ?? (name === 'image' ? '/images/hero.jpg' : name === 'rating' || name === 'price' ? '0' : Array.isArray(type) ? type[0] : '');
      field.required = !['features', 'description'].includes(name);
    }
    if (type === 'number') { field.min = '0'; field.max = name === 'rating' ? '5' : '100000'; field.step = name === 'rating' ? '0.1' : '1'; }
    label.append(field); $('edit-fields').append(label);
  }
  if (section === 'cafes') $('edit-fields').append(el('p', 'Часы: 09:00–21:00. Шесть столиков на 2, 2, 4, 4, 6 и 6 гостей.'));
  $('editor').hidden = false; $('editor').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function card(snapshot) {
  const data = { ...snapshot.data(), id: snapshot.id }, item = el('article');
  const actions = el('div', undefined, 'actions');
  if (section === 'cafes' || section === 'drinks') {
    item.append(el('h3', data.name), el('p', section === 'cafes' ? `${data.address}\n${data.active ? 'Открыта для бронирования' : 'Не принимает бронирования'}` : `${data.size} · ${money(data.price)} · ${data.available ? 'Доступен' : 'Недоступен'}`));
    if (section === 'cafes') actions.append(link('Просмотр', `/cafe.html?id=${encodeURIComponent(data.id)}`));
    actions.append(button('Изменить', async () => openEditor(data)), button('Удалить', async () => {
      if (!confirm(`Удалить «${data.name}»? История бронирований сохранится.`)) return;
      await deleteDoc(doc(context.db, section, data.id)); await load(true); message('Запись удалена.'); void statistics();
    }));
  } else if (section === 'reservations') {
    item.append(el('h3', data.address), el('p', `${data.fullName} · ${data.phone}\n${dateText(data.startsAt)} · Столик ${data.tableNumber} · Гостей: ${data.guests}\n${statuses[data.status]} · ${money(data.drinksTotal)}\nНапитки: ${Object.entries(data.drinks).filter(([, n]) => n).map(([id, n]) => `${id} × ${n}`).join(', ') || 'нет'}\nID: ${data.id}`));
    const next = data.status === 'pending' ? ['confirmed', 'cancelled'] : data.status === 'confirmed' ? ['cancelled', ...(Date.now() >= data.startsAt.toMillis() + 7200000 ? ['completed'] : [])] : [];
    const verbs = { confirmed: 'Подтвердить', cancelled: 'Отменить', completed: 'Завершить' };
    next.forEach((status) => actions.append(button(verbs[status], async () => {
      await changeStatus(data.id, status); await load(true); message('Статус изменён.'); void statistics();
    })));
  } else if (section === 'users') {
    item.append(el('h3', data.name || 'Без имени'), el('p', `${data.email || data.phone || data.uid}\nРоль: ${data.role} · Регистрация: ${dateText(data.createdAt)}`));
    if (data.id !== context.user.uid) actions.append(button(data.role === 'admin' ? 'Сделать пользователем' : 'Сделать администратором', async () => {
      if (!confirm(`Изменить роль пользователя ${data.name || data.email || data.phone}?`)) return;
      await updateDoc(doc(context.db, 'users', data.id), { role: data.role === 'admin' ? 'user' : 'admin', updatedAt: serverTimestamp() });
      await load(true); message('Роль изменена.');
    }));
    else item.append(el('p', 'Собственную роль изменять нельзя.'));
  } else {
    item.append(el('h3', `${data.userName} · ${data.rating}/5`), el('p', data.text), el('small', dateText(data.createdAt)));
    actions.append(link('Кофейня', `/cafe.html?id=${encodeURIComponent(data.cafeId)}`), button('Удалить отзыв', async () => {
      await deleteDoc(doc(context.db, 'reviews', data.id)); await load(true); message('Отзыв удалён.');
    }));
  }
  item.append(actions); return item;
}
async function load(reset = false) {
  const version = ++generation;
  if (reset) { cursor = undefined; statusFilter = $('filter-status').value; $('admin-list').replaceChildren(); }
  $('admin-more').disabled = true;
  message('Загрузка…');
  try {
    const filters = [];
    if (section === 'reservations' && statusFilter) filters.push(where('status', '==', statusFilter));
    filters.push(orderBy(section === 'cafes' ? 'nameLower' : section === 'drinks' ? 'name' : 'createdAt', ['cafes', 'drinks'].includes(section) ? 'asc' : 'desc'));
    if (cursor) filters.push(startAfter(cursor));
    const snapshot = await getDocs(query(collection(context.db, section), ...filters, limit(10)));
    if (version !== generation) return;
    snapshot.docs.forEach((item) => $('admin-list').append(card(item)));
    cursor = snapshot.docs.at(-1); $('admin-more').hidden = snapshot.size < 10;
    message(!$('admin-list').children.length ? 'Записей пока нет.' : '');
  } catch (error) { if (version === generation) report(error); }
  finally { if (version === generation) $('admin-more').disabled = false; }
}
async function statistics() {
  try {
    const db = context.db;
    const queries = [collection(db, 'users'), collection(db, 'cafes'), collection(db, 'reservations'),
      query(collection(db, 'reservations'), where('status', 'in', ['pending', 'confirmed'])), query(collection(db, 'reservations'), where('status', '==', 'completed'))];
    const counts = await Promise.all(queries.map((q) => getCountFromServer(q)));
    $('statistics').textContent = counts.map((result, i) => `${['Пользователи', 'Кофейни', 'Бронирования', 'Активные', 'Завершённые'][i]}: ${result.data().count}`).join(' · ');
  } catch (error) { $('statistics').textContent = 'Статистика временно недоступна.'; report(error); }
}
$('edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action($('save-record'), async () => {
    const data = {};
    for (const field of $('edit-fields').querySelectorAll('input, textarea, select')) {
      data[field.name] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value.trim();
    }
    if (!data.name) { message('Введите название.', true); return; }
    if (section === 'cafes') {
      Object.assign(data, { nameLower: data.name.toLocaleLowerCase('ru'), searchKeywords: searchKeywords(data.name), hours: '09:00–21:00',
        tables: editing?.tables || Object.fromEntries(examples[0].tables.map((t) => [t.id, t])) });
    }
    const recordSection = section;
    await setDoc(doc(context.db, recordSection, editing?.id || crypto.randomUUID()), {
      ...data, createdAt: editing?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(),
    });
    $('editor').hidden = true; await load(true); message('Изменения сохранены.'); void statistics();
  });
});
$('seed-catalog').addEventListener('click', () => action($('seed-catalog'), async () => {
  for (const record of sampleData(serverTimestamp())) {
    await runTransaction(context.db, async (tx) => {
      const ref = doc(context.db, record.collection, record.id);
      if (!(await tx.get(ref)).exists()) tx.set(ref, record.data);
    });
  }
  await load(true); message('Демонстрационный каталог добавлен. Существующие записи сохранены.'); void statistics();
}));
$('refresh-admin').addEventListener('click', () => action($('refresh-admin'), () => load(true)));
$('new-record').addEventListener('click', () => openEditor(null));
$('close-editor').addEventListener('click', () => { $('editor').hidden = true; });
$('admin-more').addEventListener('click', () => void load());
$('admin-filters').addEventListener('submit', (event) => { event.preventDefault(); void load(true); });
document.querySelectorAll('[data-section]').forEach((tab) => tab.addEventListener('click', () => {
  section = tab.dataset.section; $('editor').hidden = true;
  $('new-record').hidden = !['cafes', 'drinks'].includes(section); $('admin-filters').hidden = section !== 'reservations';
  void load(true);
}));
void (async () => {
  try {
    context = await requireUser(true); if (!context) return;
    $('admin-content').hidden = false;
    const deny = () => { generation++; $('admin-content').hidden = true; location.replace('/profile.html'); };
    const stopProfile = onSnapshot(doc(context.db, 'users', context.user.uid), (snapshot) => { if (snapshot.data()?.role !== 'admin') deny(); }, deny);
    const stopAuth = onAuthStateChanged(context.auth, (user) => { if (user?.uid !== context.user.uid) deny(); });
    window.addEventListener('pagehide', () => { generation++; stopProfile(); stopAuth(); }, { once: true });
    await Promise.all([load(true), statistics()]);
  } catch (error) { report(error); }
})();
