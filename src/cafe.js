import { onAuthStateChanged } from 'firebase/auth';
import { getFirebaseSession } from './firebase.js';
import { initAccountNav, ensureProfile } from './auth.js';
import { getCafe, listDrinks } from './services/cafes.js';
import { listReviews, reviewAverage, myReview, saveReview, removeReview, reviewId } from './services/reviews.js';
import { $, el, action, message, report, money, dateText, safeImage } from './ui.js';
const cafeId = new URLSearchParams(location.search).get('id');
let user, profile, reviewCursor, drinkCursor, cafe;
let reviewGeneration = 0;
async function reviews(reset = false) {
  const generation = ++reviewGeneration;
  if (reset) reviewCursor = undefined;
  $('reviews-more').disabled = true;
  try {
    const [snapshot, stats] = await Promise.all([listReviews(cafeId, reviewCursor), reviewAverage(cafeId)]);
    if (generation !== reviewGeneration) return;
    if (reset) $('reviews').replaceChildren();
    snapshot.docs.forEach((item) => {
      const data = item.data(), card = el('article');
      card.append(el('h3', `${data.userName} · ${data.rating}/5`), el('p', data.text, 'review-text'), el('small', dateText(data.createdAt)));
      $('reviews').append(card);
    });
    if (!$('reviews').children.length) $('reviews').append(el('p', 'Здесь пока нет отзывов.'));
    $('review-average').textContent = stats.total ? `Оценка гостей: ${stats.rating.toFixed(1)} / 5 · Отзывов: ${stats.total}` : 'Оценок пока нет.';
    reviewCursor = snapshot.docs.at(-1); $('reviews-more').hidden = snapshot.size < 10;
  } finally { if (generation === reviewGeneration) $('reviews-more').disabled = false; }
}
async function drinks() {
  const page = await listDrinks(drinkCursor);
  page.items.forEach((item) => $('cafe-drinks').append(el('p', `${item.name} · ${item.size} · ${money(item.price)}`)));
  if (!$('cafe-drinks').children.length) $('cafe-drinks').append(el('p', 'Меню пока пусто.'));
  drinkCursor = page.cursor; $('drinks-more').hidden = !page.more;
}
$('review-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action($('save-review'), async () => {
    if (!user) { message('Сначала войдите в аккаунт.', true); return; }
    $('delete-review').disabled = true;
    try {
      await saveReview(cafeId, user, profile?.name, Number($('review-rating').value), $('review-text').value);
      $('delete-review').hidden = false; await reviews(true); message('Отзыв сохранён.');
    } finally { $('delete-review').disabled = false; }
  });
});
$('delete-review').addEventListener('click', () => action($('delete-review'), async () => {
  $('save-review').disabled = true;
  try {
    await removeReview(reviewId(cafeId, user.uid));
    $('review-form').reset(); $('delete-review').hidden = true;
    await reviews(true); message('Отзыв удалён.');
  } finally { $('save-review').disabled = false; }
}));
$('reviews-more').addEventListener('click', () => action($('reviews-more'), () => reviews()));
$('drinks-more').addEventListener('click', () => action($('drinks-more'), drinks));
void (async () => {
  try {
    cafe = await getCafe(cafeId);
    if (!cafe) { message('Кофейня не найдена.', true); return; }
    document.title = `${cafe.name} — Coffepoint`; $('cafe-content').hidden = false;
    $('cafe-name').textContent = cafe.name; $('cafe-description').textContent = cafe.description;
    $('cafe-address').textContent = cafe.address; $('cafe-meta').textContent = `${cafe.hours} · ${cafe.district}\n${cafe.features}\nРейтинг каталога: ${cafe.rating.toFixed(1)}`;
    $('cafe-image').src = safeImage(cafe.image); $('cafe-image').alt = cafe.name;
    $('cafe-book').href = `/booking.html?cafe=${encodeURIComponent(cafeId)}`; $('cafe-book').hidden = !cafe.active;
    $('cafe-tables').textContent = cafe.tables.map((t) => `№ ${t.number} · ${t.seats} мест · ${t.label}`).join('\n');
    await Promise.all([reviews(true), drinks()]);
    message(cafe.active ? '' : 'Кофейня временно не принимает бронирования.');
    const { auth } = await getFirebaseSession();
    let authGeneration = 0;
    const stop = onAuthStateChanged(auth, async (current) => {
      const generation = ++authGeneration;
      user = current; $('review-form').hidden = true; $('review-login').hidden = Boolean(user); $('review-form').reset();
      if (!current || !cafe.active) return;
      try {
        const [loadedProfile, own] = await Promise.all([ensureProfile(current), myReview(cafeId, current.uid)]);
        if (generation !== authGeneration) return;
        profile = loadedProfile; $('review-form').hidden = false;
        $('delete-review').hidden = !own.exists();
        if (own.exists()) { $('review-rating').value = String(own.data().rating); $('review-text').value = own.data().text; }
      } catch (error) { report(error); }
    });
    window.addEventListener('pagehide', () => { authGeneration++; stop(); }, { once: true });
  } catch (error) { report(error); }
})();
void initAccountNav().catch(() => {});
