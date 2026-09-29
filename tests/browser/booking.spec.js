import { test, expect } from '@playwright/test';
import { seedCatalog, seedAdmin } from '../../scripts/seed-emulators.js';

const project = 'demo-coffepoint';
const phone = '+16505553434';
test.beforeEach(async ({ request }) => {
  await request.delete(`http://127.0.0.1:8080/emulator/v1/projects/${project}/databases/(default)/documents`);
  await request.delete(`http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`);
  await seedCatalog(); await seedAdmin();
});

test('phone verification, drinks and actual Firestore save on mobile', async ({ page, request, browser }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/booking.html');
  await expect(page.locator('.cafe-option')).toHaveCount(7);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
  await page.locator('#visit-date').fill(tomorrow);
  await page.locator('#visit-date').dispatchEvent('change');
  await expect(page.locator('#availability-message')).toContainText('автоматически');
  await page.locator('.table-choice').first().click();
  await page.getByRole('button', { name: 'Добавить: Капучино', exact: true }).click();
  await expect(page.locator('#summary-total')).toHaveText('1 300 ₸');
  await page.locator('#full-name').fill('Тестовый Гость');
  await page.locator('#phone').fill(phone);
  await page.locator('#consent').check();
  await expect(page.locator('#submit-booking')).toBeDisabled();
  await page.getByRole('button', { name: 'Получить код', exact: true }).click();
  await expect(page.locator('#otp-panel')).toBeVisible();
  const response = await request.get(`http://127.0.0.1:9099/emulator/v1/projects/${project}/verificationCodes`);
  const { verificationCodes } = await response.json();
  const code = verificationCodes.find((entry) => entry.phoneNumber === phone).code;
  await page.locator('#sms-code').fill('000000' === code ? '111111' : '000000');
  await page.getByRole('button', { name: 'Подтвердить номер', exact: true }).click();
  await expect(page.locator('#phone-status')).toContainText('Неверный код');
  await page.locator('#sms-code').fill(code);
  await page.getByRole('button', { name: 'Подтвердить номер', exact: true }).click();
  await expect(page.locator('#verified-badge')).toBeVisible();
  await page.locator('#phone').fill('+16505559999');
  await expect(page.locator('#submit-booking')).toBeDisabled();
  await page.locator('#phone').fill(phone);
  await expect(page.locator('#submit-booking')).toBeEnabled();
  await page.locator('#submit-booking').click();
  await expect(page.locator('#booking-success')).toBeVisible();
  await expect(page.locator('#success-details')).toContainText('Напитки: 1 300 ₸');
  const saved = await request.get(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/reservations`, {
    headers: { Authorization: 'Bearer owner' },
  });
  const { documents } = await saved.json();
  expect(documents).toHaveLength(1);
  expect(documents[0].fields.phone.stringValue).toBe(phone);
  expect(documents[0].fields.fullName.stringValue).toBe('Тестовый Гость');
  expect(documents[0].fields.drinks.mapValue.fields.cappuccino.integerValue).toBe('1');
  expect(documents[0].fields.status.stringValue).toBe('pending');
  await page.goto('/profile.html');
  await expect(page.locator('#active-bookings')).toContainText('Кабанбай');
  await page.reload();
  await expect(page.locator('#active-bookings article')).toHaveCount(1);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto('http://127.0.0.1:5175/auth.html');
  await admin.locator('#email').fill('admin@coffepoint.test');
  await admin.locator('#password').fill('DemoCoffee123!');
  await admin.locator('#email-login').click();
  await expect(admin).toHaveURL(/profile.html/);
  await admin.goto('http://127.0.0.1:5175/admin.html');
  await expect(admin.locator('#admin-content')).toBeVisible();
  await admin.locator('[data-section="reservations"]').click();
  await expect(admin.locator('#admin-list article')).toHaveCount(1);
  await admin.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.locator('#active-bookings')).toContainText('Подтверждено');
  await adminContext.close();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('#active-bookings')).toContainText('Пока нет');
  await expect(page.locator('#history-bookings')).toContainText('Отменено');
  expect(errors).toEqual([]);
});

test('layouts fit mobile and desktop; party size and drink limits work', async ({ page }) => {
  await page.goto('/booking.html');
  await expect(page.locator('.cafe-option')).toHaveCount(7);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
  await page.locator('#visit-date').fill(tomorrow);
  await page.locator('#visit-date').dispatchEvent('change');
  await expect(page.locator('#availability-message')).toContainText('автоматически');
  await page.locator('#guests').selectOption('6');
  await expect(page.locator('input[name="table"]:disabled')).toHaveCount(4);
  await page.locator('input[name="cafe"][value="abylai-147"]').check();
  await expect(page.locator('#summary-cafe')).toContainText('проспект Абылай Хана, дом 147');
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Добавить: Чай', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Добавить: Чай', exact: true })).toBeDisabled();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/coffepoint-booking-${width}.png`, fullPage: true });
  }
});
