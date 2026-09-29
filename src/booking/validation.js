import { BOOKING, cafes, drinks, dateLimits, startTime } from './catalog.js';

export class BookingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const invalid = (message) => { throw new BookingError('invalid-argument', message); };

export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s()-]{10,25}$/.test(value)) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  // E.164; разрешены и международные вымышленные номера из Firebase Console.
  return /^[1-9]\d{9,14}$/.test(digits) ? `+${digits}` : '';
}

export function validateBooking(data, now = new Date(), catalog = { cafes, drinks }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('Проверьте данные заявки.');
  const allowed = ['requestId', 'cafeId', 'date', 'time', 'tableId', 'guests', 'fullName', 'phone', 'drinks', 'consent'];
  if (Object.keys(data).some((key) => !allowed.includes(key))) invalid('В заявке есть лишние поля.');
  if (typeof data.requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(data.requestId)) invalid('Обновите страницу и повторите отправку.');
  const cafe = catalog.cafes.find((item) => item.id === data.cafeId);
  const table = cafe?.tables.find((item) => item.id === data.tableId);
  if (!cafe || cafe.active === false || !table) invalid('Выберите кофейню и столик.');
  if (!Number.isInteger(data.guests) || data.guests < 1 || data.guests > table.seats) invalid('Выберите столик, который вместит всех гостей.');
  const limits = dateLimits(now);
  if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || data.date < limits.min || data.date > limits.max || !BOOKING.times.includes(data.time)) invalid('Выберите дату в ближайшие 30 дней и время из списка.');
  const startsAt = startTime(data.date, data.time);
  if (!Number.isFinite(startsAt.getTime()) || startsAt.toISOString().slice(0, 10) !== data.date || startsAt <= now) invalid('Это время уже прошло. Выберите другое.');
  const fullName = typeof data.fullName === 'string' ? data.fullName.trim().replace(/\s+/g, ' ') : '';
  if (fullName.length < 3 || fullName.length > 120 || !/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)+$/u.test(fullName)) invalid('Укажите фамилию, имя и отчество, если оно есть.');
  const phone = normalizePhone(data.phone);
  if (!phone) invalid('Укажите телефон в формате +7 700 123 45 67.');
  if (data.consent !== true) invalid('Нужно согласие на использование контактов для этой заявки.');
  if (!Array.isArray(data.drinks) || data.drinks.length > 6) invalid('Проверьте напитки.');
  const seen = new Set();
  const order = data.drinks.map((item) => {
    if (!item || typeof item !== 'object' || Object.keys(item).some((key) => !['id', 'quantity'].includes(key))) invalid('Проверьте состав заказа.');
    const drink = catalog.drinks.find((entry) => entry.id === item.id);
    if (!drink || drink.available === false || !Number.isInteger(drink.price) || drink.price < 0 || drink.price > 100000 || seen.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > BOOKING.maxQuantity) invalid('Проверьте количество напитков.');
    seen.add(item.id);
    return { id: drink.id, name: drink.name, size: drink.size, unitPrice: drink.price, quantity: item.quantity };
  });
  if (order.reduce((sum, item) => sum + item.quantity, 0) > BOOKING.maxDrinks) invalid('Можно предзаказать не больше 20 напитков.');
  return {
    cafeId: cafe.id, address: cafe.address,
    tableId: table.id, tableNumber: table.number, guests: data.guests,
    fullName, phone, drinks: Object.fromEntries(order.map((drink) => [drink.id, drink.quantity])),
    drinksTotal: order.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    currency: BOOKING.currency, consent: true, consentVersion: 'booking-contact-v1',
    startsAt, durationMinutes: BOOKING.durationMinutes,
  };
}
