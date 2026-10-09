import { initMenu } from './menu.js';
import { initGallery } from './gallery.js';
import { initBooking } from './booking.js';

const header = document.querySelector('.site-header');
const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#primary-nav');

function updateHeader() {
  header?.classList.toggle('scrolled', window.scrollY > 24);
}
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  nav?.classList.toggle('is-open', open);
  toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
});

nav?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', 'Открыть меню');
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav?.classList.contains('is-open')) {
    nav.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
  }
});

const year = document.querySelector('#current-year');
if (year) year.textContent = String(new Date().getFullYear());

const revealTargets = document.querySelectorAll('.feature, .menu-card, .gallery-item, .events-placeholder, .about-copy, .booking-form, .contact-details');
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  revealTargets.forEach(element => {
    element.classList.add('reveal');
    observer.observe(element);
  });
}

initMenu();
initGallery();
initBooking();
