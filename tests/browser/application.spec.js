import { test, expect } from '@playwright/test';
import { seedCatalog, seedAdmin } from '../../scripts/seed-emulators.js';

test.beforeEach(async ({ request }) => {
  await request.delete('http://127.0.0.1:8080/emulator/v1/projects/demo-coffepoint/databases/(default)/documents');
  await request.delete('http://127.0.0.1:9099/emulator/v1/projects/demo-coffepoint/accounts');
  await seedCatalog(); await seedAdmin();
});
async function login(page, email, password) {
  await page.goto('/auth.html');
  await page.locator('[data-auth-method="email"]').click();
  await page.locator('#email').fill(email); await page.locator('#password').fill(password);
  await page.locator('#email-login').click();
  await expect(page).toHaveURL(/profile.html/);
  await expect(page.locator('#profile-content')).toBeVisible();
}
// Existing email-only accounts remain supported; create this fixture only in the emulator.
async function seedLegacyEmail(request, email) {
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    data: { email, password: 'TestPass123!', returnSecureToken: true },
  });
  expect(response.ok()).toBe(true);
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
test('phone registration, profile email, access guard and review CRUD', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await loginByPhone(page, request, '+16505551234');
  await page.locator('#link-email-address').fill('guest@coffepoint.test');
  await page.locator('#link-email-password').fill('TestPass123!');
  await page.locator('#link-email-submit').click();
  await expect(page.locator('#profile-details')).toContainText('guest@coffepoint.test');
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
  await page.locator('[data-auth-method="email"]').click();
  await page.locator('#email').fill('guest@coffepoint.test'); await page.locator('#reset-password').click();
  await expect(page.locator('#page-status')).toContainText('письмо');
  await page.goto('/profile.html'); await expect(page).toHaveURL(/auth.html/);
  expect(errors).toEqual([]);
});
test('admin CRUD, roles, pagination and statistics', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await loginByPhone(page, request, '+16505551234');
  await page.locator('#logout').click();
  await login(page, 'admin@coffepoint.test', 'DemoCoffee123!');
  await page.locator('#admin-link').click();
  await expect(page.locator('#admin-list article')).toHaveCount(7);
  await expect(page.locator('#statistics')).toContainText('Кофейни: 7');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/coffepoint-admin-${width}.png`, fullPage: true });
  }
  await page.locator('#new-record').click();
  await expect(page.locator('#editor')).toBeVisible();
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
  await seedLegacyEmail(request, 'linked@coffepoint.test');
  await login(page, 'linked@coffepoint.test', 'TestPass123!');
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

test('legacy email survives profile sync, re-login and is visible to admin', async ({ page, request }) => {
  const email = 'saved-email@coffepoint.test';
  await seedLegacyEmail(request, email);
  await login(page, email, 'TestPass123!');
  await expect(page.locator('#profile-details')).toContainText(email);
  const uid = await page.evaluate(async () => (await (await import('/src/firebase.js')).getFirebaseSession()).auth.currentUser.uid);
  const profileUrl = `http://127.0.0.1:8080/v1/projects/demo-coffepoint/databases/(default)/documents/users/${uid}`;
  async function storedEmail() {
    const response = await request.get(profileUrl, { headers: { Authorization: 'Bearer owner' } });
    return (await response.json()).fields.email.stringValue;
  }
  expect(await storedEmail()).toBe(email);
  // A partial Auth user must not erase an already saved email.
  await page.evaluate(async () => {
    const { auth } = await (await import('/src/firebase.js')).getFirebaseSession();
    const { ensureProfile } = await import('/src/auth.js');
    await ensureProfile({ uid: auth.currentUser.uid, email: null, phoneNumber: null, getIdTokenResult: async () => ({ claims: {} }) });
  });
  expect(await storedEmail()).toBe(email);
  await page.reload(); await expect(page.locator('#profile-details')).toContainText(email);
  await page.locator('#logout').click();
  await login(page, email, 'TestPass123!');
  expect(await storedEmail()).toBe(email);
  // Repair a legacy profile with an empty email using the authenticated identity.
  await request.patch(`${profileUrl}?updateMask.fieldPaths=email`, { headers: { Authorization: 'Bearer owner' }, data: { fields: { email: { stringValue: '' } } } });
  await page.reload(); await expect(page.locator('#profile-details')).toContainText(email);
  expect(await storedEmail()).toBe(email);
  await page.locator('#logout').click();
  await login(page, 'admin@coffepoint.test', 'DemoCoffee123!');
  await page.locator('#admin-link').click();
  await expect(page.locator('#admin-content')).toBeVisible();
  await page.locator('[data-section="users"]').click();
  await expect(page.locator('#admin-list')).toContainText(email);
});

async function loginByPhone(page, request, phone) {
  await page.goto('/auth.html');
  await expect(page.locator('#phone-form')).toBeVisible();
  await expect(page.locator('#email-form')).toBeHidden();
  await page.locator('#login-phone').fill(phone);
  await page.locator('#phone-consent').check(); await page.locator('#send-phone').click();
  await expect(page.locator('#code-form')).toBeVisible();
  const response = await request.get('http://127.0.0.1:9099/emulator/v1/projects/demo-coffepoint/verificationCodes', { maxRetries: 2 });
  const code = (await response.json()).verificationCodes.find((entry) => entry.phoneNumber === phone).code;
  await page.locator('#login-code').fill(code); await page.locator('#confirm-phone').click();
  await expect(page).toHaveURL(/profile.html/); await expect(page.locator('#profile-content')).toBeVisible();
}
const currentUid = (page) => page.evaluate(async () => (await (await import('/src/firebase.js')).getFirebaseSession()).auth.currentUser.uid);

test('phone-first account links email in Auth and Firestore, keeps UID and handles collisions', async ({ page, request }) => {
  const phone = '+16505551233';
  await page.goto('/auth.html');
  await expect(page.locator('#phone-form')).toBeVisible();
  await page.locator('[data-auth-method="email"]').click();
  await expect(page.locator('#email-register')).toHaveCount(0);
  await expect(page.locator('#auth-name')).toHaveCount(0);
  // Email login must not create an account for an unknown address.
  await page.locator('#email').fill('new-account@example.test');
  await page.locator('#password').fill('TestPass123!');
  await page.locator('#email-login').click();
  await expect(page.locator('#page-status')).toContainText('Неверный email или пароль');
  expect(await page.evaluate(async () => (await (await import('/src/firebase.js')).getFirebaseSession()).auth.currentUser)).toBeNull();
  await loginByPhone(page, request, phone);
  const uid = await currentUid(page);
  await expect(page.locator('#profile-details')).toContainText('Email: не указан');
  await expect(page.locator('#link-email-panel')).toBeVisible();
  // Another account already owns this email: linking must not switch identities.
  await page.locator('#link-email-address').fill('admin@coffepoint.test');
  await page.locator('#link-email-password').fill('DemoCoffee123!');
  await page.locator('#link-email-submit').click();
  await expect(page.locator('#link-email-status')).toContainText('другому аккаунту');
  expect(await currentUid(page)).toBe(uid);
  // This is only an emulator test; no message is sent to this email address.
  await page.locator('#link-email-address').fill('test@gmail.com');
  await page.locator('#link-email-password').fill('TestPass123!');
  await page.locator('#link-email-submit').click();
  await expect(page.locator('#profile-details')).toContainText('test@gmail.com');
  await expect(page.locator('#link-email-panel')).toBeHidden();
  expect(await currentUid(page)).toBe(uid);
  const profile = await request.get(`http://127.0.0.1:8080/v1/projects/demo-coffepoint/databases/(default)/documents/users/${uid}`, { headers: { Authorization: 'Bearer owner' }, maxRetries: 2 });
  const fields = (await profile.json()).fields;
  expect(fields.email.stringValue).toBe('test@gmail.com'); expect(fields.phone.stringValue).toBe(phone);
  const authEmail = await page.evaluate(async () => {
    const { auth } = await (await import('/src/firebase.js')).getFirebaseSession();
    await auth.currentUser.reload();
    return auth.currentUser.email;
  });
  expect(authEmail).toBe('test@gmail.com');
  await page.reload(); await expect(page.locator('#profile-details')).toContainText('test@gmail.com');
  await page.locator('#logout').click();
  await login(page, 'test@gmail.com', 'TestPass123!'); expect(await currentUid(page)).toBe(uid);
  await page.locator('#logout').click();
  await loginByPhone(page, request, phone); expect(await currentUid(page)).toBe(uid);
  await expect(page.locator('#profile-details')).toContainText('test@gmail.com');
  await page.goto('/auth.html'); await expect(page.locator('#signed-in-panel')).toBeVisible();
  await expect(page.locator('#auth-methods')).toBeHidden();
  // Booking must not silently sign into a new phone account.
  await page.goto('/booking.html'); await expect(page.locator('.cafe-option')).toHaveCount(7);
  await page.locator('#phone').fill('+16505551222'); await page.locator('#consent').check();
  await page.locator('#send-code').click();
  await expect(page.locator('#phone-status')).toContainText('связан с другим телефоном');
  expect(await currentUid(page)).toBe(uid);
});
