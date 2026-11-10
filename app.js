/* =========================================================
   Meet Zoe — pages publiques : menu mobile et pied de page
   ========================================================= */
// Sécurité : le site refuse d'être affiché à l'intérieur d'une autre page.
if (window.top !== window.self) { window.top.location = window.self.location.href; }

const burger = document.querySelector('.burger');
const menu = document.getElementById('menu');

burger.addEventListener('click', () => {
  const ouvert = menu.classList.toggle('open');
  burger.setAttribute('aria-expanded', ouvert);
});
menu.addEventListener('click', (e) => {
  if (e.target.tagName === 'A') {
    menu.classList.remove('open');
    burger.setAttribute('aria-expanded', false);
  }
});

document.getElementById('annee').textContent = new Date().getFullYear();
