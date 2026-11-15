/* =========================================================
   Meet Zoe — affiche à imprimer pour un code d'accès
   Adresse : affiche.html?code=ZOE-XXXXXXXX&nom=Nom du groupe
   ========================================================= */
(() => {
  const parametres = new URLSearchParams(location.search);
  const code = (parametres.get('code') || '').trim().toUpperCase().slice(0, 40);
  const nom = (parametres.get('nom') || '').trim().slice(0, 120);
  const site = ((window.ZOE_CONFIG || {}).site || location.origin).replace(/\/$/, '');
  const valide = /^[A-Z0-9-]{6,40}$/.test(code);

  // Sans code valide, le QR code mène simplement à l'inscription.
  const lien = valide ? `${site}/connexion.html?code=${encodeURIComponent(code)}#inscription` : `${site}/connexion.html#inscription`;
  const qr = qrcode(0, 'M');
  qr.addData(lien);
  qr.make();
  document.getElementById('qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });

  document.getElementById('code').textContent = valide ? code : 'remis par votre établissement';
  document.getElementById('nom').textContent = nom;
  document.getElementById('imprimer').addEventListener('click', () => window.print());

  // À l'écran, l'affiche garde ses proportions A4 mais rétrécit pour tenir dans
  // la largeur d'un téléphone. À l'impression, ces réglages ne s'appliquent pas
  // (voir « @media screen » dans la feuille de styles).
  const affiche = document.querySelector('.affiche');
  const marge = 16;
  function ajuster() {
    const echelle = Math.min(1, (document.documentElement.clientWidth - 2 * marge) / affiche.offsetWidth);
    if (echelle < 1) {
      affiche.style.setProperty('--echelle', echelle.toFixed(4));
      affiche.style.setProperty('--affiche-gauche', `${marge}px`);
      affiche.style.setProperty('--affiche-bas', `${Math.round(30 - affiche.offsetHeight * (1 - echelle))}px`);
    } else {
      ['--echelle', '--affiche-gauche', '--affiche-bas'].forEach((nom) => affiche.style.removeProperty(nom));
    }
  }
  ajuster();
  window.addEventListener('resize', ajuster);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajuster);
})();
