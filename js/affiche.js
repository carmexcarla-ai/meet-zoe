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
})();
