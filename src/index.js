import { listCafes } from './services/cafes.js';
import { initAccountNav } from './auth.js';
import { $, el, link, report, message, safeImage } from './ui.js';
let cursor;
let filters;
let version = 0;
async function load(reset = false) {
  const current = ++version;
  if (reset) {
    cursor = undefined; $('restaurant-list').replaceChildren();
    filters = { search: $('catalog-search').value, district: $('catalog-district').value, sort: $('catalog-sort').value };
  }
  $('catalog-more').disabled = true;
  message('Загрузка…');
  try {
    const page = await listCafes({ ...filters, cursor });
    if (current !== version) return;
    page.items.forEach((cafe) => {
      const card = $('restaurant-template').content.cloneNode(true);
      card.querySelector('img').src = safeImage(cafe.image); card.querySelector('img').alt = cafe.name;
      card.querySelector('h3').textContent = cafe.name;
      card.querySelector('.restaurant-description').textContent = cafe.description;
      card.querySelector('.restaurant-address span').textContent = cafe.address;
      card.querySelector('.restaurant-tag').textContent = cafe.features;
      card.querySelector('.restaurant-number').textContent = '☕';
      const body = card.querySelector('article');
      body.append(el('p', `★ ${cafe.rating.toFixed(1)} · ${cafe.district}`, 'catalog-rating'));
      const actions = el('div', undefined, 'actions');
      actions.append(link('Подробнее', `/cafe.html?id=${encodeURIComponent(cafe.id)}`), link('Забронировать', `/booking.html?cafe=${encodeURIComponent(cafe.id)}`));
      body.append(actions); $('restaurant-list').append(card);
    });
    cursor = page.cursor; $('catalog-more').hidden = !page.more;
    message(!$('restaurant-list').children.length ? 'Кофейни не найдены. Измените поиск или фильтр.' : '');
  } catch (error) { if (current === version) report(error); }
  finally { if (current === version) $('catalog-more').disabled = false; }
}
$('catalog-filter').addEventListener('submit', (event) => { event.preventDefault(); void load(true); });
$('catalog-more').addEventListener('click', () => void load());
void initAccountNav().catch(() => {});
void load(true);
