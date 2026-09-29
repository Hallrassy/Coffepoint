import { BookingError } from './validation.js';

const messages = {
  'auth/invalid-credential': 'Неверный email или пароль.',
  'auth/user-not-found': 'Неверный email или пароль.',
  'auth/wrong-password': 'Неверный email или пароль.',
  'auth/invalid-email': 'Проверьте адрес электронной почты.',
  'auth/email-already-in-use': 'Этот email уже принадлежит другому аккаунту. Войдите по нему или используйте другой адрес. Автоматическое объединение аккаунтов не выполняется.',
  'auth/weak-password': 'Пароль должен содержать минимум 6 символов.',
  'auth/credential-already-in-use': 'Эти данные уже привязаны к другому аккаунту. Войдите в него; автоматически объединить аккаунты нельзя.',
  'auth/requires-recent-login': 'Для этого действия войдите в аккаунт ещё раз.',

  'auth/invalid-phone-number': 'Проверьте телефон, включая код страны: например, +7 700 123 45 67.',
  'auth/invalid-verification-code': 'Неверный код. Проверьте цифры и попробуйте ещё раз.',
  'auth/code-expired': 'Код истёк. Запросите новый.',
  'auth/session-expired': 'Код истёк. Запросите новый.',
  'auth/too-many-requests': 'Слишком много попыток. Подождите немного перед повтором.',
  'auth/quota-exceeded': 'Отправка кодов временно недоступна. Попробуйте позже.',
  'auth/network-request-failed': 'Нет связи с сервисом подтверждения. Проверьте интернет.',
  'auth/captcha-check-failed': 'Не удалось проверить reCAPTCHA. Повторите запрос кода.',
  'auth/unauthorized-domain': 'На этом адресе подтверждение телефона недоступно.',
  'auth/operation-not-allowed': 'Этот способ входа выключен в Firebase. Проверьте Email/Password или Phone в Authentication → Sign-in method.',
  'auth/invalid-app-credential': 'Не удалось подтвердить приложение. Повторите запрос или обновите страницу.',
  'permission-denied': 'Сохранение или чтение недоступно. Проверьте подключение и настройки доступа проекта.',
  'unavailable': 'Нет связи с базой данных. Проверьте интернет и повторите попытку.',
  'failed-precondition': 'Сервис бронирования ещё настраивается. Попробуйте позже.',
};

export function errorMessage(error) {
  if (error instanceof BookingError) return error.message;
  return messages[error?.code] ?? 'Не удалось выполнить действие. Попробуйте ещё раз или обновите страницу.';
}
