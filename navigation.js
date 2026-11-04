const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('.main-nav');
if (menuToggle && mainNav) {
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Lukk meny' : 'Åpne meny');
    mainNav.classList.toggle('is-open', open);
  });
  mainNav.addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    menuToggle.setAttribute('aria-expanded', 'false');
    mainNav.classList.remove('is-open');
  });
}
