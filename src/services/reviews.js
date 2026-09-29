import { collection, doc, query, where, orderBy, startAfter, limit, getDocs, getDoc, getAggregateFromServer, average, count, runTransaction, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { getFirebaseSession } from '../firebase.js';
import { BookingError } from '../booking/validation.js';
export const reviewId = (cafeId, uid) => `${cafeId}_${uid}`;
export async function listReviews(cafeId, cursor) {
  const { db } = await getFirebaseSession();
  const filters = [where('cafeId', '==', cafeId), orderBy('createdAt', 'desc')];
  if (cursor) filters.push(startAfter(cursor));
  return getDocs(query(collection(db, 'reviews'), ...filters, limit(10)));
}
export async function reviewAverage(cafeId) {
  const { db } = await getFirebaseSession();
  return (await getAggregateFromServer(query(collection(db, 'reviews'), where('cafeId', '==', cafeId)), { rating: average('rating'), total: count() })).data();
}
export async function myReview(cafeId, uid) {
  const { db } = await getFirebaseSession();
  return getDoc(doc(db, 'reviews', reviewId(cafeId, uid)));
}
export async function saveReview(cafeId, user, userName, rating, text) {
  text = text.trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 3 || text.length > 2000) {
    throw new BookingError('review', 'Оценка — от 1 до 5, текст — от 3 до 2000 символов.');
  }
  const { db } = await getFirebaseSession();
  const ref = doc(db, 'reviews', reviewId(cafeId, user.uid));
  await runTransaction(db, async (tx) => {
    const old = await tx.get(ref);
    const value = { cafeId, userId: user.uid, userName: userName || 'Гость', rating, text, updatedAt: serverTimestamp() };
    if (!old.exists()) value.createdAt = serverTimestamp();
    tx.set(ref, value, { merge: true });
  });
}
export async function removeReview(id) {
  const { db } = await getFirebaseSession();
  await deleteDoc(doc(db, 'reviews', id));
}
