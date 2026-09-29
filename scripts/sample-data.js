import { cafes, drinks } from '../src/booking/catalog.js';
export function sampleData(timestamp) {
  const cafeDocs = cafes.map((cafe, index) => {
    const name = `Coffepoint ${String(index + 1).padStart(2, '0')}`;
    const lower = name.toLowerCase();
    return { collection: 'cafes', id: cafe.id, data: {
      name, nameLower: lower, searchKeywords: Array.from(lower, (_, i) => lower.slice(0, i + 1)),
      description: 'Уютная кофейня для встреч с друзьями, работы и любимого кофе.', address: cafe.address,
      image: cafe.image, district: ['Медеуский', 'Бостандыкский', 'Алмалинский'][index % 3],
      features: index % 2 ? 'Wi-Fi · Розетки · Можно с ноутбуком' : 'Wi-Fi · Столики у окна',
      hours: '09:00–21:00', rating: 4 + index / 10, active: true,
      tables: Object.fromEntries(cafe.tables.map((table) => [table.id, table])), createdAt: timestamp, updatedAt: timestamp,
    } };
  });
  return [...cafeDocs, ...drinks.map(({ id, ...drink }) => ({ collection: 'drinks', id, data: { ...drink, available: true, createdAt: timestamp, updatedAt: timestamp } }))];
}
