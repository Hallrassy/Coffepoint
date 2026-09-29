import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, startAfter } from 'firebase/firestore';
import { getFirebaseSession } from '../firebase.js';

export const PAGE_SIZE = 6;
export function searchKeywords(name) {
  const letters = Array.from(name.trim().toLocaleLowerCase('ru'));
  return letters.map((_, index) => letters.slice(0, index + 1).join(''));
}
export const cafeData = (snapshot) => ({ ...snapshot.data(), id: snapshot.id, tables: Object.values(snapshot.data().tables || {}) });

export async function listCafes({ search = '', district = '', sort = 'nameLower', cursor, size = PAGE_SIZE, active = true } = {}) {
  const { db } = await getFirebaseSession();
  const filters = active ? [where('active', '==', true)] : [];
  if (search.trim()) filters.push(where('searchKeywords', 'array-contains', search.trim().toLocaleLowerCase('ru')));
  if (district) filters.push(where('district', '==', district));
  filters.push(orderBy(sort, sort === 'rating' ? 'desc' : 'asc'));
  if (cursor) filters.push(startAfter(cursor));
  const snapshot = await getDocs(query(collection(db, 'cafes'), ...filters, limit(size)));
  return { items: snapshot.docs.map(cafeData), cursor: snapshot.docs.at(-1), more: snapshot.size === size };
}
export async function getCafe(id) {
  if (!id || !/^[a-z0-9-]{1,80}$/.test(id)) return null;
  const { db } = await getFirebaseSession();
  const snapshot = await getDoc(doc(db, 'cafes', id));
  return snapshot.exists() ? cafeData(snapshot) : null;
}
export async function listDrinks(cursor) {
  const { db } = await getFirebaseSession();
  const filters = [where('available', '==', true), orderBy('name')];
  if (cursor) filters.push(startAfter(cursor));
  const snapshot = await getDocs(query(collection(db, 'drinks'), ...filters, limit(20)));
  return { items: snapshot.docs.map((item) => ({ ...item.data(), id: item.id })), cursor: snapshot.docs.at(-1), more: snapshot.size === 20 };
}
