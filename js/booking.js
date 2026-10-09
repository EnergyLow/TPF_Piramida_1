const CONFIG = window.PIRAMIDA_CONFIG || {};
const DEFAULT_ENDPOINT = 'http://localhost:3000/api/bookings';

export function initBooking() {
  const form = document.querySelector('#booking-form');
  const message = document.querySelector('#booking-message');
  const dateInput = document.querySelector('#booking-date');
  if (!form || !message || !dateInput) return;
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  dateInput.min = today;
  function showMessage(text, type = 'info') { message.textContent = text; message.className = `form-message ${type}`; }

  form.addEventListener('submit', async event => {
    event.preventDefault(); showMessage('');
    if (!form.reportValidity()) { showMessage('Проверьте обязательные поля и исправьте отмеченные ошибки.', 'error'); return; }
    const data = new FormData(form), phone = String(data.get('phone') || '').trim(), digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) { showMessage('Проверьте номер телефона: укажите код страны и номер.', 'error'); form.elements.phone.focus(); return; }
    if (dateInput.value < today) { showMessage('Дата посещения не может быть в прошлом.', 'error'); dateInput.focus(); return; }
    if (!data.get('consent')) { showMessage('Для продолжения необходимо согласие на обработку персональных данных.', 'error'); return; }
    const submit = form.querySelector('button[type="submit"]'), originalText = submit.textContent;
    const payload = { name: String(data.get('name') || '').trim(), phone, date: String(data.get('date') || ''), time: String(data.get('time') || ''), guests: String(data.get('guests') || ''), comment: String(data.get('comment') || '').trim(), consent: true };
    submit.disabled = true; submit.setAttribute('aria-busy', 'true'); submit.textContent = 'Отправляем запрос…'; showMessage('Передаём заявку администратору…', 'info');
    try {
      const configured = typeof CONFIG.bookingEndpoint === 'string' && CONFIG.bookingEndpoint.trim();
      const response = await fetch(configured ? CONFIG.bookingEndpoint.trim() : DEFAULT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'Не удалось отправить заявку. Попробуйте ещё раз.');
      showMessage(`${result.message || 'Заявка отправлена! Администратор свяжется с вами для подтверждения бронирования.'}${result.bookingNumber ? ` Номер заявки: #${result.bookingNumber}.` : ''}`, 'success');
      form.reset(); dateInput.min = today;
    } catch (error) {
      showMessage(error instanceof TypeError ? 'Не удалось связаться с сервером бронирования. Проверьте, запущен ли backend, или позвоните: +7 (959) 505-10-25.' : (error.message || 'Не удалось отправить заявку. Позвоните: +7 (959) 505-10-25.'), 'error');
      // При ошибке сохраняем заполненные поля, чтобы посетитель мог повторить попытку.
    } finally { submit.disabled = false; submit.removeAttribute('aria-busy'); submit.textContent = originalText; }
  });
}
