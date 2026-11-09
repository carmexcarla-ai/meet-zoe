/* =========================================================
   Meet Zoe — comportement de la page
   1. Menu mobile
   2. Démo de matching (données fictives)
   3. Formulaire de contact des établissements
   ========================================================= */

/* ---------- 1. Menu mobile ---------- */
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

/* ---------- 2. Démo de matching ---------- */

// Villes de départ, avec une position approximative (km) par rapport à Évreux.
// Sert uniquement à estimer un détour dans la démo.
const VILLES = {
  'Vernon':            { x: 27,  y: 5 },
  'Pacy-sur-Eure':     { x: 16,  y: 1 },
  'Gaillon':           { x: 20,  y: 15 },
  'Louviers':          { x: 3,   y: 22 },
  'Val-de-Reuil':      { x: 6,   y: 27 },
  'Conches-en-Ouche':  { x: -16, y: -6 },
  'Le Neubourg':       { x: -16, y: 14 },
  'Bernay':            { x: -41, y: 7 },
  'Saint-André-de-l\'Eure': { x: 6, y: -14 },
};

const DESTINATIONS = [
  'Centre hospitalier — Évreux',
  'IFSI — Évreux',
  'EHPAD — Vernon',
  'Foyer de vie — Louviers',
  'FAM — Bernay',
];

// Trajets proposés par des conducteurs (fictifs).
const TRAJETS = [
  { nom: 'Camille L.', role: 'Étudiante infirmière, 2e année', depart: 'Vernon', destination: 'Centre hospitalier — Évreux', jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], arrivee: '06:40', places: 2 },
  { nom: 'Thomas R.', role: 'Aide-soignant', depart: 'Pacy-sur-Eure', destination: 'Centre hospitalier — Évreux', jours: ['lun', 'mar', 'jeu', 'sam', 'dim'], arrivee: '06:30', places: 3 },
  { nom: 'Inès B.', role: 'Élève aide-soignante', depart: 'Louviers', destination: 'Centre hospitalier — Évreux', jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], arrivee: '06:35', places: 1 },
  { nom: 'Sophie M.', role: 'Infirmière', depart: 'Gaillon', destination: 'Centre hospitalier — Évreux', jours: ['mer', 'jeu', 'ven', 'sam'], arrivee: '13:15', places: 2 },
  { nom: 'Karim D.', role: 'Étudiant infirmier, 1re année', depart: 'Conches-en-Ouche', destination: 'IFSI — Évreux', jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], arrivee: '08:15', places: 3 },
  { nom: 'Léa P.', role: 'Étudiante infirmière, 3e année', depart: 'Le Neubourg', destination: 'IFSI — Évreux', jours: ['lun', 'mar', 'jeu', 'ven'], arrivee: '08:20', places: 2 },
  { nom: 'Julien F.', role: 'Étudiant infirmier, 2e année', depart: 'Vernon', destination: 'IFSI — Évreux', jours: ['lun', 'mer', 'ven'], arrivee: '08:10', places: 1 },
  { nom: 'Nadia H.', role: 'Agent de service hospitalier', depart: 'Pacy-sur-Eure', destination: 'EHPAD — Vernon', jours: ['lun', 'mar', 'mer', 'sam', 'dim'], arrivee: '06:45', places: 2 },
  { nom: 'Marc T.', role: 'Agent de soins', depart: 'Gaillon', destination: 'EHPAD — Vernon', jours: ['mar', 'mer', 'jeu', 'ven'], arrivee: '07:00', places: 3 },
  { nom: 'Élodie G.', role: 'Éducatrice spécialisée', depart: 'Val-de-Reuil', destination: 'Foyer de vie — Louviers', jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], arrivee: '07:20', places: 2 },
  { nom: 'Hugo V.', role: 'Aide médico-psychologique', depart: 'Gaillon', destination: 'Foyer de vie — Louviers', jours: ['lun', 'jeu', 'ven', 'sam'], arrivee: '06:50', places: 1 },
  { nom: 'Claire N.', role: 'Infirmière', depart: 'Le Neubourg', destination: 'FAM — Bernay', jours: ['lun', 'mar', 'mer', 'jeu'], arrivee: '06:45', places: 2 },
];

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const distanceKm = (a, b) => Math.round(Math.hypot(VILLES[a].x - VILLES[b].x, VILLES[a].y - VILLES[b].y));

/**
 * Calcule un score de compatibilité (0 à 100) entre une recherche et un trajet.
 * Règles de la démo :
 *  - la destination et le jour doivent correspondre, sinon le trajet est écarté ;
 *  - le conducteur doit arriver avant l'heure limite (une arrivée 60 min trop tôt est écartée) ;
 *  - 60 points pour la proximité du lieu de départ, 40 points pour l'horaire.
 */
function scorer(recherche, trajet) {
  if (trajet.destination !== recherche.destination) return null;
  if (!trajet.jours.includes(recherche.jour)) return null;

  const avance = minutes(recherche.heure) - minutes(trajet.arrivee); // > 0 : arrive en avance
  if (avance < 0 || avance > 60) return null;

  const detour = distanceKm(recherche.depart, trajet.depart);
  if (detour > 25) return null;

  const pointsDepart = 60 * (1 - detour / 25);
  const pointsHoraire = 40 * (1 - avance / 60);
  return { score: Math.round(pointsDepart + pointsHoraire), detour, avance };
}

function initiales(nom) {
  return nom.split(' ').map((mot) => mot[0]).join('').replace('.', '');
}

function afficher(recherche) {
  const zone = document.getElementById('resultats');
  const trouves = TRAJETS
    .map((trajet) => ({ trajet, match: scorer(recherche, trajet) }))
    .filter((r) => r.match)
    .sort((a, b) => b.match.score - a.match.score);

  zone.replaceChildren();

  if (trouves.length === 0) {
    const vide = document.createElement('div');
    vide.className = 'empty';
    vide.innerHTML = '<strong>Aucun trajet compatible pour le moment.</strong><p>Sur la plateforme, votre recherche resterait active : vous seriez prévenu(e) dès qu\'un membre propose un trajet correspondant.</p>';
    zone.append(vide);
    return;
  }

  for (const { trajet, match } of trouves) {
    const carte = document.createElement('article');
    carte.className = 'result';

    const depart = match.detour === 0
      ? '<span class="tag tag--ok">Même ville de départ</span>'
      : `<span class="tag">Départ à ${match.detour} km</span>`;
    const horaire = match.avance <= 15
      ? `<span class="tag tag--ok">Arrivée ${trajet.arrivee}</span>`
      : `<span class="tag">Arrivée ${trajet.arrivee} (${match.avance} min d'avance)</span>`;

    carte.innerHTML = `
      <div class="result__score" style="--p:${match.score}">${match.score}%</div>
      <div class="result__main">
        <strong></strong> <span class="badge badge--ok">Vérifié</span>
        <p class="role"></p>
        <p class="trajet"></p>
        <div class="result__tags">${depart}${horaire}</div>
      </div>
      <div class="result__side">
        <span class="seats">${trajet.places} place${trajet.places > 1 ? 's' : ''}</span>
        <a class="btn btn--primary btn--sm" href="connexion.html#inscription">Réserver</a>
      </div>`;
    carte.querySelector('strong').textContent = trajet.nom;
    carte.querySelector('.role').textContent = trajet.role;
    carte.querySelector('.trajet').textContent = `${trajet.depart} → ${trajet.destination}`;
    carte.querySelector('.result__score').setAttribute('aria-label', `Compatibilité ${match.score} %`);
    zone.append(carte);
  }
}

// Remplit les listes déroulantes puis lance une première recherche.
const selDepart = document.getElementById('depart');
const selDestination = document.getElementById('destination');
for (const ville of Object.keys(VILLES)) selDepart.add(new Option(ville, ville));
for (const lieu of DESTINATIONS) selDestination.add(new Option(lieu, lieu));

const formRecherche = document.getElementById('recherche');
const lireRecherche = () => Object.fromEntries(new FormData(formRecherche));

formRecherche.addEventListener('submit', (e) => {
  e.preventDefault();
  afficher(lireRecherche());
});
afficher(lireRecherche());

/* ---------- 3. Contact des établissements ---------- */
const formContact = document.getElementById('contact');
const message = document.getElementById('message');

formContact.addEventListener('submit', async (e) => {
  e.preventDefault();
  message.className = 'form__msg';

  if (!formContact.checkValidity()) {
    message.textContent = 'Merci de compléter les champs avec une adresse e-mail valide.';
    message.classList.add('err');
    formContact.reportValidity();
    return;
  }
  if (!Zoe.sb) {
    message.textContent = 'Le site n\'est pas encore relié à la base de données (voir config.js).';
    message.classList.add('err');
    return;
  }

  const bouton = formContact.querySelector('[type=submit]');
  bouton.disabled = true;
  // La demande est enregistrée ; seule l'administration peut la lire.
  const { error } = await Zoe.sb.from('demandes_contact').insert({
    nom: formContact.nom.value.trim(),
    email: formContact.email.value.trim(),
    organisme: formContact.organisme.value.trim(),
    message: formContact.message.value.trim() || null,
  });
  bouton.disabled = false;

  if (error) {
    message.textContent = Zoe.messageErreur(error);
    message.classList.add('err');
    return;
  }
  message.textContent = 'Merci ! Votre demande est bien enregistrée, nous revenons vers vous rapidement.';
  message.classList.add('ok');
  formContact.reset();
});
