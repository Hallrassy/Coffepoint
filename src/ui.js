import { errorMessage } from './booking/errors.js';
export const $ = (id) => document.getElementById(id);
export const money = (value) => `${new Intl.NumberFormat('ru-RU').format(value)} ₸`;
export function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function link(text, href) { const a = el('a', text, 'text-link'); a.href = href; return a; }
export function message(text, error = false, target = $('page-status')) {
  target.textContent = text; target.dataset.error = String(error);
}
export function report(error, target) { message(errorMessage(error), true, target); }
export async function action(button, work, target) {
  if (button.disabled) return;
  button.disabled = true;
  try { await work(); } catch (error) { report(error, target); }
  finally { button.disabled = false; }
}
export function button(text, handler) {
  const item = el('button', text, 'button button-small'); item.type = 'button';
  item.addEventListener('click', () => action(item, handler)); return item;
}
export function safeImage(value) {
  return typeof value === 'string' && (/^\/images\/[\w./-]+$/.test(value) || /^https:\/\//.test(value)) ? value : '/images/hero.jpg';
}
export function dateText(value) {
  return value?.toDate ? value.toDate().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }) : 'Только что';
}
export const statuses = { pending: 'Ожидает подтверждения', confirmed: 'Подтверждено', cancelled: 'Отменено', completed: 'Завершено' };
