/* =========================================================
   Meet Zoe — outils partagés par toutes les pages
   (connexion à Supabase, affichage, recherche de communes)
   ========================================================= */
// Sécurité : le site refuse d'être affiché à l'intérieur d'une autre page.
if (window.top !== window.self) { window.top.location = window.self.location.href; }

const Zoe = (() => {
  const cfg = window.ZOE_CONFIG || {};
  const configure = Boolean(cfg.url && cfg.cle) && !cfg.url.includes('VOTRE-PROJET');
  const sb = configure ? supabase.createClient(cfg.url, cfg.cle) : null;

  /* ---------- Libellés ---------- */
  const CATEGORIES = {
    esi: 'Étudiant(e) en soins infirmiers',
    eas: 'Élève aide-soignant(e)',
    autre_formation: 'Étudiant(e), autre formation sanitaire ou médico-sociale',
    pro_diplome: 'Professionnel(le) diplômé(e)',
    pro_non_diplome: 'Agent de soins, ASH ou personnel éducatif',
    etablissement: 'Représentant(e) d\'un établissement',
  };
  const VERIFICATIONS = { code: 'Vérifié par un code d\'établissement', justificatif: 'Vérifié sur justificatif', invitation: 'Invité par un membre vérifié', admin: 'Vérifié par l\'équipe Meet Zoe' };
  // Numéro attendu de la base de données (voir version_base() dans supabase/schema.sql).
  const VERSION_BASE = 16;
  const STATUTS = { en_attente: 'En attente', verifie: 'Vérifié', refuse: 'Refusé', suspendu: 'Suspendu' };
  const RESERVATIONS = { contact: 'Discussion', demandee: 'En attente', acceptee: 'Acceptée', refusee: 'Refusée', annulee: 'Annulée' };
  const CONDUCTEUR = { non: 'Non conducteur', en_attente: 'Documents à contrôler', valide: 'Conducteur validé', refuse: 'Conducteur refusé' };
  const IDENTITES = { cni: 'Carte d\'identité', passeport: 'Passeport', titre_sejour: 'Titre de séjour' };
  const TYPES_ETAB = { ifsi: 'IFSI', ifas: 'IFAS', hopital: 'Hôpital', ehpad: 'EHPAD', fam: 'FAM', foyer: 'Foyer de vie', autre: 'Autre' };
  const FORMULES = { etablissement: 'Établissement', institut: 'Institut de formation', reseau: 'Réseau d\'établissements' };
  const ABONNEMENTS = { essai: 'Essai', actif: 'Actif', suspendu: 'Suspendu', termine: 'Terminé' };
  const JOURS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  /* ---------- Affichage sécurisé ----------
     Tout texte venant d'un utilisateur est « échappé » avant d'être affiché,
     pour qu'il ne puisse jamais être interprété comme du code. */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  class Brut { constructor(s) { this.s = s; } toString() { return this.s; } }
  const valeur = (v) => {
    if (v instanceof Brut) return v.s;
    if (Array.isArray(v)) return v.map(valeur).join('');
    if (v === null || v === undefined || v === false) return '';
    return esc(v);
  };
  // html`<p>${texte}</p>` : les valeurs insérées sont échappées automatiquement.
  const html = (morceaux, ...valeurs) =>
    new Brut(morceaux.reduce((acc, m, i) => acc + m + (i < valeurs.length ? valeur(valeurs[i]) : ''), ''));

  const $ = (sel, racine = document) => racine.querySelector(sel);
  const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];

  /* ---------- Dates et heures ---------- */
  const date = (iso) => (iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const dateHeure = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const heure = (t) => (t ? t.slice(0, 5) : '');
  const jours = (liste) => [...liste].sort().map((j) => JOURS[j]).join(', ');
  const aujourdhui = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* ---------- Messages à l'écran ---------- */
  function toast(texte, type = 'ok') {
    let zone = $('#toasts');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'toasts';
      zone.setAttribute('role', 'status');
      zone.setAttribute('aria-live', 'polite');
      document.body.append(zone);
    }
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.textContent = texte;
    zone.append(t);
    setTimeout(() => t.remove(), type === 'err' ? 7000 : 4000);
  }

  // Traduit les erreurs techniques les plus courantes.
  const TRADUCTIONS = [
    [/invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
    [/email not confirmed/i, 'Confirmez d\'abord votre adresse e-mail (lien reçu par e-mail).'],
    [/already registered|already been registered/i, 'Un compte existe déjà avec cette adresse e-mail.'],
    [/password should be at least/i, 'Le mot de passe est trop court.'],
    [/rate limit|too many/i, 'Trop de tentatives. Réessayez dans quelques minutes.'],
    [/failed to fetch|networkerror|load failed/i, 'Connexion impossible. Vérifiez votre accès à Internet.'],
    [/mime type|not supported/i, 'Format de fichier non accepté (PDF, JPG ou PNG).'],
    [/exceeded the maximum allowed size|too large/i, 'Fichier trop volumineux (5 Mo maximum).'],
    [/row-level security|permission denied/i, 'Vous n\'avez pas le droit de faire cette action.'],
    [/should be different from the old password/i, 'Choisissez un mot de passe différent de l\'ancien.'],
    [/for security purposes|only request this after/i, 'Patientez une minute avant de réessayer.'],
    [/known to be weak|easy to guess/i, 'Ce mot de passe est trop facile à deviner. Choisissez-en un autre.'],
  ];
  // Les messages écrits par le site ou par la base sont en français (ils
  // contiennent un accent ou finissent par un point). Tout le reste est une
  // panne technique : on affiche une phrase simple et on la note pour le suivi.
  const ANGLAIS = /\b(the|you|your|please|should|password|is|are|not|cannot|can|must|this|that|for|with|after|error|invalid|failed|unable|only|request)\b/i;
  const estFrancais = (t) => /[àâçéèêëîïôùûœ«»’]/i.test(t) || (/^[A-ZÉÈÀÇ][^{}<>]*[.!?]$/.test(t) && !ANGLAIS.test(t));
  function noterPanne(texte) {
    try {
      if (sb) sb.rpc('signaler_erreur', { p_page: location.pathname.split('/').pop() || 'index.html', p_message: String(texte).slice(0, 500) }).then(() => {}, () => {});
    } catch { /* sans gravité */ }
  }
  function messageErreur(e) {
    const brut = (e && (e.message || e.error_description)) || String(e);
    const trouve = TRADUCTIONS.find(([motif]) => motif.test(brut));
    if (trouve) return trouve[1];
    if (/jwt|session|not authenticated|invalid claim/i.test(brut)) return 'Votre session a expiré. Reconnectez-vous.';
    if (estFrancais(brut)) return brut;
    noterPanne(brut);
    return 'Une erreur est survenue. Réessayez dans un instant ; si le problème continue, écrivez-nous depuis la page Contact.';
  }
  const erreur = (e) => { console.error(e); toast(messageErreur(e), 'err'); };
  window.addEventListener('error', (ev) => noterPanne(`${ev.message} (${(ev.filename || '').split('/').pop()}:${ev.lineno})`));
  window.addEventListener('unhandledrejection', (ev) => noterPanne(`Promesse : ${(ev.reason && ev.reason.message) || ev.reason}`));

  // Lance une requête Supabase et renvoie directement les données.
  async function req(promesse) {
    const { data, error } = await promesse;
    if (error) throw error;
    return data;
  }

  // Empêche les doubles clics pendant qu'une action est en cours.
  async function occupe(bouton, action) {
    if (bouton) bouton.disabled = true;
    try { return await action(); } catch (e) { erreur(e); return undefined; } finally { if (bouton) bouton.disabled = false; }
  }

  /* ---------- Session ---------- */
  function pageNonConfiguree() {
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="alerte alerte--config"><strong>Site non relié à la base de données.</strong> '
      + 'Renseignez l\'adresse et la clé Supabase dans le fichier <code>config.js</code> (voir le guide <code>README.md</code>).</div>');
  }

  // Renvoie le profil du membre connecté, ou redirige vers la connexion.
  async function exigerProfil() {
    if (!sb) { pageNonConfiguree(); return null; }
    const { data: { session }, error: erreurSession } = await sb.auth.getSession();
    // Session à renouveler pendant une coupure de réseau : on ne renvoie pas vers la connexion.
    if (!session && erreurSession && /fetch|network|load failed/i.test(`${erreurSession.name} ${erreurSession.message}`)) { pagePanne(); return null; }
    if (!session) { location.replace('connexion.html'); return null; }
    const { data: profil, error } = await sb.from('profils').select('*').eq('id', session.user.id).maybeSingle();
    if (error) {
      // Panne de réseau ou du service : on ne déconnecte pas, on propose de réessayer.
      const expire = /jwt|401|not authenticated/i.test(`${error.message} ${error.code || ''}`);
      if (expire) { await sb.auth.signOut(); location.replace('connexion.html'); return null; }
      pagePanne();
      return null;
    }
    if (!profil) {
      await sb.auth.signOut();
      location.replace('connexion.html');
      return null;
    }
    return profil;
  }
  function pagePanne() {
    if ($('#panne')) return;
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="alerte alerte--config" id="panne" role="alert"><strong>Connexion impossible pour le moment.</strong> '
      + 'Vérifiez votre accès à Internet, puis réessayez. Vous restez connecté(e). '
      + '<button class="btn btn--primary btn--sm" type="button">Réessayer</button></div>');
    $('#panne button').addEventListener('click', () => location.reload());
  }

  /* ---------- Fichiers privés ----------
     Efface tout le dossier d'un membre dans un espace de stockage, puis
     vérifie qu'il est vraiment vide. Lève une erreur sinon. */
  async function viderDossier(espace, dossier) {
    const lister = async () => {
      const { data, error } = await sb.storage.from(espace).list(String(dossier), { limit: 100 });
      if (error) throw error;
      return (data || []).filter((f) => f.id !== null || f.name).map((f) => `${dossier}/${f.name}`);
    };
    const fichiers = await lister();
    if (!fichiers.length) return 0;
    const { error } = await sb.storage.from(espace).remove(fichiers);
    if (error) throw error;
    if ((await lister()).length) throw new Error('Les fichiers n\'ont pas pu être effacés. Réessayez dans un instant.');
    return fichiers.length;
  }

  /* ---------- Fenêtre de question ----------
     Remplace les fenêtres du navigateur. Renvoie null si la personne annule,
     sinon { choix, texte }.
       options.choix : liste de propositions (facultatif)
       options.zone  : true pour ajouter une zone de texte (options.zoneLabel, options.min)
       options.danger: bouton rouge */
  /*   options.max   : longueur maximale de la zone de texte
       options.verifier : fonction ({ choix, texte }) qui renvoie un message si la réponse ne convient pas */
  function demander({ titre, texte = '', choix = null, zone = false, zoneLabel = 'Précisions', min = 0, max = 1000, valider = 'Confirmer', danger = false, verifier = null }) {
    return new Promise((resoudre) => {
      const f = document.createElement('dialog');
      f.className = 'fil question';
      f.setAttribute('aria-labelledby', 'question-titre');
      f.innerHTML = html`
        <form method="dialog">
          <header><h2 id="question-titre">${titre}</h2></header>
          <div class="question__corps">
            ${texte ? html`<p>${texte}</p>` : ''}
            ${choix ? html`<label>Motif
              <select name="choix">${choix.map((c) => html`<option>${c}</option>`)}</select></label>` : ''}
            ${zone ? html`<label>${zoneLabel}
              <textarea name="zone" rows="3" maxlength="${max}"></textarea></label>` : ''}
            <p class="erreur-champ" role="alert" hidden></p>
            <div class="element__actions">
              <button class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--sm" type="submit" value="ok">${valider}</button>
              <button class="btn btn--ghost btn--sm" type="button" data-annuler>Annuler</button>
            </div>
          </div>
        </form>`;
      document.body.append(f);
      let reponse = null;
      $('[data-annuler]', f).addEventListener('click', () => f.close());
      $('form', f).addEventListener('submit', (e) => {
        const saisi = zone ? $('[name=zone]', f).value.trim() : '';
        const donnee = { choix: choix ? $('[name=choix]', f).value : null, texte: saisi };
        const souci = zone && saisi.length < min ? `Écrivez au moins ${min} caractères.` : (verifier ? verifier(donnee) : '');
        if (souci) {
          e.preventDefault();
          const m = $('.erreur-champ', f);
          m.textContent = souci;
          m.hidden = false;
          return;
        }
        reponse = donnee;
      });
      f.addEventListener('close', () => { f.remove(); resoudre(reponse); });
      f.showModal();
      // Pour une action sans retour possible, la touche Entrée ne doit pas valider par mégarde.
      if (danger && !choix && !zone) $('[data-annuler]', f).focus();
    });
  }

  async function deconnexion() {
    if (sb) await sb.auth.signOut();
    location.href = 'index.html';
  }

  const pageAccueil = (profil) => (
    profil.statut !== 'verifie' ? 'espace.html'
      : profil.role === 'admin' ? 'admin.html'
        : profil.role === 'partenaire' ? 'partenaire.html' : 'espace.html');

  /* ---------- Recherche d'une adresse ou d'une commune ----------
     Utilise le service public d'adresses de l'IGN (data.geopf.fr), gratuit et
     sans compte. S'il ne répond pas, on se rabat sur la liste des communes
     (geo.api.gouv.fr). Seul le texte tapé est envoyé à ces services. */
  async function chercherLieux(q) {
    try {
      const rep = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`);
      if (!rep.ok) throw new Error('service indisponible');
      const { features = [] } = await rep.json();
      return features.filter((f) => f.geometry && f.properties).map((f) => ({
        libelle: f.properties.label,
        detail: f.properties.type === 'municipality' ? 'Commune' : (f.properties.context || ''),
        ville: f.properties.city || f.properties.name || f.properties.label,
        precis: ['housenumber', 'street', 'locality'].includes(f.properties.type),
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      }));
    } catch {
      const rep = await fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,codesPostaux,centre&boost=population&limit=6`);
      return (await rep.json()).filter((c) => c.centre).map((c) => ({
        libelle: c.nom, detail: (c.codesPostaux || [])[0] || 'Commune', ville: c.nom, precis: false,
        lat: c.centre.coordinates[1], lng: c.centre.coordinates[0],
      }));
    }
  }

  function champCommune(input) {
    const liste = document.createElement('ul');
    liste.className = 'suggestions';
    liste.hidden = true;
    input.setAttribute('autocomplete', 'off');
    input.parentElement.classList.add('champ-commune');
    input.after(liste);
    let minuteur;
    let numero = 0;        // numéro de la dernière recherche lancée
    let propositions = [];

    const fermer = () => { liste.hidden = true; };
    const choisir = (lieu) => {
      // On annule toute recherche en cours : sans cela, sa réponse rouvrait la
      // liste juste après le choix et il fallait cliquer une seconde fois.
      clearTimeout(minuteur);
      numero += 1;
      input.value = lieu.libelle;
      input.dataset.lat = lieu.lat;
      input.dataset.lng = lieu.lng;
      input.dataset.ville = lieu.ville;
      input.dataset.precis = lieu.precis ? '1' : '';
      propositions = [];
      fermer();
      input.dispatchEvent(new Event('commune', { bubbles: true }));
    };

    input.addEventListener('input', () => {
      for (const cle of ['lat', 'lng', 'ville', 'precis']) delete input.dataset[cle];
      clearTimeout(minuteur);
      const q = input.value.trim();
      if (q.length < 3) { propositions = []; fermer(); return; }
      minuteur = setTimeout(async () => {
        const moi = numero += 1;
        try {
          const lieux = await chercherLieux(q);
          if (moi !== numero) return;   // une recherche plus récente, ou un choix, a eu lieu entre-temps
          propositions = lieux;
          liste.replaceChildren(...lieux.map((lieu) => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            const nom = document.createElement('span');
            nom.textContent = lieu.libelle;
            const detail = document.createElement('small');
            detail.textContent = lieu.detail;
            b.append(nom, detail);
            // « pointerdown » se produit avant que la case perde le curseur :
            // le choix est pris en compte dès le premier appui, souris ou doigt.
            b.addEventListener('pointerdown', (e) => { e.preventDefault(); choisir(lieu); });
            b.addEventListener('click', () => choisir(lieu));
            li.append(b);
            return li;
          }));
          // La liste s'ouvre juste sous la case, même s'il y a un texte d'aide en dessous.
          liste.style.top = `${input.offsetTop + input.offsetHeight}px`;
          liste.hidden = lieux.length === 0;
        } catch {
          fermer();
          toast('La recherche d\'adresses est momentanément indisponible.', 'err');
        }
      }, 250);
    });

    // Touche Entrée ou sortie de la case sans avoir choisi : on retient la première proposition.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !input.dataset.lat && propositions.length) { e.preventDefault(); choisir(propositions[0]); }
      if (e.key === 'Escape') fermer();
    });
    input.addEventListener('blur', () => setTimeout(() => {
      if (!input.dataset.lat && propositions.length && input.value.trim().length >= 3) choisir(propositions[0]);
      fermer();
    }, 200));
  }

  // Lit le lieu choisi ; signale si rien n'a été retenu dans la liste.
  function lireCommune(input) {
    if (!input.dataset.lat) {
      input.focus();
      throw new Error(`Choisissez une adresse ou une commune dans la liste proposée${input.value ? ` pour « ${input.value} »` : ''}.`);
    }
    return {
      ville: input.dataset.ville || input.value.trim(),
      adresse: input.value.trim(),
      precis: input.dataset.precis === '1',
      lat: Number(input.dataset.lat), lng: Number(input.dataset.lng),
    };
  }

  /* ---------- Onglets ---------- */
  function onglets(conteneur, surChangement) {
    const boutons = $$('[data-onglet]', conteneur);
    const montrer = (nom) => {
      boutons.forEach((b) => b.setAttribute('aria-selected', b.dataset.onglet === nom));
      $$('[data-panneau]').forEach((p) => { p.hidden = p.dataset.panneau !== nom; });
      if (surChangement) surChangement(nom);
    };
    boutons.forEach((b) => b.addEventListener('click', () => montrer(b.dataset.onglet)));
    return montrer;
  }

  // Adresses temporaires (1 heure) des photos de profil, privées par défaut.
  async function photos(chemins) {
    const uniques = [...new Set(chemins.filter(Boolean))];
    if (!uniques.length) return {};
    const { data } = await sb.storage.from('photos').createSignedUrls(uniques, 3600);
    return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }
  // Pastille ronde : la photo si elle existe, sinon les initiales.
  const avatar = (prenom, initiale, url, classe = '') => (url
    ? html`<img class="avatar avatar--photo ${classe}" src="${url}" alt="">`
    : html`<span class="avatar ${classe}">${initiales(prenom, initiale)}</span>`);
  const etoiles = (note, nb) => (nb ? html`<span class="note-etoiles" title="${nb} avis">★ ${String(note).replace('.', ',')} <small>(${nb})</small></span>` : '');

  /* ---------- Liens d'inscription et QR codes ---------- */
  const SITE = (cfg.site || location.origin).replace(/\/$/, '');
  // Lien qui ouvre l'inscription avec le code (ou l'invitation) déjà retenu.
  const lienAcces = (type, code) => `${SITE}/connexion.html?${type}=${encodeURIComponent(code)}#inscription`;
  // Dessine un QR code (bibliothèque locale vendor/qrcode.js).
  function qrSvg(texte) {
    const qr = qrcode(0, 'M');
    qr.addData(texte);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  async function copier(texte, message = 'Copié.') {
    try { await navigator.clipboard.writeText(texte); toast(message); } catch { prompt('Copiez ce texte :', texte); }
  }

  // Fenêtre « Lien et QR code » d'un code d'accès : lien à copier, QR code, affiche à imprimer.
  function partagerCode(code, nomEtablissement) {
    let fenetre = $('#partage');
    if (!fenetre) {
      fenetre = document.createElement('dialog');
      fenetre.id = 'partage';
      fenetre.className = 'fil partage';
      document.body.append(fenetre);
    }
    const lien = lienAcces('code', code);
    const affiche = `affiche.html?code=${encodeURIComponent(code)}&nom=${encodeURIComponent(nomEtablissement || '')}`;
    fenetre.innerHTML = html`
      <header>
        <h2>Lien et QR code</h2>
        <button class="lien" type="button" data-fermer>Fermer</button>
      </header>
      <div class="partage__corps">
        <p>Code d'accès <code>${code}</code>${nomEtablissement ? ` · ${nomEtablissement}` : ''}</p>
        <div class="partage__qr">${new Brut(qrSvg(lien))}</div>
        <p class="aide">Une personne qui scanne ce QR code, ou qui ouvre le lien, arrive sur l'inscription. Son accès est validé automatiquement, sans avoir à taper le code.</p>
        <label>Lien d'inscription
          <input type="text" readonly value="${lien}">
        </label>
        <div class="element__actions">
          <button class="btn btn--primary btn--sm" type="button" data-copier>Copier le lien</button>
          <a class="btn btn--ghost btn--sm" href="${affiche}" target="_blank" rel="noopener">Ouvrir l'affiche à imprimer</a>
        </div>
      </div>`;
    $('[data-fermer]', fenetre).addEventListener('click', () => fenetre.close());
    $('[data-copier]', fenetre).addEventListener('click', () => copier(lien, 'Lien copié.'));
    if (!fenetre.open) fenetre.showModal();
  }

  const initiales = (prenom, initiale) => `${(prenom || '?')[0]}${initiale || ''}`.toUpperCase();

  return {
    sb, configure, codeParEmail: Boolean(cfg.codeParEmail), CATEGORIES, STATUTS, RESERVATIONS, CONDUCTEUR, IDENTITES, TYPES_ETAB, FORMULES, ABONNEMENTS, JOURS,
    esc, html, $, $$, date, dateHeure, heure, jours, aujourdhui,
    toast, erreur, messageErreur, req, occupe,
    exigerProfil, deconnexion, pageAccueil, pageNonConfiguree, pagePanne, viderDossier, demander, VERIFICATIONS, VERSION_BASE,
    champCommune, lireCommune, onglets, initiales, photos, avatar, etoiles,
    SITE, lienAcces, qrSvg, copier, partagerCode,
  };
})();
