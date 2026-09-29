// Только локальный demo-проект. Production-ключи и Admin SDK не используются.
import { sampleData } from './sample-data.js';
const project = 'demo-coffepoint';
const base = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents`;
export function encode(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)])) } };
}
export async function seedCatalog() {
  for (const item of sampleData(new Date())) {
    const response = await fetch(`${base}/${item.collection}/${item.id}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: encode(item.data).mapValue.fields }) });
    if (!response.ok) throw new Error(`Seed failed: ${response.status} ${await response.text()}`);
  }
}
export async function seedAdmin() {
  const signup = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@coffepoint.test', password: 'DemoCoffee123!', returnSecureToken: true }),
  });
  const account = await signup.json();
  if (!signup.ok) {
    if (account.error?.message === 'EMAIL_EXISTS') return;
    throw new Error(`Auth seed failed: ${JSON.stringify(account)}`);
  }
  const response = await fetch(`${base}/users/${account.localId}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: encode({ uid: account.localId, name: 'Администратор', email: 'admin@coffepoint.test', phone: '', role: 'admin', createdAt: new Date(), updatedAt: new Date() }).mapValue.fields }) });
  if (!response.ok) throw new Error(`Profile seed failed: ${response.status}`);
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await seedCatalog(); await seedAdmin();
  console.log('Эмулятор заполнен: 7 кофеен, 6 напитков. Вход: admin@coffepoint.test / DemoCoffee123!');
}
