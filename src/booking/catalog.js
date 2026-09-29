// Общие ограничения бронирования и исходные данные для seed/тестов.
// В приложении каталог и цены загружаются из Firestore; Rules проверяют их по документам.
export const BOOKING = {
  timeZone: 'Asia/Almaty',
  utcOffset: '+05:00',
  durationMinutes: 120,
  daysAhead: 30,
  maxDrinks: 20,
  maxQuantity: 10,
  currency: 'KZT',
  times: ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00'],
};

const tables = [
  { id: 't1', number: 1, seats: 2, label: 'У окна' },
  { id: 't2', number: 2, seats: 2, label: 'У окна' },
  { id: 't3', number: 3, seats: 4, label: 'В центре зала' },
  { id: 't4', number: 4, seats: 4, label: 'В центре зала' },
  { id: 't5', number: 5, seats: 6, label: 'Для компании' },
  { id: 't6', number: 6, seats: 6, label: 'Для компании' },
];

export const cafes = [
  ['kabanbay-33', 'улица Кабанбай батыра, дом 33'],
  ['abay-35-37', 'проспект Абая, дом 35/37'],
  ['panfilov-92', 'улица Панфилова, дом 92'],
  ['kabanbay-96', 'улица Кабанбай батыра, дом 96'],
  ['baiseitova-32', 'улица Байсеитовой, дом 32'],
  ['abay-17', 'проспект Абая, дом 17'],
  ['abylai-147', 'проспект Абылай Хана, дом 147'],
].map(([id, address], index) => ({
  id, address, tables,
  name: `Кофейня ${String(index + 1).padStart(2, '0')}`,
  image: ['/images/hero.jpg', '/images/restaurant-2.jpg', '/images/restaurant-3.jpg'][index % 3],
}));

export const drinks = [
  { id: 'espresso', name: 'Эспрессо', size: '30 мл', price: 800 },
  { id: 'americano', name: 'Американо', size: '250 мл', price: 1000 },
  { id: 'cappuccino', name: 'Капучино', size: '250 мл', price: 1300 },
  { id: 'latte', name: 'Латте', size: '350 мл', price: 1500 },
  { id: 'cocoa', name: 'Какао', size: '250 мл', price: 1400 },
  { id: 'tea', name: 'Чай', size: '400 мл', price: 1100 },
];

export function localDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOOKING.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function dateLimits(now = new Date()) {
  return { min: localDate(now), max: localDate(new Date(now.getTime() + BOOKING.daysAhead * 86400000)) };
}

export function startTime(date, time) {
  return new Date(`${date}T${time}:00${BOOKING.utcOffset}`);
}

export const slotId = (cafeId, tableId, date) => `${cafeId}_${tableId}_${Math.floor(date.getTime() / 1000)}`;
