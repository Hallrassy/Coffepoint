import { collection, doc, query, where, orderBy, limit, startAfter, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, getCountFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { sampleData } from '../scripts/sample-data.js';
import { requireUser } from './auth.js';
import { cafes as examples } from './booking/catalog.js';
import { searchKeywords } from './services/cafes.js';
import { changeStatus } from './booking/service.js';
import { $, el, link, button, action, message, report, dateText, money, statuses, safeImage } from './ui.js';
let context, section = 'cafes', cursor, editing;
let generation = 0;
let statusFilter = '';
const sections = {
  cafes: ['Кофейни', 'МЕСТА ДЛЯ ВСТРЕЧ', 'Адреса, атмосфера и доступность бронирования.', '+ Добавить кофейню'],
  drinks: ['Напитки', 'ЛЮБИМОЕ В МЕНЮ', 'Цены, объёмы и доступность напитков для предзаказа.', '+ Добавить напиток'],
  reservations: ['Бронирования', 'ПРЕДСТОЯЩИЕ ВСТРЕЧИ', 'Подтверждайте заявки и следите за визитами гостей.'],
  users: ['Пользователи', 'НАШИ ГОСТИ И КОМАНДА', 'Контакты пользователей и управление доступом.'],
  reviews: ['Отзывы', 'ОБРАТНАЯ СВЯЗЬ', 'Впечатления гостей и модерация отзывов.'],
};
function closeEditor() { $('editor').close(); $('editor').hidden = true; }
function badge(text, tone = '') {
  const node = el('span', text, 'admin-badge'); node.dataset.tone = tone; return node;
}
function details(values) {
  const list = el('dl', undefined, 'admin-record-details');
  values.forEach(([name, value]) => {
    const entry = el('div'); entry.append(el('dt', name), el('dd', value)); list.append(entry);
  });
  return list;
}

const cafeFields = [
  ['name', 'Название', 'text', 80], ['description', 'Описание', 'textarea', 2000], ['address', 'Адрес', 'text', 200],
  ['image', 'Фото: /images/… или https://…', 'text', 1000],
  ['district', 'Район', ['Алмалинский', 'Медеуский', 'Бостандыкский', 'Другой']],
  ['features', 'Особенности', 'text', 200], ['rating', 'Рейтинг каталога (редакционный, 0–5)', 'number'], ['active', 'Принимает бронирования', 'checkbox'],
];
const drinkFields = [['name', 'Название', 'text', 80], ['size', 'Объём', 'text', 40], ['price', 'Цена, ₸', 'number'], ['available', 'Доступен', 'checkbox']];
function openEditor(item) {
  editing = item;
  $('editor-title').textContent = item ? 'Редактирование' : section === 'cafes' ? 'Новая кофейня' : 'Новый напиток';
  $('editor-status').textContent = '';
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
    if (['name', 'description', 'image', 'features'].includes(name)) label.classList.add('field-wide');
    if (type === 'checkbox') label.classList.add('field-check');
    label.append(field); $('edit-fields').append(label);
  }
  if (section === 'cafes') $('edit-fields').append(el('p', 'Часы: 09:00–21:00. Шесть столиков на 2, 2, 4, 4, 6 и 6 гостей.'));
  $('editor').hidden = false; $('editor').showModal();
}
function card(snapshot) {
  const data = { ...snapshot.data(), id: snapshot.id }, item = el('article', undefined, 'admin-record');
  const body = el('div', undefined, 'admin-record-body');
  const heading = el('div', undefined, 'admin-record-heading');
  const actions = el('div', undefined, 'actions');
  const collectionName = section;
  body.append(heading);
  if (section === 'cafes' || section === 'drinks') {
    heading.append(el('h3', data.name));
    const active = section === 'cafes' ? data.active : data.available;
    heading.append(badge(active ? 'Доступно' : 'Недоступно', active ? 'positive' : ''));
    if (section === 'cafes') {
      const image = el('img', undefined, 'admin-record-cover');
      image.src = safeImage(data.image); image.alt = data.name; image.loading = 'lazy';
      item.append(image);
      body.append(el('p', data.address), details([['Район', data.district], ['Рейтинг', `★ ${data.rating.toFixed(1)}`], ['Часы', data.hours]]));
      actions.append(link('Открыть на сайте ↗', `/cafe.html?id=${encodeURIComponent(data.id)}`));
    } else {
      body.append(el('p', data.size), el('p', money(data.price), 'admin-record-price'));
    }
    actions.append(button('Изменить', async () => openEditor(data)));
    const remove = button('Удалить', async () => {
      if (!confirm(`Удалить «${data.name}»? История бронирований сохранится.`)) return;
      await deleteDoc(doc(context.db, collectionName, data.id)); await load(true); message('Запись удалена.'); void statistics();
    });
    remove.classList.add('admin-danger'); actions.append(remove);
  } else if (section === 'reservations') {
    heading.append(el('h3', data.fullName), badge(statuses[data.status], data.status));
    body.append(el('p', data.address), details([['Дата и время', dateText(data.startsAt)], ['Столик / гости', `№ ${data.tableNumber} · ${data.guests} гостей`], ['Телефон', data.phone]]),
      el('p', `Напитки: ${Object.entries(data.drinks).filter(([, n]) => n).map(([id, n]) => `${id} × ${n}`).join(', ') || 'без предзаказа'}`),
      el('p', money(data.drinksTotal), 'admin-record-price'), el('p', `Бронирование ${data.id}`, 'admin-record-id'));
    const next = data.status === 'pending' ? ['confirmed', 'cancelled'] : data.status === 'confirmed' ? ['cancelled', ...(Date.now() >= data.startsAt.toMillis() + 7200000 ? ['completed'] : [])] : [];
    const verbs = { confirmed: 'Подтвердить', cancelled: 'Отменить', completed: 'Завершить' };
    next.forEach((status) => {
      const change = button(verbs[status], async () => {
        await changeStatus(data.id, status); await load(true); message('Статус изменён.'); void statistics();
      });
      if (status === 'cancelled') change.classList.add('admin-danger');
      actions.append(change);
    });
  } else if (section === 'users') {
    const person = el('div', undefined, 'admin-person');
    person.append(el('span', (data.name || data.email || 'Г').slice(0, 1).toUpperCase(), 'admin-avatar'), el('h3', data.name || 'Гость без имени'));
    heading.append(person, badge(data.role === 'admin' ? 'Администратор' : 'Пользователь', data.role === 'admin' ? 'positive' : ''));
    body.append(details([['Email', data.email || 'Не указан'], ['Телефон', data.phone || 'Не указан'], ['Регистрация', dateText(data.createdAt)]]));
    if (data.id !== context.user.uid) actions.append(button(data.role === 'admin' ? 'Сделать пользователем' : 'Сделать администратором', async () => {
      if (!confirm(`Изменить роль пользователя ${data.name || data.email || data.phone}?`)) return;
      await updateDoc(doc(context.db, 'users', data.id), { role: data.role === 'admin' ? 'user' : 'admin', updatedAt: serverTimestamp() });
      await load(true); message('Роль изменена.');
    }));
    else body.append(el('p', 'Это ваш аккаунт. Собственную роль изменять нельзя.'));
  } else {
    heading.append(el('h3', data.userName), badge(`★ ${data.rating} / 5`, 'positive'));
    body.append(el('p', data.text), el('p', dateText(data.createdAt), 'admin-record-id'));
    const remove = button('Удалить отзыв', async () => {
      await deleteDoc(doc(context.db, 'reviews', data.id)); await load(true); message('Отзыв удалён.');
    });
    remove.classList.add('admin-danger');
    actions.append(link('Открыть кофейню ↗', `/cafe.html?id=${encodeURIComponent(data.cafeId)}`), remove);
  }
  if (actions.childElementCount) body.append(actions);
  item.append(body); return item;
}
async function load(reset = false) {
  const version = ++generation;
  if (reset) { cursor = undefined; statusFilter = $('filter-status').value; $('admin-list').replaceChildren(); }
  $('admin-more').disabled = true;
  $('admin-list').setAttribute('aria-busy', 'true');
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
    const count = $('admin-list').querySelectorAll('article').length;
    $('list-count').textContent = count ? `Показано записей: ${count}` : '';
    if (!count) {
      const empty = el('div', undefined, 'admin-empty');
      empty.append(el('span', '✳'), el('h3', 'Здесь пока тихо'), el('p', section === 'reservations' ? 'Бронирования появятся, когда гости выберут столик.' : 'В этом разделе пока нет записей.', 'admin-muted'));
      $('admin-list').append(empty);
    }
    message(!count ? 'Записей пока нет.' : '');
  } catch (error) { if (version === generation) report(error); }
  finally { if (version === generation) { $('admin-more').disabled = false; $('admin-list').setAttribute('aria-busy', 'false'); } }
}
async function statistics() {
  try {
    const db = context.db;
    const queries = [collection(db, 'users'), collection(db, 'cafes'), collection(db, 'reservations'),
      query(collection(db, 'reservations'), where('status', 'in', ['pending', 'confirmed'])), query(collection(db, 'reservations'), where('status', '==', 'completed'))];
    const counts = await Promise.all(queries.map((q) => getCountFromServer(q)));
    $('statistics').replaceChildren(...counts.map((result, i) => {
      const tile = el('div', undefined, 'admin-stat');
      if (i === 3) tile.dataset.highlight = 'true';
      tile.append(el('span', `${['Пользователи', 'Кофейни', 'Бронирования', 'Активные', 'Завершённые'][i]}: `), el('strong', String(result.data().count)));
      return tile;
    }));
  } catch (error) { $('statistics').textContent = 'Статистика временно недоступна.'; report(error); }
}
$('edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action($('save-record'), async () => {
    const data = {};
    for (const field of $('edit-fields').querySelectorAll('input, textarea, select')) {
      data[field.name] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value.trim();
    }
    if (!data.name) { message('Введите название.', true, $('editor-status')); return; }
    if (section === 'cafes') {
      Object.assign(data, { nameLower: data.name.toLocaleLowerCase('ru'), searchKeywords: searchKeywords(data.name), hours: '09:00–21:00',
        tables: editing?.tables || Object.fromEntries(examples[0].tables.map((t) => [t.id, t])) });
    }
    const recordSection = section;
    await setDoc(doc(context.db, recordSection, editing?.id || crypto.randomUUID()), {
      ...data, createdAt: editing?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(),
    });
    closeEditor(); await load(true); message('Изменения сохранены.'); void statistics();
  }, $('editor-status'));
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
$('close-editor').addEventListener('click', closeEditor);
$('editor').addEventListener('close', () => { $('editor').hidden = true; });
$('admin-more').addEventListener('click', () => void load());
$('admin-filters').addEventListener('submit', (event) => { event.preventDefault(); void load(true); });
document.querySelectorAll('[data-section]').forEach((tab) => tab.addEventListener('click', () => {
  section = tab.dataset.section; closeEditor();
  const [title, kicker, description, addLabel] = sections[section];
  $('section-title').textContent = title; $('section-kicker').textContent = kicker;
  $('section-description').textContent = description; $('new-record').textContent = addLabel || '';
  $('admin-list').dataset.view = section;
  document.querySelectorAll('.admin-sections [data-section]').forEach((item) => {
    if (item === tab) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
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
