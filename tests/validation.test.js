import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateBooking, normalizePhone } from '../src/booking/validation.js';
import { localDate, dateLimits, slotId, startTime } from '../src/booking/catalog.js';

const now = new Date('2026-09-20T12:00:00Z');
const valid = () => ({ requestId: randomUUID(), cafeId: 'kabanbay-33', date: '2026-09-21', time: '09:00',
  tableId: 't1', guests: 2, fullName: 'Иванов Иван Иванович', phone: '+1 650-555-3434',
  drinks: [{ id: 'cappuccino', quantity: 2 }], consent: true });

test('normalizes names and phones, calculates total from catalog', () => {
  const value = validateBooking({ ...valid(), fullName: '  Иванов   Иван  ' }, now);
  assert.equal(value.fullName, 'Иванов Иван');
  assert.equal(value.phone, '+16505553434');
  assert.equal(value.drinksTotal, 2600);
  assert.equal(value.drinks.cappuccino, 2);
  assert.equal(value.startsAt.toISOString(), '2026-09-21T04:00:00.000Z');
});
test('Almaty midnight and time slots do not depend on browser timezone', () => {
  assert.equal(localDate(new Date('2026-09-20T20:00:00Z')), '2026-09-21');
  assert.deepEqual(dateLimits(now), { min: '2026-09-20', max: '2026-10-20' });
  assert.equal(slotId('kabanbay-33', 't1', startTime('2026-09-21', '09:00')), 'kabanbay-33_t1_1789963200');
});
test('accepts international test numbers and normalizes local 8 prefix', () => {
  assert.equal(normalizePhone('8 (700) 123-45-67'), '+77001234567');
  assert.equal(normalizePhone('phone:1234567890'), '');
  assert.equal(normalizePhone('+0 6505553434'), '');
});
for (const [label, change] of [
  ['past date', { date: '2026-09-19' }], ['past time', { date: '2026-09-20', time: '15:00' }],
  ['outside horizon', { date: '2026-10-21' }], ['invalid date', { date: '2026-09-31' }],
  ['overlapping arbitrary time', { time: '09:30' }], ['unknown cafe', { cafeId: 'fake' }],
  ['unknown table', { tableId: 't999' }], ['too many guests', { guests: 3 }],
  ['fractional guests', { guests: 1.5 }], ['missing consent', { consent: false }],
  ['HTML in name', { fullName: '<img src=x>' }], ['missing surname', { fullName: 'Иван' }],
  ['unknown drink', { drinks: [{ id: 'fake', quantity: 1 }] }],
  ['negative quantity', { drinks: [{ id: 'tea', quantity: -1 }] }],
  ['fractional quantity', { drinks: [{ id: 'tea', quantity: 1.5 }] }],
  ['duplicate drink', { drinks: [{ id: 'tea', quantity: 1 }, { id: 'tea', quantity: 1 }] }],
  ['tampered price', { drinks: [{ id: 'tea', quantity: 1, price: 1 }] }],
  ['too many drinks', { drinks: [{ id: 'tea', quantity: 10 }, { id: 'latte', quantity: 10 }, { id: 'cocoa', quantity: 1 }] }],
]) test(`rejects ${label}`, () => assert.throws(() => validateBooking({ ...valid(), ...change }, now)));

test('validates a dynamic Firestore catalog and uses current prices', () => {
  const catalog = { cafes: [{ id: 'new-cafe', address: 'Новый адрес', active: true, tables: [{ id: 't1', number: 1, seats: 4 }] }],
    drinks: [{ id: 'raf', name: 'Раф', size: '300 мл', price: 1700, available: true }] };
  const data = { ...valid(), cafeId: 'new-cafe', drinks: [{ id: 'raf', quantity: 2 }] };
  assert.equal(validateBooking(data, now, catalog).drinksTotal, 3400);
  catalog.drinks[0].available = false;
  assert.throws(() => validateBooking(data, now, catalog));
  catalog.drinks[0].available = true; catalog.cafes[0].active = false;
  assert.throws(() => validateBooking(data, now, catalog));
});
