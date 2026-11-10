/* =========================================================
   Meet Zoe — outils partagés par toutes les pages
   (connexion à Supabase, affichage, recherche de communes)
   ========================================================= */
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
  ];
  function messageErreur(e) {
    const brut = (e && (e.message || e.error_description)) || String(e);
    const trouve = TRADUCTIONS.find(([motif]) => motif.test(brut));
    return trouve ? trouve[1] : brut;
  }
  const erreur = (e) => { console.error(e); toast(messageErreur(e), 'err'); };

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
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('connexion.html'); return null; }
    const { data: profil, error } = await sb.from('profils').select('*').eq('id', session.user.id).maybeSingle();
    if (error || !profil) {
      await sb.auth.signOut();
      location.replace('connexion.html');
      return null;
    }
    return profil;
  }

  async function deconnexion() {
    if (sb) await sb.auth.signOut();
    location.href = 'index.html';
  }

  const pageAccueil = (profil) => (
    profil.statut !== 'verifie' ? 'espace.html'
      : profil.role === 'admin' ? 'admin.html'
        : profil.role === 'partenaire' ? 'partenaire.html' : 'espace.html');

  /* ---------- Recherche de communes ----------
     Utilise l'API publique geo.api.gouv.fr (service de l'État, gratuit,
     sans compte). Seul le nom tapé est envoyé. La position retenue est
     le centre de la commune, pas une adresse précise. */
  function champCommune(input) {
    const liste = document.createElement('ul');
    liste.className = 'suggestions';
    liste.hidden = true;
    input.setAttribute('autocomplete', 'off');
    input.parentElement.classList.add('champ-commune');
    input.after(liste);
    let minuteur;

    const choisir = (c) => {
      input.value = c.nom;
      input.dataset.lat = c.centre.coordinates[1];
      input.dataset.lng = c.centre.coordinates[0];
      liste.hidden = true;
      input.dispatchEvent(new Event('commune', { bubbles: true }));
    };

    input.addEventListener('input', () => {
      delete input.dataset.lat;
      delete input.dataset.lng;
      clearTimeout(minuteur);
      const q = input.value.trim();
      if (q.length < 2) { liste.hidden = true; return; }
      minuteur = setTimeout(async () => {
        try {
          const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,codesPostaux,centre&boost=population&limit=6`;
          const communes = (await (await fetch(url)).json()).filter((c) => c.centre);
          liste.replaceChildren(...communes.map((c) => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = `${c.nom} (${(c.codesPostaux || [])[0] || ''})`;
            b.addEventListener('click', () => choisir(c));
            li.append(b);
            return li;
          }));
          liste.hidden = communes.length === 0;
        } catch {
          liste.hidden = true;
          toast('La recherche de communes est momentanément indisponible.', 'err');
        }
      }, 250);
    });
    input.addEventListener('blur', () => setTimeout(() => { liste.hidden = true; }, 200));
  }

  // Lit la commune choisie ; signale si l'utilisateur n'a pas cliqué sur une suggestion.
  function lireCommune(input) {
    if (!input.dataset.lat) {
      input.focus();
      throw new Error(`Choisissez « ${input.value || 'la commune'} » dans la liste proposée.`);
    }
    return { ville: input.value.trim(), lat: Number(input.dataset.lat), lng: Number(input.dataset.lng) };
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

  const initiales = (prenom, initiale) => `${(prenom || '?')[0]}${initiale || ''}`.toUpperCase();

  return {
    sb, configure, CATEGORIES, STATUTS, RESERVATIONS, CONDUCTEUR, IDENTITES, TYPES_ETAB, FORMULES, ABONNEMENTS, JOURS,
    esc, html, $, $$, date, dateHeure, heure, jours, aujourdhui,
    toast, erreur, messageErreur, req, occupe,
    exigerProfil, deconnexion, pageAccueil, pageNonConfiguree,
    champCommune, lireCommune, onglets, initiales,
  };
})();
