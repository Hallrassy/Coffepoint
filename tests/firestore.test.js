import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, writeBatch, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, startAfter, runTransaction, Timestamp, serverTimestamp } from 'firebase/firestore';
import { cafes, drinks, localDate, slotId } from '../src/booking/catalog.js';
import { sampleData } from '../scripts/sample-data.js';
import { validateBooking } from '../src/booking/validation.js';

let env;
const phone = '+16505553434';
const user = (uid = 'guest') => env.authenticatedContext(uid, { phone_number: phone, firebase: { sign_in_provider: 'phone' } }).firestore();
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-coffepoint',
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(); const batch = writeBatch(db);
    sampleData(Timestamp.now()).forEach((item) => batch.set(doc(db, item.collection, item.id), item.data));
    batch.set(doc(db, 'users', 'admin'), { uid: 'admin', name: 'Admin', email: '', phone, role: 'admin', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await batch.commit();
  });
});
after(async () => env?.cleanup());

function fixture(uid = 'guest', overrides = {}) {
  const id = randomUUID();
  const booking = validateBooking({ requestId: id, cafeId: 'kabanbay-33',
    date: localDate(new Date(Date.now() + 86400000)), time: '09:00', tableId: 't1', guests: 2,
    fullName: 'Тестовый Гость', phone, consent: true, drinks: [{ id: 'latte', quantity: 2 }], ...overrides });
  const key = slotId(booking.cafeId, booking.tableId, booking.startsAt);
  const record = { ...booking, userId: uid, status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    startsAt: Timestamp.fromDate(booking.startsAt), slotId: key };
  const slot = { cafeId: booking.cafeId, tableId: booking.tableId, startsAt: record.startsAt, reservationId: id };
  return { id, key, record, slot };
}
function save(db, value) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'reservations', value.id), value.record);
  batch.set(doc(db, 'slots', value.key), value.slot);
  return batch.commit();
}

test('atomic reservation works; private contacts only readable by owner', async () => {
  const data = fixture();
  await assertSucceeds(save(user(), data));
  const own = await assertSucceeds(getDoc(doc(user(), 'reservations', data.id)));
  assert.equal(own.data().phone, phone);
  await assertFails(getDoc(doc(user('stranger'), 'reservations', data.id)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'reservations', data.id)));
  await assertFails(getDocs(collection(user(), 'reservations')));
  const publicSlot = await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'slots', data.key)));
  assert.deepEqual(Object.keys(publicSlot.data()).sort(), ['cafeId', 'reservationId', 'startsAt', 'tableId']);
});
test('allows a bounded public availability query; disallows unbounded scan', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(query(collection(db, 'slots'), limit(6))));
  await assertFails(getDocs(collection(db, 'slots')));
});
test('rejects unauthenticated and anonymous writes', async () => {
  await assertFails(save(env.unauthenticatedContext().firestore(), fixture()));
  const anonymous = env.authenticatedContext('guest', { phone_number: phone, firebase: { sign_in_provider: 'anonymous' } }).firestore();
  await assertFails(save(anonymous, fixture()));
});
test('requires reservation and slot in same atomic operation', async () => {
  const data = fixture();
  await assertFails(setDoc(doc(user(), 'reservations', data.id), data.record));
  await assertFails(setDoc(doc(user(), 'slots', data.key), data.slot));
});
test('prevents overwriting and deleting existing reservations and slots', async () => {
  const data = fixture(); await save(user(), data);
  await assertFails(updateDoc(doc(user(), 'reservations', data.id), { status: 'confirmed' }));
  await assertFails(deleteDoc(doc(user(), 'reservations', data.id)));
  await assertFails(deleteDoc(doc(user(), 'slots', data.key)));
  await assertFails(save(user('other'), fixture('other')));
});
for (const [label, change] of [
  ['another UID', { userId: 'other' }], ['unverified phone', { phone: '+16505559999' }],
  ['changed price', { drinksTotal: 1 }], ['wrong cafe', { cafeId: 'fake' }],
  ['wrong address', { address: 'fake' }], ['wrong table', { tableId: 't9' }],
  ['overcapacity', { guests: 3 }], ['noninteger guests', { guests: 1.5 }],
  ['missing consent', { consent: false }], ['confirmed status', { status: 'confirmed' }],
  ['extra field', { admin: true }], ['overlong name', { fullName: 'a'.repeat(121) }],
  ['fake creation timestamp', { createdAt: Timestamp.fromMillis(0) }],
  ['past slot', { startsAt: Timestamp.fromMillis(0) }],
  ['beyond horizon', { startsAt: Timestamp.fromMillis(Date.now() + 35 * 86400000) }],
  ['duration override', { durationMinutes: 60 }], ['currency override', { currency: 'USD' }],
  ['alternate lock ID', { slotId: 'fake-lock' }],
]) test(`rules reject ${label}`, async () => {
  const data = fixture(); Object.assign(data.record, change);
  await assertFails(save(user(), data));
});
test('rules reject altered quantities, unknown drinks, and totals', async () => {
  for (const changes of [{ latte: -1 }, { latte: 1.5 }, { latte: 11 }, { freeCoffee: 1 }, { latte: 10, tea: 10, cocoa: 1 }]) {
    const data = fixture(); Object.assign(data.record.drinks, changes);
    await assertFails(save(user(), data));
  }
});
test('all configured cafes, tables, drinks and prices agree with server rules', async () => {
  for (let index = 0; index < cafes.length; index++) {
    const cafe = cafes[index]; const table = cafe.tables[index % cafe.tables.length];
    const data = fixture('guest', { cafeId: cafe.id, tableId: table.id, guests: table.seats,
      drinks: drinks.map((drink) => ({ id: drink.id, quantity: 1 })) });
    await assertSucceeds(save(user(), data));
  }
});
test('two concurrent clients cannot reserve one table twice', async () => {
  const reserve = async (uid) => {
    const db = user(uid); const data = fixture(uid);
    return runTransaction(db, async (transaction) => {
      const slot = doc(db, 'slots', data.key);
      if ((await transaction.get(slot)).exists()) throw new Error('occupied');
      transaction.set(doc(db, 'reservations', data.id), data.record);
      transaction.set(slot, data.slot);
    });
  };
  const results = await Promise.allSettled([reserve('one'), reserve('two')]);
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
  await env.withSecurityRulesDisabled(async (context) => {
    assert.equal((await getDocs(collection(context.firestore(), 'reservations'))).size, 1);
  });
});

test('owner queries only own bookings; admin can list all', async () => {
  await save(user('one'), fixture('one'));
  await save(user('two'), fixture('two', { tableId: 't2' }));
  const own = await assertSucceeds(getDocs(query(collection(user('one'), 'reservations'), where('userId', '==', 'one'), where('status', 'in', ['pending', 'confirmed']), orderBy('createdAt', 'desc'), limit(10))));
  assert.equal(own.size, 1); assert.equal(own.docs[0].data().userId, 'one');
  await assertFails(getDocs(query(collection(user('one'), 'reservations'), where('userId', '==', 'two'), limit(10))));
  assert.equal((await assertSucceeds(getDocs(query(collection(user('admin'), 'reservations'), limit(10))))).size, 2);
});
test('profile creation cannot grant admin; users cannot change their roles or read other profiles', async () => {
  const db = user();
  const profile = { uid: 'guest', name: 'Тест', email: '', phone, role: 'user', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(setDoc(doc(db, 'users', 'guest'), { ...profile, role: 'admin' }));
  await assertSucceeds(setDoc(doc(db, 'users', 'guest'), profile));
  await assertFails(updateDoc(doc(db, 'users', 'guest'), { role: 'admin', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'users', 'guest'), { phone: '+16505559999', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'users', 'guest'), { name: 'Новое имя', updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(user('other'), 'users', 'guest')));
  await assertSucceeds(updateDoc(doc(user('admin'), 'users', 'guest'), { role: 'admin', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(user('admin'), 'users', 'admin'), { role: 'user', updatedAt: serverTimestamp() }));
});
test('only admins can create, update and delete cafes and drinks', async () => {
  const cafe = sampleData(serverTimestamp())[0].data;
  cafe.name = 'Новая кофейня'; cafe.nameLower = cafe.name.toLowerCase();
  cafe.description = ''; cafe.features = ''; cafe.rating = 0;
  await assertFails(setDoc(doc(user(), 'cafes', 'new-cafe'), cafe));
  await assertSucceeds(setDoc(doc(user('admin'), 'cafes', 'new-cafe'), cafe));
  await assertFails(updateDoc(doc(user(), 'cafes', 'new-cafe'), { active: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(user('admin'), 'cafes', 'new-cafe'), { active: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(user('admin'), 'cafes', 'new-cafe')));
  const drink = { name: 'Раф', size: '300 мл', price: 1800, available: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(setDoc(doc(user(), 'drinks', 'raf'), drink));
  await assertSucceeds(setDoc(doc(user('admin'), 'drinks', 'raf'), drink));
  await assertFails(updateDoc(doc(user('admin'), 'drinks', 'raf'), { price: -1, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(user('admin'), 'drinks', 'raf'), { price: 1900, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(user('admin'), 'drinks', 'raf')));
});
test('review ownership, unique ID, rating validation and admin moderation', async () => {
  const id = 'kabanbay-33_guest';
  const review = { cafeId: 'kabanbay-33', userId: 'guest', userName: 'Гость', rating: 5, text: 'Хороший кофе', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(setDoc(doc(user(), 'reviews', 'random-id'), review));
  await assertFails(setDoc(doc(user(), 'reviews', id), { ...review, rating: 6 }));
  await assertSucceeds(setDoc(doc(user(), 'reviews', id), review));
  await assertFails(updateDoc(doc(user('other'), 'reviews', id), { text: 'Чужой текст', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(user('other'), 'reviews', id)));
  await assertSucceeds(updateDoc(doc(user(), 'reviews', id), { text: 'Очень хороший кофе', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(user('admin'), 'reviews', id), { text: 'Отредактировано админом', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(user('admin'), 'reviews', id)));
  await assertSucceeds(setDoc(doc(user(), 'reviews', id), review));
  await assertSucceeds(deleteDoc(doc(user(), 'reviews', id)));
});
test('cancellation requires atomic lock release and permits a new booking', async () => {
  const data = fixture(); await save(user(), data);
  await assertFails(updateDoc(doc(user(), 'reservations', data.id), { status: 'cancelled', updatedAt: serverTimestamp() }));
  const cancel = (db) => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'reservations', data.id), { status: 'cancelled', updatedAt: serverTimestamp() });
    batch.delete(doc(db, 'slots', data.key)); return batch.commit();
  };
  await assertFails(cancel(user('other')));
  await assertSucceeds(cancel(user()));
  await assertSucceeds(save(user('next'), fixture('next')));
  await assertFails(updateDoc(doc(user('admin'), 'reservations', data.id), { status: 'confirmed', updatedAt: serverTimestamp() }));
});
test('admin confirms but cannot complete before visit end or alter booking price', async () => {
  const data = fixture(); await save(user(), data);
  const ref = doc(user('admin'), 'reservations', data.id);
  await assertFails(updateDoc(doc(user(), 'reservations', data.id), { status: 'completed', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { status: 'confirmed', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { status: 'completed', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { drinksTotal: 0, updatedAt: serverTimestamp() }));
  await env.withSecurityRulesDisabled(async (ctx) => updateDoc(doc(ctx.firestore(), 'reservations', data.id), { startsAt: Timestamp.fromMillis(Date.now() - 3 * 3600000) }));
  await assertSucceeds(updateDoc(ref, { status: 'completed', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { status: 'cancelled', updatedAt: serverTimestamp() }));
});
test('changed server price and unavailable cafes/drinks reject stale orders', async () => {
  const data = fixture();
  await updateDoc(doc(user('admin'), 'drinks', 'latte'), { price: 1600, updatedAt: serverTimestamp() });
  await assertFails(save(user(), data));
  data.record.drinksTotal = 3200;
  await assertSucceeds(save(user(), data));
  await updateDoc(doc(user('admin'), 'drinks', 'latte'), { available: false, updatedAt: serverTimestamp() });
  await assertFails(save(user(), fixture('guest', { tableId: 't2' })));
  await updateDoc(doc(user('admin'), 'cafes', 'kabanbay-33'), { active: false, updatedAt: serverTimestamp() });
  await assertFails(save(user(), fixture('guest', { tableId: 't3', drinks: [] })));
});
test('catalog uses cursors and searchable prefixes', async () => {
  const db = env.unauthenticatedContext().firestore();
  const base = [where('active', '==', true), orderBy('nameLower')];
  const page = await getDocs(query(collection(db, 'cafes'), ...base, limit(6)));
  const next = await getDocs(query(collection(db, 'cafes'), ...base, startAfter(page.docs.at(-1)), limit(6)));
  assert.equal(page.size, 6); assert.equal(next.size, 1);
  const found = await getDocs(query(collection(db, 'cafes'), where('active', '==', true), where('searchKeywords', 'array-contains', 'coffepoint 07'), orderBy('rating', 'desc'), limit(6)));
  assert.equal(found.size, 1); assert.equal(found.docs[0].id, 'abylai-147');
});

test('email is retained without an email claim; only Auth email can replace it', async () => {
  const uid = 'email-guest';
  const emailDb = env.authenticatedContext(uid, { email: 'saved@example.test', phone_number: phone, firebase: { sign_in_provider: 'password' } }).firestore();
  const ref = doc(emailDb, 'users', uid);
  await assertSucceeds(setDoc(ref, { uid, name: 'Email User', email: 'saved@example.test', phone, role: 'user', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const phoneRef = doc(user(uid), 'users', uid);
  await assertSucceeds(updateDoc(phoneRef, { name: 'Новое имя', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(phoneRef, { email: '', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(phoneRef, { email: 'other@example.test', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { email: 'other@example.test', updatedAt: serverTimestamp() }));
  const updatedDb = env.authenticatedContext(uid, { email: 'new@example.test', phone_number: phone, firebase: { sign_in_provider: 'password' } }).firestore();
  await assertSucceeds(updateDoc(doc(updatedDb, 'users', uid), { email: 'new@example.test', updatedAt: serverTimestamp() }));
  assert.equal((await getDoc(ref)).data().email, 'new@example.test');
});
