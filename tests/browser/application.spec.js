import { test, expect } from '@playwright/test';
import { seedCatalog, seedAdmin } from '../../scripts/seed-emulators.js';

test.beforeEach(async ({ request }) => {
  await request.delete('http://127.0.0.1:8080/emulator/v1/projects/demo-coffepoint/databases/(default)/documents');
  await request.delete('http://127.0.0.1:9099/emulator/v1/projects/demo-coffepoint/accounts');
  await seedCatalog(); await seedAdmin();
});
async function login(page, email, password, register = false) {
  await page.goto('/auth.html');
  await page.locator('#email').fill(email); await page.locator('#password').fill(password);
  if (register) await page.locator('#auth-name').fill('Тестовый Пользователь');
  await page.locator(register ? '#email-register' : '#email-login').click();
  await expect(page).toHaveURL(/profile.html/);
  await expect(page.locator('#profile-content')).toBeVisible();
}
test('catalog pagination, filters, search and cafe detail', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.restaurant-card')).toHaveCount(6);
  await page.locator('#catalog-more').click(); await expect(page.locator('.restaurant-card')).toHaveCount(7);
  await page.locator('#catalog-search').fill('Coffepoint 07');
  await page.locator('#catalog-sort').selectOption('rating');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.locator('.restaurant-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Подробнее', exact: true }).click();
  await expect(page.locator('#cafe-name')).toHaveText('Coffepoint 07');
  await expect(page.locator('#cafe-drinks p')).toHaveCount(6);
  await page.locator('#cafe-book').click();
  await expect(page.locator('input[name="cafe"]:checked')).toHaveValue('abylai-147');
  expect(errors).toEqual([]);
});
test('email registration, persistent profile, access guard and review CRUD', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'guest@coffepoint.test', 'TestPass123!', true);
  await page.locator('#profile-name').fill('Новое Имя'); await page.locator('#save-profile').click();
  await expect(page.locator('#page-status')).toContainText('Изменения сохранены');
  await page.reload(); await expect(page.locator('#profile-name')).toHaveValue('Новое Имя');
  await expect(page.locator('#admin-link')).toBeHidden();
  await page.goto('/admin.html'); await expect(page).toHaveURL(/profile.html/);
  await page.goto('/cafe.html?id=kabanbay-33');
  await expect(page.locator('#review-form')).toBeVisible();
  await page.locator('#review-text').fill('<img src=x onerror=alert(1)> Хороший кофе');
  await page.locator('#save-review').click();
  await expect(page.locator('#reviews article')).toHaveCount(1);
  await expect(page.locator('#reviews')).toContainText('<img src=x');
  await expect(page.locator('#reviews img')).toHaveCount(0);
  await page.locator('#review-rating').selectOption('4');
  await page.locator('#review-text').fill('Обновлённый отзыв'); await page.locator('#save-review').click();
  await expect(page.locator('#reviews')).toContainText('Обновлённый отзыв');
  await expect(page.locator('#review-average')).toContainText('4.0');
  await page.locator('#delete-review').click(); await expect(page.locator('#reviews article')).toHaveCount(0);
  await page.goto('/profile.html'); await page.locator('#logout').click(); await expect(page).toHaveURL(/auth.html/);
  await page.locator('#email').fill('guest@coffepoint.test'); await page.locator('#reset-password').click();
  await expect(page.locator('#page-status')).toContainText('письмо');
  await page.goto('/profile.html'); await expect(page).toHaveURL(/auth.html/);
  expect(errors).toEqual([]);
});
test('admin CRUD, roles, pagination and statistics', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'ordinary@coffepoint.test', 'TestPass123!', true);
  await page.locator('#logout').click();
  await login(page, 'admin@coffepoint.test', 'DemoCoffee123!');
  await page.locator('#admin-link').click();
  await expect(page.locator('#admin-list article')).toHaveCount(7);
  await expect(page.locator('#statistics')).toContainText('Кофейни: 7');
  await page.locator('#new-record').click();
  await page.locator('[name="name"]').fill('Новая кофейня');
  await page.locator('[name="address"]').fill('Новый адрес, 1');
  await page.locator('#save-record').click();
  await expect(page.locator('#admin-list article')).toHaveCount(8);
  const cafe = page.locator('#admin-list article').filter({ hasText: 'Новая кофейня' });
  await cafe.getByRole('button', { name: 'Изменить' }).click();
  await page.locator('[name="name"]').fill('Изменённая кофейня'); await page.locator('#save-record').click();
  await expect(page.locator('#admin-list')).toContainText('Изменённая кофейня');
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#admin-list article').filter({ hasText: 'Изменённая кофейня' }).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('#admin-list article')).toHaveCount(7);
  await page.locator('[data-section="drinks"]').click(); await page.locator('#new-record').click();
  await page.locator('[name="name"]').fill('Раф'); await page.locator('[name="size"]').fill('300 мл'); await page.locator('[name="price"]').fill('1800');
  await page.locator('#save-record').click(); await expect(page.locator('#admin-list')).toContainText('Раф');
  await page.locator('[data-section="users"]').click();
  await expect(page.locator('#admin-list article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Сделать администратором', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сделать пользователем', exact: true })).toBeVisible();
  await page.locator('[data-section="reservations"]').click();
  await expect(page.locator('#page-status')).toContainText('Записей пока нет');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('phone verification links to existing email identity when booking', async ({ page, request }) => {
  await login(page, 'linked@coffepoint.test', 'TestPass123!', true);
  await page.goto('/booking.html');
  await expect(page.locator('.cafe-option')).toHaveCount(7);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
  await page.locator('#visit-date').fill(tomorrow); await page.locator('#visit-date').dispatchEvent('change');
  await expect(page.locator('#availability-message')).toContainText('автоматически');
  await page.locator('.table-choice').first().click();
  await page.locator('#full-name').fill('Тестовый Пользователь');
  const phone = '+16505557777';
  await page.locator('#phone').fill(phone); await page.locator('#consent').check(); await page.locator('#send-code').click();
  await expect(page.locator('#otp-panel')).toBeVisible();
  const codes = await request.get('http://127.0.0.1:9099/emulator/v1/projects/demo-coffepoint/verificationCodes');
  const code = (await codes.json()).verificationCodes.find((item) => item.phoneNumber === phone).code;
  await page.locator('#sms-code').fill(code); await page.locator('#verify-code').click();
  await expect(page.locator('#verified-badge')).toBeVisible();
  await page.locator('#submit-booking').click(); await expect(page.locator('#booking-success')).toBeVisible();
  await page.goto('/profile.html');
  await expect(page.locator('#profile-details')).toContainText('linked@coffepoint.test');
  await expect(page.locator('#profile-details')).toContainText(phone);
  await expect(page.locator('#active-bookings article')).toHaveCount(1);
});
