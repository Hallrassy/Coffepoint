import { collection, doc, query, where, limit, onSnapshot, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getFirebaseSession } from '../firebase.js';
import { slotId } from './catalog.js';
import { BookingError, validateBooking } from './validation.js';
import { ensureProfile } from '../auth.js';

export async function watchAvailability(cafeId, startsAt, onData, onError) {
  const { db } = await getFirebaseSession();
  const selected = query(collection(db, 'slots'), where('cafeId', '==', cafeId),
    where('startsAt', '==', Timestamp.fromDate(startsAt)), limit(6));
  return onSnapshot(selected, { includeMetadataChanges: true }, (snapshot) => {
    onData(new Map(snapshot.docs.map((item) => [item.data().tableId, item.data().reservationId])), !snapshot.metadata.fromCache);
  }, onError);
}

export async function createReservation(data, expectedTotal) {
  const { auth, db } = await getFirebaseSession();
  const user = auth.currentUser;
  if (!user?.phoneNumber || user.phoneNumber !== data.phone) {
    throw new BookingError('phone-not-verified', 'Подтвердите указанный номер телефона.');
  }
  await ensureProfile(user);
  // В транзакции заново читаем актуальные цены, вместимость и доступность.
  return runTransaction(db, async (transaction) => {
    const cafeSnapshot = await transaction.get(doc(db, 'cafes', data.cafeId));
    const drinkSnapshots = await Promise.all(data.drinks.map((item) => transaction.get(doc(db, 'drinks', item.id))));
    const catalog = { cafes: cafeSnapshot.exists() ? [{ ...cafeSnapshot.data(), id: cafeSnapshot.id, tables: Object.values(cafeSnapshot.data().tables) }] : [],
      drinks: drinkSnapshots.filter((item) => item.exists()).map((item) => ({ ...item.data(), id: item.id })) };
    const booking = validateBooking(data, new Date(), catalog);
    if (expectedTotal !== undefined && booking.drinksTotal !== expectedTotal) {
      throw new BookingError('price-changed', 'Цена напитков изменилась. Обновите страницу и проверьте сумму.');
    }
    const key = slotId(booking.cafeId, booking.tableId, booking.startsAt);
    const reservation = doc(db, 'reservations', data.requestId);
    const slot = doc(db, 'slots', key);
    const existing = await transaction.get(slot);
    if (existing.exists()) {
      if (existing.data().reservationId === data.requestId) {
        const saved = await transaction.get(reservation);
        if (saved.exists() && saved.data().userId === user.uid) return { id: saved.id, ...saved.data() };
      }
      throw new BookingError('table-taken', 'Этот столик уже заняли. Выберите другой столик или время.');
    }
    const record = { ...booking, startsAt: Timestamp.fromDate(booking.startsAt),
      userId: user.uid, status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), slotId: key };
    transaction.set(reservation, record);
    transaction.set(slot, { cafeId: booking.cafeId, tableId: booking.tableId,
      startsAt: record.startsAt, reservationId: reservation.id });
    return { id: reservation.id, ...record };
  });
}

export async function changeStatus(id, status) {
  const { db } = await getFirebaseSession();
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'reservations', id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new BookingError('missing', 'Бронирование не найдено.');
    const booking = snapshot.data();
    const allowed = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] };
    if (!allowed[booking.status]?.includes(status)) throw new BookingError('status', 'Статус уже изменился. Обновите список.');
    if (status === 'cancelled') {
      const slot = doc(db, 'slots', booking.slotId);
      const lock = await tx.get(slot);
      if (!lock.exists() || lock.data().reservationId !== id) throw new BookingError('slot', 'Не удалось проверить занятость.');
      tx.delete(slot);
    }
    tx.update(ref, { status, updatedAt: serverTimestamp() });
  });
}
