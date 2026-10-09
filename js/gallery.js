export function initGallery() {
  const dialog = document.querySelector('#lightbox');
  const lightboxImage = document.querySelector('#lightbox-image');
  const caption = document.querySelector('#lightbox-caption');
  const items = [...document.querySelectorAll('.gallery-item')];
  const close = dialog?.querySelector('.lightbox-close');
  const prev = dialog?.querySelector('.lightbox-prev');
  const next = dialog?.querySelector('.lightbox-next');
  if (!dialog || !lightboxImage || !items.length) return;

  let current = 0;
  function show(index) {
    current = (index + items.length) % items.length;
    const button = items[current];
    const img = button.querySelector('img');
    lightboxImage.src = button.dataset.full || img?.src || '';
    lightboxImage.alt = img?.alt || '';
    caption.textContent = button.querySelector('span')?.textContent || '';
  }
  items.forEach((item, index) => item.addEventListener('click', () => {
    show(index);
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }));
  close?.addEventListener('click', () => dialog.close());
  prev?.addEventListener('click', () => show(current - 1));
  next?.addEventListener('click', () => show(current + 1));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => { lightboxImage.src = ''; });
  document.addEventListener('keydown', event => {
    if (!dialog.open) return;
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });
}
