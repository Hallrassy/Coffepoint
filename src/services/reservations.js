import { collection, query, where, orderBy, limit, startAfter, onSnapshot } from 'firebase/firestore';
import { getFirebaseSession } from '../firebase.js';

// Каждая загруженная страница имеет фиксированную границу. При изменении статуса
// перезапускаем страницы, чтобы перемещение документа не оставляло пропусков.
export async function watchMyBookings(uid, states, cursor, onData, onError) {
  const { db } = await getFirebaseSession();
  const filters = [where('userId', '==', uid), where('status', 'in', states), orderBy('createdAt', 'desc')];
  if (cursor) filters.push(startAfter(cursor));
  return onSnapshot(query(collection(db, 'reservations'), ...filters, limit(10)), (snapshot) => onData(snapshot), onError);
}
