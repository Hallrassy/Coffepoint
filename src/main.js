import './index.js';
import { content } from './content.js';

document.querySelectorAll('[data-copy]').forEach((element) => {
  const [section, key] = element.dataset.copy.split('.');
  element.textContent = content[section]?.[key] ?? '';
});

document.querySelectorAll('[data-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

// Фоновый цвет сохраняет композицию, если фотография не загрузилась.
document.querySelectorAll('img').forEach((image) => {
  image.addEventListener('error', () => image.classList.add('image-unavailable'), { once: true });
});
