/* =========================================================
   Meet Zoe — espace membre
   1. Vérification du compte
   2. Recherche de trajets (matching)
   3. Proposer un trajet
   4. Mes trajets (conducteur)
   5. Mes réservations (passager)
   6. Messagerie et boîte de réception
   7. Profil, invitations, suppression du compte
   ========================================================= */
(async () => {
  const { sb, $, $$, html, toast, occupe, req } = Zoe;

  let moi = await Zoe.exigerProfil();
  if (!moi) return;

  $('#compte-nom').textContent = `${moi.prenom} ${moi.nom}`;
  $('#deconnexion').addEventListener('click', Zoe.deconnexion);
  if (moi.statut === 'verifie') {
    $('#lien-partenaire').hidden = moi.role !== 'partenaire';
    $('#lien-admin').hidden = moi.role !== 'admin';
  }

  /* ---------- 1. Vérification du compte ---------- */
  if (moi.statut !== 'verifie') {
    $('#verification').hidden = false;
    const etat = $('#etat-verification');
    if (moi.statut === 'suspendu') {
      etat.hidden = false;
      etat.classList.add('alerte--err');
      etat.textContent = 'Votre compte est suspendu. Contactez l\'équipe Meet Zoe pour en savoir plus.';
      $('#methodes').hidden = true;
    } else if (moi.statut === 'refuse') {
      etat.hidden = false;
      etat.classList.add('alerte--err');
      etat.textContent = 'Votre justificatif n\'a pas pu être accepté. Vous pouvez en envoyer un autre, ou utiliser un code.';
    } else if (moi.justificatif_path) {
      etat.hidden = false;
      etat.textContent = 'Votre justificatif a bien été reçu. Il est en cours d\'examen : vous aurez accès à la plateforme dès sa validation.';
    }

    $('#form-code').addEventListener('submit', (e) => {
      e.preventDefault();
      occupe(e.submitter, async () => {
        const reponse = await req(sb.rpc('utiliser_code', { p_code: e.target.code.value }));
        if (!reponse.ok) throw new Error(reponse.message);
        toast(`Bienvenue ! Vous êtes rattaché(e) à ${reponse.etablissement}.`);
        setTimeout(() => location.reload(), 900);
      });
    });

    $('#form-invitation').addEventListener('submit', (e) => {
      e.preventDefault();
      occupe(e.submitter, async () => {
        const reponse = await req(sb.rpc('utiliser_invitation', { p_code: e.target.code.value }));
        if (!reponse.ok) throw new Error(reponse.message);
        toast('Bienvenue dans la communauté !');
        setTimeout(() => location.reload(), 900);
      });
    });

    $('#form-justificatif').addEventListener('submit', (e) => {
      e.preventDefault();
      occupe(e.submitter, async () => {
        const fichier = e.target.fichier.files[0];
        if (!fichier) throw new Error('Choisissez un fichier.');
        if (fichier.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux (5 Mo maximum).');
        const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[fichier.type];
        if (!extension) throw new Error('Format de fichier non accepté (PDF, JPG ou PNG).');

        // Le fichier va dans un dossier privé au nom du membre.
        const chemin = `${moi.id}/${Date.now()}.${extension}`;
        await req(sb.storage.from('justificatifs').upload(chemin, fichier, { contentType: fichier.type }));
        const ancien = moi.justificatif_path;
        await req(sb.rpc('soumettre_justificatif', { p_path: chemin }));
        if (ancien) await sb.storage.from('justificatifs').remove([ancien]);
        toast('Justificatif envoyé. Notre équipe l\'examine.');
        setTimeout(() => location.reload(), 900);
      });
    });
    return;
  }

  /* ---------- Espace vérifié ---------- */
  $('#espace').hidden = false;
  const chargeurs = { trajets: chargerMesTrajets, reservations: chargerMesReservations, messages: chargerConversations, profil: chargerProfil };
  const montrer = Zoe.onglets($('#onglets'), (nom) => chargeurs[nom] && chargeurs[nom]());

  // Fiche d'un membre telle que les autres la voient.
  const membresParId = async (ids) => {
    const uniques = [...new Set(ids)].filter(Boolean);
    if (!uniques.length) return {};
    const liste = await req(sb.from('membres').select('*').in('id', uniques));
    return Object.fromEntries(liste.map((m) => [m.id, m]));
  };
  const nomMembre = (m) => (m ? `${m.prenom} ${m.initiale}.` : 'Membre');
  const badgeReservation = (statut) => html`<span class="badge badge--${statut}">${Zoe.RESERVATIONS[statut]}</span>`;
  const resumeTrajet = (t) => html`
    <strong>${t.depart_ville} → ${t.destination_nom}</strong>
    <p>${t.destination_ville} · ${t.heure_depart ? `départ ${Zoe.heure(t.heure_depart)} · ` : ''}arrivée ${Zoe.heure(t.heure_arrivee)}${t.heure_retour ? ` · retour ${Zoe.heure(t.heure_retour)}` : ''}</p>
    <p>${Zoe.jours(t.jours)} · du ${Zoe.date(t.date_debut)} au ${Zoe.date(t.date_fin)}</p>`;

  /* ---------- Raccourcis des formulaires : jours, horaires, durée ---------- */
  const dansJours = (n, depuis = Zoe.aujourdhui()) => {
    const d = new Date(`${depuis}T12:00:00`);
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('fr-CA');
  };

  // Branche les boutons « Lundi au vendredi », « Matin », « 4 semaines »… d'un formulaire.
  // Un bouton reste allumé tant que les cases correspondent à ce qu'il propose.
  function raccourcis(form, { cases, debut, fin, du, au, zoneDates }) {
    const boutons = (groupe) => $$(`[data-raccourcis="${groupe}"] button`, form);
    const allumer = (groupe, choisi) => boutons(groupe).forEach((b) => b.setAttribute('aria-pressed', b === choisi));

    const synchroJours = () => {
      const coches = cases().filter((c) => c.checked).map((c) => c.value).join(',');
      allumer('jours', boutons('jours').find((b) => b.dataset.jours === coches));
    };
    boutons('jours').forEach((b) => b.addEventListener('click', () => {
      const liste = b.dataset.jours.split(',');
      cases().forEach((c) => { c.checked = liste.includes(c.value); });
      synchroJours();
    }));
    cases().forEach((c) => c.addEventListener('change', synchroJours));

    const synchroHoraires = () => allumer('horaires',
      boutons('horaires').find((b) => b.dataset.debut === debut.value && b.dataset.fin === fin.value));
    boutons('horaires').forEach((b) => b.addEventListener('click', () => {
      debut.value = b.dataset.debut;
      fin.value = b.dataset.fin;
      synchroHoraires();
    }));
    [debut, fin].forEach((c) => c.addEventListener('change', synchroHoraires));

    // Durée : un nombre de jours à partir d'aujourd'hui, ou « dates » pour choisir soi-même.
    let dureeChoisie = '28';
    const choisirDuree = (valeur) => {
      dureeChoisie = String(valeur);
      du.min = Zoe.aujourdhui();
      if (dureeChoisie !== 'dates') {
        du.value = Zoe.aujourdhui();
        au.value = dansJours(Number(dureeChoisie) - 1);
      }
      au.min = du.value || Zoe.aujourdhui();
      zoneDates.hidden = dureeChoisie !== 'dates';
      allumer('duree', boutons('duree').find((b) => b.dataset.duree === dureeChoisie));
    };
    boutons('duree').forEach((b) => b.addEventListener('click', () => choisirDuree(b.dataset.duree)));
    // La date « Au » suit toujours la date « Du ».
    du.addEventListener('change', () => { au.min = du.value; if (au.value < du.value) au.value = du.value; });

    return {
      synchro: () => { synchroJours(); synchroHoraires(); },
      duree: choisirDuree,
      dureeActuelle: () => dureeChoisie,
    };
  }

  // « du lundi au jeudi », « le week-end », « tous les jours », « lun, mer »…
  const NOMS_JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  function phraseJours(jours) {
    const j = [...jours].sort((a, b) => a - b);
    if (j.length === 7) return 'tous les jours';
    if (j.join() === '6,7') return 'le week-end';
    if (j.length === 1) return `le ${NOMS_JOURS[j[0]]}`;
    const suivis = j.every((v, i) => i === 0 || v === j[i - 1] + 1);
    return suivis ? `du ${NOMS_JOURS[j[0]]} au ${NOMS_JOURS[j[j.length - 1]]}` : j.map((v) => NOMS_JOURS[v].slice(0, 3)).join(', ');
  }

  /* ---------- 2. Recherche sur une période, aller et retour ---------- */
  const rDepart = $('#r-depart');
  const rDestination = $('#r-destination');
  Zoe.champCommune(rDepart);
  Zoe.champCommune(rDestination);
  const rDebut = $('#r-debut');
  const rFin = $('#r-fin');
  const rRaccourcis = raccourcis($('#form-recherche'), {
    cases: () => $$('[name=rjours]'), debut: $('#r-heure'), fin: $('#r-retour'),
    du: rDebut, au: rFin, zoneDates: $('#r-dates'),
  });
  rRaccourcis.duree('28');
  rRaccourcis.synchro();

  // Le formulaire se souvient de la dernière recherche faite sur cet appareil.
  const CLE_MEMOIRE = `zoe.recherche.${moi.id}`;
  function memoriser(besoin) {
    try { localStorage.setItem(CLE_MEMOIRE, JSON.stringify({ besoin, duree: rRaccourcis.dureeActuelle() })); } catch { /* stockage indisponible : sans gravité */ }
  }
  function retrouver() {
    try {
      const memo = JSON.parse(localStorage.getItem(CLE_MEMOIRE) || 'null');
      if (!memo || !memo.besoin) return;
      remplirRecherche(memo.besoin, memo.duree);
    } catch { /* mémoire illisible : on garde le formulaire par défaut */ }
  }

  let derniereRecherche = null;

  // Lit le formulaire : c'est « le besoin » du membre.
  function lireRecherche() {
    const depart = Zoe.lireCommune(rDepart);
    const destination = Zoe.lireCommune(rDestination);
    const jours = $$('[name=rjours]:checked').map((c) => Number(c.value));
    if (!jours.length) throw new Error('Cochez au moins un jour.');
    if (!rDebut.value || !rFin.value) throw new Error('Indiquez la période de vos trajets.');
    if (rFin.value < rDebut.value) throw new Error('La date « Au » doit être le même jour que la date « Du », ou après.');
    return {
      depart_ville: depart.ville, depart_lat: depart.lat, depart_lng: depart.lng,
      destination_ville: destination.ville, dest_lat: destination.lat, dest_lng: destination.lng,
      date_debut: rDebut.value, date_fin: rFin.value, jours,
      heure_arrivee: $('#r-heure').value, heure_retour: $('#r-retour').value,
      marge_min: Number($('#r-marge').value),
    };
  }

  // Remet un besoin dans le formulaire. Avec une durée (7, 28, 70), les dates
  // repartent d'aujourd'hui ; sinon on affiche les dates du besoin, jamais dans le passé.
  function remplirRecherche(b, duree = 'dates') {
    rDepart.value = b.depart_ville; rDepart.dataset.lat = b.depart_lat; rDepart.dataset.lng = b.depart_lng;
    rDestination.value = b.destination_ville; rDestination.dataset.lat = b.dest_lat; rDestination.dataset.lng = b.dest_lng;
    $$('[name=rjours]').forEach((c) => { c.checked = b.jours.includes(Number(c.value)); });
    $('#r-heure').value = Zoe.heure(b.heure_arrivee);
    $('#r-retour').value = Zoe.heure(b.heure_retour);
    $('#r-marge').value = b.marge_min;
    if (duree === 'dates' && b.date_fin >= Zoe.aujourdhui()) {
      rDebut.value = b.date_debut < Zoe.aujourdhui() ? Zoe.aujourdhui() : b.date_debut;
      rFin.value = b.date_fin;
      rRaccourcis.duree('dates');
    } else {
      rRaccourcis.duree(duree === 'dates' ? '28' : duree);
    }
    rRaccourcis.synchro();
  }
  retrouver();

  const resumeBesoin = (b) => `${phraseJours(b.jours)}, ${Zoe.heure(b.heure_arrivee)}${b.heure_retour ? ` – ${Zoe.heure(b.heure_retour)}` : ''}`;

  async function rechercher(besoin = lireRecherche()) {
    derniereRecherche = besoin;
    memoriser(besoin);
    const trajets = await req(sb.rpc('rechercher_trajets_periode', {
      p_dep_lat: besoin.depart_lat, p_dep_lng: besoin.depart_lng,
      p_dest_lat: besoin.dest_lat, p_dest_lng: besoin.dest_lng,
      p_debut: besoin.date_debut, p_fin: besoin.date_fin, p_jours: besoin.jours,
      p_arrivee: besoin.heure_arrivee, p_retour: besoin.heure_retour, p_marge: besoin.marge_min,
    }));
    const zone = $('#resultats');
    const enregistrer = html`<button class="btn btn--ghost btn--sm" type="button" data-action="enregistrer">Enregistrer cette recherche</button>`;

    if (!trajets.length) {
      zone.innerHTML = html`<div class="empty"><strong>Aucun trajet compatible pour le moment.</strong>
        <p>Enregistrez votre recherche : vous serez prévenu(e) ici dès qu'un conducteur proposera un trajet qui convient, et les conducteurs verront qu'il est demandé.</p>
        <p><button class="btn btn--primary" type="button" data-action="enregistrer">Enregistrer cette recherche</button></p></div>`;
      return;
    }

    const allerRetour = (t) => {
      const aller = t.aller_ok
        ? html`<span class="tag tag--ok">Aller : ${t.heure_depart ? `départ ${Zoe.heure(t.heure_depart)}, ` : ''}arrivée ${Zoe.heure(t.heure_arrivee)}</span>`
        : html`<span class="tag tag--non">Aller : arrivée ${Zoe.heure(t.heure_arrivee)}, trop tôt ou trop tard</span>`;
      if (!besoin.heure_retour) return aller;
      const retour = t.retour_ok
        ? html`<span class="tag tag--ok">Retour : départ ${Zoe.heure(t.heure_retour)}</span>`
        : html`<span class="tag tag--non">${t.heure_retour ? `Retour : départ ${Zoe.heure(t.heure_retour)}, ne convient pas` : 'Pas de retour proposé'}</span>`;
      return html`${aller}${retour}`;
    };

    // Une phrase qui dit l'essentiel : aller, retour, et combien de jours.
    const enClair = (t) => {
      const trajet = t.aller_ok && t.retour_ok ? 'à l\'aller et au retour' : t.aller_ok ? 'à l\'aller seulement' : 'au retour seulement';
      const joursCouverts = t.dates_communes >= t.dates_demandees ? 'tous vos jours' : `${t.dates_communes} jour${t.dates_communes > 1 ? 's' : ''} sur ${t.dates_demandees}`;
      return `${t.prenom} peut vous emmener ${trajet}, ${joursCouverts}.`;
    };
    const urls = await Zoe.photos(trajets.map((t) => t.photo_path));
    zone.innerHTML = html`
      <div class="resultats__tete">
        <p><b>${trajets.length} trajet${trajets.length > 1 ? 's' : ''} trouvé${trajets.length > 1 ? 's' : ''}</b> pour ${resumeBesoin(besoin)}</p>
        ${enregistrer}
      </div>
      ${trajets.map((t) => html`
      <article class="result" data-trajet="${t.id}">
        <div class="result__score" style="--p:${Math.max(0, t.score)}" aria-label="Compatibilité ${t.score} %">${Math.max(0, t.score)}%</div>
        <div class="result__main">
          <div class="result__qui">
            ${Zoe.avatar(t.prenom, t.initiale, urls[t.photo_path])}
            <div>
              <button class="lien-nom" type="button" data-fiche="${t.conducteur_id}">${t.prenom} ${t.initiale}.</button>
              <span class="badge badge--ok">Permis contrôlé</span> ${Zoe.etoiles(t.note_moyenne, t.nb_avis)}
              <p>${Zoe.CATEGORIES[t.categorie]}${t.etablissement ? ` · ${t.etablissement}` : ''}</p>
            </div>
          </div>
          <p class="result__phrase">${enClair(t)}</p>
          <p><b>${t.depart_ville} → ${t.destination_nom}</b> (${t.destination_ville})</p>
          <p>Roule ${Zoe.jours(t.jours)} · jusqu'au ${Zoe.date(t.date_fin)}</p>
          ${t.commentaire ? html`<p class="citation">« ${t.commentaire} »</p>` : ''}
          <div class="result__tags">
            ${allerRetour(t)}
            <span class="tag ${t.dates_communes >= t.dates_demandees ? 'tag--ok' : ''}">${Zoe.jours(t.jours_communs)} · ${t.dates_communes} jour${t.dates_communes > 1 ? 's' : ''} sur ${t.dates_demandees}</span>
            <span class="tag ${t.detour_km <= 2 ? 'tag--ok' : ''}">${t.detour_km <= 2 ? 'Sur le chemin' : `Détour de ${t.detour_km} km`}</span>
          </div>
        </div>
        <div class="result__side">
          <span class="seats">${t.places_restantes > 0 ? `${t.places_restantes} place${t.places_restantes > 1 ? 's' : ''}` : 'Complet'}</span>
          ${['demandee', 'acceptee', 'refusee'].includes(t.ma_reservation)
            ? badgeReservation(t.ma_reservation)
            : t.places_restantes > 0 ? html`<button class="btn btn--primary btn--sm" type="button" data-action="demander">Demander une place</button>` : ''}
          ${t.ma_reservation
            ? html`<button class="lien" type="button" data-action="voir-messages">Messages</button>`
            : html`<button class="lien" type="button" data-action="question">Poser une question</button>`}
        </div>
        <form class="result__demande" hidden>
          <label><span data-libelle>Message au conducteur</span>
            <textarea name="message" rows="2" maxlength="2000" placeholder="Bonjour, je suis en stage au même endroit. Je cherche l'aller et le retour…"></textarea>
          </label>
          <button class="btn btn--green btn--sm" type="submit">Envoyer</button>
        </form>
      </article>`)}`;
  }

  $('#form-recherche').addEventListener('submit', (e) => {
    e.preventDefault();
    occupe(e.submitter, () => rechercher());
  });

  /* Recherches enregistrées : gardées tant qu'aucun trajet ne convient. */
  let besoins = [];
  async function chargerBesoins() {
    const { data } = await sb.rpc('mes_besoins');
    besoins = data || [];
    const zone = $('#besoins');
    zone.hidden = besoins.length === 0;
    const etat = (b) => {
      if (b.date_fin < Zoe.aujourdhui()) return html`<span class="badge badge--annulee">Période terminée</span>`;
      if (b.nb_nouveaux) return html`<span class="badge badge--acceptee">${b.nb_nouveaux} nouveau${b.nb_nouveaux > 1 ? 'x' : ''} trajet${b.nb_nouveaux > 1 ? 's' : ''}</span>`;
      if (b.nb_trajets) return html`<span class="badge badge--contact">${b.nb_trajets} trajet${b.nb_trajets > 1 ? 's' : ''} disponible${b.nb_trajets > 1 ? 's' : ''}</span>`;
      return html`<span class="badge badge--demandee">Aucun trajet pour l'instant, nous surveillons</span>`;
    };
    zone.innerHTML = html`
      <h2>Mes recherches enregistrées</h2>
      ${besoins.map((b) => html`
        <div class="besoin" data-besoin="${b.id}">
          <div>
            <strong>${b.depart_ville} → ${b.destination_ville}</strong>
            <small>${resumeBesoin(b)}, jusqu'au ${Zoe.date(b.date_fin)}</small>
          </div>
          ${etat(b)}
          ${b.date_fin < Zoe.aujourdhui()
            ? html`<button class="lien" type="button" data-action="relancer">Relancer</button>`
            : html`<button class="lien" type="button" data-action="voir">Voir</button>`}
          <button class="lien lien--danger" type="button" data-action="oublier">Supprimer</button>
        </div>`)}`;
    const nouveaux = besoins.filter((b) => b.date_fin >= Zoe.aujourdhui()).reduce((somme, b) => somme + b.nb_nouveaux, 0);
    const pastille = $('#pastille-recherche');
    pastille.hidden = nouveaux === 0;
    pastille.textContent = nouveaux;
  }
  chargerBesoins();

  $('#besoins').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const besoin = besoins.find((b) => b.id === bouton.closest('[data-besoin]').dataset.besoin);
    const action = bouton.dataset.action;
    occupe(bouton, async () => {
      if (action === 'oublier') {
        await req(sb.from('besoins').delete().eq('id', besoin.id));
      } else if (action === 'relancer') {
        // Période passée : la recherche repart d'aujourd'hui, pour la même durée.
        const jours = Math.round((new Date(besoin.date_fin) - new Date(besoin.date_debut)) / 86400000);
        const { id, nb_trajets, nb_nouveaux, ...champs } = besoin;
        const neuf = { ...champs, date_debut: Zoe.aujourdhui(), date_fin: dansJours(jours) };
        await req(sb.from('besoins').delete().eq('id', besoin.id));
        await req(sb.from('besoins').insert({ membre_id: moi.id, ...neuf }));
        remplirRecherche(neuf);
        await rechercher();
        toast('Recherche relancée à partir d\'aujourd\'hui.');
      } else {
        remplirRecherche(besoin);
        await rechercher();
        // Les trajets viennent d'être consultés : ils ne sont plus « nouveaux ».
        await req(sb.from('besoins').update({ vu_le: new Date().toISOString() }).eq('id', besoin.id));
      }
      await chargerBesoins();
    });
  });

  $('#resultats').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    if (bouton.dataset.action === 'voir-messages') { montrer('messages'); return; }
    if (bouton.dataset.action === 'enregistrer') {
      occupe(bouton, async () => {
        if (besoins.length >= 10) throw new Error('Vous avez déjà 10 recherches enregistrées. Supprimez-en une.');
        await req(sb.from('besoins').insert({ membre_id: moi.id, ...derniereRecherche }));
        toast('Recherche enregistrée. Vous serez prévenu(e) ici des nouveaux trajets.');
        await chargerBesoins();
      });
      return;
    }
    // Le même formulaire sert à demander une place ou à poser une simple question.
    const question = bouton.dataset.action === 'question';
    const formulaire = $('.result__demande', bouton.closest('.result'));
    formulaire.dataset.mode = bouton.dataset.action;
    formulaire.message.required = question;
    $('[data-libelle]', formulaire).textContent = question ? 'Votre question au conducteur' : 'Message au conducteur (facultatif)';
    $('[type=submit]', formulaire).textContent = question ? 'Envoyer mon message' : 'Envoyer ma demande';
    formulaire.hidden = false;
    formulaire.message.focus();
  });

  $('#resultats').addEventListener('submit', (e) => {
    e.preventDefault();
    const carte = e.target.closest('.result');
    occupe(e.submitter, async () => {
      if (e.target.dataset.mode === 'question') {
        await req(sb.rpc('contacter_conducteur', { p_trajet: carte.dataset.trajet, p_message: e.target.message.value }));
        toast('Message envoyé au conducteur.');
        montrer('messages');
        return;
      }
      await req(sb.rpc('demander_reservation', { p_trajet: carte.dataset.trajet, p_message: e.target.message.value }));
      toast('Demande envoyée au conducteur.');
      await rechercher(derniereRecherche);
    });
  });

  /* ---------- 3. Proposer un trajet ---------- */
  const tDepart = $('#t-depart');
  const tDestination = $('#t-destination');
  Zoe.champCommune(tDepart);
  Zoe.champCommune(tDestination);
  const formTrajet = $('#form-trajet');
  const tRaccourcis = raccourcis(formTrajet, {
    cases: () => $$('[name=jours]', formTrajet), debut: formTrajet.heure_arrivee, fin: formTrajet.heure_retour,
    du: formTrajet.date_debut, au: formTrajet.date_fin, zoneDates: $('#t-dates'),
  });
  tRaccourcis.duree('28');
  tRaccourcis.synchro();

  // Suggestions : les établissements partenaires déjà connus.
  req(sb.from('etablissements_publics').select('nom').order('nom')).then((liste) => {
    $('#liste-etablissements').replaceChildren(...liste.map((e) => new Option(e.nom)));
  }).catch(() => {});

  // Ce que les autres membres recherchent : aide à choisir quel trajet proposer.
  sb.rpc('besoins_ouverts').then(({ data }) => {
    const zone = $('#recherches-ouvertes');
    if (!data || !data.length) return;
    zone.hidden = false;
    zone.innerHTML = html`
      <h2>Trajets recherchés en ce moment</h2>
      <p class="aide">Des membres attendent un conducteur pour ces trajets. Si l'un d'eux est sur votre route, proposez-le.</p>
      <ul>${data.map((b) => html`<li><b>${b.depart_ville} → ${b.destination_ville}</b>
        <span>${resumeBesoin(b)} · jusqu'au ${Zoe.date(b.date_fin)}</span></li>`)}</ul>`;
  });

  // Seuls les conducteurs validés voient le formulaire de trajet.
  function afficherEtatConducteur() {
    const valide = moi.conducteur_statut === 'valide';
    formTrajet.hidden = !valide;
    $('#conducteur-docs').hidden = valide;
    const etat = $('#conducteur-etat');
    const enAttente = moi.conducteur_statut === 'en_attente';
    $('#form-conducteur').hidden = enAttente;
    etat.hidden = !enAttente && moi.conducteur_statut !== 'refuse';
    etat.classList.toggle('alerte--err', moi.conducteur_statut === 'refuse');
    etat.textContent = enAttente
      ? 'Vos documents ont bien été reçus. Ils sont en cours de contrôle : vous pourrez proposer un trajet dès leur validation.'
      : 'Vos documents n\'ont pas pu être acceptés. Vous pouvez en envoyer de nouveaux.';
  }
  afficherEtatConducteur();

  $('#form-conducteur').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    occupe(e.submitter, async () => {
      const extensions = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
      const deposer = async (fichier, nom) => {
        if (!fichier) throw new Error('Choisissez les deux fichiers.');
        if (fichier.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux (5 Mo maximum).');
        if (!extensions[fichier.type]) throw new Error('Format de fichier non accepté (PDF, JPG ou PNG).');
        const chemin = `${moi.id}/${nom}-${Date.now()}.${extensions[fichier.type]}`;
        await req(sb.storage.from('documents-conducteur').upload(chemin, fichier, { contentType: fichier.type }));
        return chemin;
      };
      const anciens = [moi.permis_path, moi.identite_path].filter(Boolean);
      const permis = await deposer(f.permis.files[0], 'permis');
      const identite = await deposer(f.identite.files[0], 'identite');
      await req(sb.rpc('soumettre_documents_conducteur', { p_permis: permis, p_identite: identite, p_type: f.type.value }));
      if (anciens.length) await sb.storage.from('documents-conducteur').remove(anciens);
      moi = await req(sb.from('profils').select('*').eq('id', moi.id).single());
      f.reset();
      afficherEtatConducteur();
      toast('Documents envoyés. Notre équipe les contrôle.');
    });
  });

  formTrajet.addEventListener('submit', (e) => {
    e.preventDefault();
    occupe(e.submitter, async () => {
      const depart = Zoe.lireCommune(tDepart);
      const destination = Zoe.lireCommune(tDestination);
      const jours = $$('[name=jours]:checked', formTrajet).map((c) => Number(c.value));
      if (!jours.length) throw new Error('Cochez au moins un jour.');
      if (formTrajet.date_fin.value < formTrajet.date_debut.value) throw new Error('La date « Au » doit être le même jour que la date « Du », ou après.');

      await req(sb.from('trajets').insert({
        conducteur_id: moi.id,
        depart_ville: depart.ville, depart_lat: depart.lat, depart_lng: depart.lng,
        destination_nom: formTrajet.destination_nom.value.trim(),
        destination_ville: destination.ville, dest_lat: destination.lat, dest_lng: destination.lng,
        date_debut: formTrajet.date_debut.value,
        date_fin: formTrajet.date_fin.value,
        jours,
        heure_depart: formTrajet.heure_depart.value,
        heure_arrivee: formTrajet.heure_arrivee.value,
        heure_retour: formTrajet.heure_retour.value || null,
        places: Number(formTrajet.places.value),
        detour_max_km: Number(formTrajet.detour_max_km.value),
        commentaire: formTrajet.commentaire.value.trim() || null,
      }));
      toast('Trajet publié.');
      formTrajet.reset();
      tRaccourcis.duree('28');
      tRaccourcis.synchro();
      delete tDepart.dataset.lat;
      delete tDestination.dataset.lat;
      montrer('trajets');
    });
  });

  /* ---------- 4. Mes trajets (conducteur) ---------- */
  async function chargerMesTrajets() {
    const zone = $('#mes-trajets');
    try {
      const trajets = await req(sb.from('trajets').select('*').eq('conducteur_id', moi.id).order('date_debut', { ascending: false }));
      if (!trajets.length) {
        zone.innerHTML = html`<div class="empty">Vous n'avez pas encore proposé de trajet.</div>`;
        return;
      }
      const reservations = await req(sb.from('reservations').select('*').in('trajet_id', trajets.map((t) => t.id)).order('created_at'));
      const membres = await membresParId(reservations.map((r) => r.passager_id));

      zone.innerHTML = html`${trajets.map((t) => {
        const demandes = reservations.filter((r) => r.trajet_id === t.id && !['annulee', 'contact'].includes(r.statut));
        const prises = demandes.filter((r) => r.statut === 'acceptee').length;
        return html`
        <article class="element" data-trajet="${t.id}">
          <div class="element__tete">
            <div>${resumeTrajet(t)}</div>
            <div class="element__actions">
              <span class="seats">Places : ${prises}/${t.places}</span>
              ${t.actif ? '' : html`<span class="badge badge--annulee">En pause</span>`}
              <button class="lien" type="button" data-action="dupliquer">Dupliquer</button>
              <button class="lien" type="button" data-action="pause">${t.actif ? 'Mettre en pause' : 'Réactiver'}</button>
              <button class="lien lien--danger" type="button" data-action="supprimer">Supprimer</button>
            </div>
          </div>
          ${demandes.length ? html`<ul class="demandes">${demandes.map((r) => html`
            <li data-reservation="${r.id}" data-nom="${nomMembre(membres[r.passager_id])}" data-statut="${r.statut}">
              <span class="avatar">${membres[r.passager_id] ? Zoe.initiales(membres[r.passager_id].prenom, membres[r.passager_id].initiale) : '?'}</span>
              <div>
                <button class="lien-nom" type="button" data-fiche="${r.passager_id}">${nomMembre(membres[r.passager_id])}</button>
                <small>${membres[r.passager_id] ? Zoe.CATEGORIES[membres[r.passager_id].categorie] : ''}</small>
              </div>
              ${badgeReservation(r.statut)}
              <div class="element__actions">
                ${r.statut !== 'acceptee' ? html`<button class="btn btn--green btn--sm" type="button" data-action="accepter">Accepter</button>` : ''}
                ${r.statut !== 'refusee' ? html`<button class="lien lien--danger" type="button" data-action="refuser">Refuser</button>` : ''}
                <button class="lien" type="button" data-action="messages">Messages</button>
              </div>
            </li>`)}</ul>` : html`<p class="aide">Aucune demande pour l'instant.</p>`}
        </article>`;
      })}`;
      zone._trajets = Object.fromEntries(trajets.map((t) => [t.id, t]));
    } catch (e) { Zoe.erreur(e); }
  }

  $('#mes-trajets').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const idTrajet = bouton.closest('[data-trajet]').dataset.trajet;
    const ligne = bouton.closest('[data-reservation]');
    const action = bouton.dataset.action;

    if (action === 'messages') { ouvrirFil(ligne.dataset.reservation, ligne.dataset.nom, ligne.dataset.statut); return; }
    if (action === 'dupliquer') {
      // Reprend le trajet dans le formulaire : il ne reste qu'à changer les jours ou les heures.
      const t = $('#mes-trajets')._trajets[idTrajet];
      tDepart.value = t.depart_ville; tDepart.dataset.lat = t.depart_lat; tDepart.dataset.lng = t.depart_lng;
      tDestination.value = t.destination_ville; tDestination.dataset.lat = t.dest_lat; tDestination.dataset.lng = t.dest_lng;
      formTrajet.destination_nom.value = t.destination_nom;
      tRaccourcis.duree('dates');
      formTrajet.date_debut.value = t.date_debut < Zoe.aujourdhui() ? Zoe.aujourdhui() : t.date_debut;
      formTrajet.date_fin.value = t.date_fin < formTrajet.date_debut.value ? formTrajet.date_debut.value : t.date_fin;
      $$('[name=jours]', formTrajet).forEach((c) => { c.checked = t.jours.includes(Number(c.value)); });
      formTrajet.heure_depart.value = Zoe.heure(t.heure_depart);
      formTrajet.heure_arrivee.value = Zoe.heure(t.heure_arrivee);
      formTrajet.heure_retour.value = Zoe.heure(t.heure_retour);
      formTrajet.places.value = t.places;
      formTrajet.detour_max_km.value = t.detour_max_km;
      formTrajet.commentaire.value = t.commentaire || '';
      tRaccourcis.synchro();
      montrer('proposer');
      toast('Trajet copié : modifiez les jours ou les horaires, puis publiez.');
      return;
    }
    if (action === 'supprimer' && !confirm('Supprimer ce trajet ? Les réservations liées seront annulées.')) return;

    occupe(bouton, async () => {
      if (action === 'pause') {
        const trajet = $('#mes-trajets')._trajets[idTrajet];
        await req(sb.from('trajets').update({ actif: !trajet.actif }).eq('id', idTrajet));
      } else if (action === 'supprimer') {
        await req(sb.from('trajets').delete().eq('id', idTrajet));
        toast('Trajet supprimé.');
      } else {
        await req(sb.rpc('repondre_reservation', { p_reservation: ligne.dataset.reservation, p_accepter: action === 'accepter' }));
        toast(action === 'accepter' ? 'Demande acceptée.' : 'Demande refusée.');
      }
      await chargerMesTrajets();
    });
  });

  /* ---------- 5. Mes réservations (passager) ---------- */
  async function chargerMesReservations() {
    const zone = $('#mes-reservations');
    try {
      const reservations = await req(sb.from('reservations').select('*').eq('passager_id', moi.id).neq('statut', 'contact').order('created_at', { ascending: false }));
      if (!reservations.length) {
        zone.innerHTML = html`<div class="empty">Vous n'avez pas encore demandé de place.</div>`;
        return;
      }
      const trajets = await req(sb.from('trajets').select('*').in('id', reservations.map((r) => r.trajet_id)));
      const parId = Object.fromEntries(trajets.map((t) => [t.id, t]));
      const membres = await membresParId(trajets.map((t) => t.conducteur_id));
      const avisDonnes = await req(sb.from('avis').select('reservation_id, note, commentaire').eq('auteur_id', moi.id));
      const mesAvis = Object.fromEntries(avisDonnes.map((a) => [a.reservation_id, a]));
      zone._avis = mesAvis;

      zone.innerHTML = html`${reservations.filter((r) => parId[r.trajet_id]).map((r) => {
        const t = parId[r.trajet_id];
        const conducteur = nomMembre(membres[t.conducteur_id]);
        return html`
        <article class="element" data-reservation="${r.id}" data-nom="${conducteur}" data-statut="${r.statut}">
          <div class="element__tete">
            <div>
              ${resumeTrajet(t)}
              <p>Conducteur : <button class="lien-nom" type="button" data-fiche="${t.conducteur_id}">${conducteur}</button></p>
            </div>
            <div class="element__actions">
              ${badgeReservation(r.statut)}
              <button class="lien" type="button" data-action="messages">Messages</button>
              ${r.statut === 'acceptee' && t.date_debut <= Zoe.aujourdhui() ? html`<button class="lien" type="button" data-action="avis">${mesAvis[r.id] ? 'Modifier mon avis' : 'Laisser un avis'}</button>` : ''}
              ${['demandee', 'acceptee'].includes(r.statut) ? html`<button class="lien lien--danger" type="button" data-action="annuler">Annuler</button>` : ''}
            </div>
          </div>
          <form class="form-avis" hidden>
            <label>Ma note
              <select name="note" required>
                <option value="5">★★★★★ Excellent</option>
                <option value="4">★★★★ Très bien</option>
                <option value="3">★★★ Correct</option>
                <option value="2">★★ Décevant</option>
                <option value="1">★ À éviter</option>
              </select>
            </label>
            <label>Mon commentaire <small>(facultatif, visible des autres membres)</small>
              <textarea name="commentaire" rows="2" maxlength="500" placeholder="Ponctualité, conduite, ambiance…"></textarea>
            </label>
            <button class="btn btn--green btn--sm" type="submit">Publier mon avis</button>
          </form>
        </article>`;
      })}`;
    } catch (e) { Zoe.erreur(e); }
  }

  $('#mes-reservations').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const carte = bouton.closest('[data-reservation]');
    if (bouton.dataset.action === 'messages') { ouvrirFil(carte.dataset.reservation, carte.dataset.nom, carte.dataset.statut); return; }
    if (bouton.dataset.action === 'avis') {
      const formulaire = $('.form-avis', carte);
      const existant = $('#mes-reservations')._avis[carte.dataset.reservation];
      if (existant) { formulaire.note.value = existant.note; formulaire.commentaire.value = existant.commentaire || ''; }
      formulaire.hidden = !formulaire.hidden;
      return;
    }
    if (!confirm('Annuler cette réservation ?')) return;
    occupe(bouton, async () => {
      await req(sb.rpc('annuler_reservation', { p_reservation: carte.dataset.reservation }));
      toast('Réservation annulée.');
      await chargerMesReservations();
    });
  });

  /* ---------- 6. Messagerie ---------- */
  const fil = $('#fil');
  let filReservation = null;
  let filMinuteur = null;

  async function chargerFil() {
    if (!filReservation) return;
    const messages = await req(sb.from('messages').select('*').eq('reservation_id', filReservation).order('created_at'));
    const zone = $('#fil-messages');
    zone.innerHTML = messages.length
      ? html`${messages.map((m) => html`
          <div class="bulle ${m.expediteur_id === moi.id ? 'bulle--moi' : ''}">
            <p>${m.contenu}</p><small>${Zoe.dateHeure(m.created_at)}</small>
          </div>`)}`
      : html`<p class="aide">Aucun message. Écrivez le premier pour vous organiser.</p>`;
    zone.scrollTop = zone.scrollHeight;
    await sb.rpc('marquer_lu', { p_reservation: filReservation });
  }

  // Pastille des messages non lus sur l'onglet « Messages ».
  async function majPastille() {
    const { data } = await sb.rpc('mes_conversations');
    const total = (data || []).reduce((somme, c) => somme + c.non_lus, 0);
    const pastille = $('#pastille');
    pastille.hidden = total === 0;
    pastille.textContent = total;
    return data || [];
  }

  async function chargerConversations() {
    const zone = $('#conversations');
    try {
      const conversations = await majPastille();
      zone.innerHTML = conversations.length
        ? html`${conversations.map((c) => html`
          <button class="conversation ${c.non_lus ? 'conversation--nonlu' : ''}" type="button"
                  data-reservation="${c.reservation_id}" data-nom="${c.autre_prenom} ${c.autre_initiale}." data-statut="${c.statut}">
            <span class="avatar">${Zoe.initiales(c.autre_prenom, c.autre_initiale)}</span>
            <span class="conversation__texte">
              <strong>${c.autre_prenom} ${c.autre_initiale}.</strong>
              <small>${c.je_conduis ? 'Votre trajet' : 'Son trajet'} : ${c.depart_ville} → ${c.destination_nom}</small>
              <span class="conversation__extrait">${c.dernier_de_moi ? 'Vous : ' : ''}${c.dernier_message}</span>
            </span>
            <span class="conversation__cote">
              <small>${Zoe.dateHeure(c.dernier_le)}</small>
              ${c.non_lus ? html`<span class="pastille">${c.non_lus}</span>` : badgeReservation(c.statut)}
            </span>
          </button>`)}`
        : html`<div class="empty"><strong>Aucune conversation.</strong>
            <p>Depuis la recherche, vous pouvez poser une question à un conducteur avant de demander une place.</p></div>`;
    } catch (e) { Zoe.erreur(e); }
  }

  $('#conversations').addEventListener('click', (e) => {
    const ligne = e.target.closest('[data-reservation]');
    if (ligne) ouvrirFil(ligne.dataset.reservation, ligne.dataset.nom, ligne.dataset.statut);
  });

  function ouvrirFil(reservation, nom, statut) {
    // Après un refus ou une annulation, on peut relire mais plus écrire.
    const close = ['refusee', 'annulee'].includes(statut);
    $('#fil-form').hidden = close;
    $('#fil-clos').hidden = !close;
    filReservation = reservation;
    $('#fil-titre').textContent = `Messages avec ${nom}`;
    $('#fil-messages').innerHTML = '';
    fil.showModal();
    chargerFil().catch(Zoe.erreur);
    // Rafraîchit la conversation toutes les 8 secondes tant qu'elle est ouverte.
    filMinuteur = setInterval(() => chargerFil().catch(() => {}), 8000);
  }

  fil.addEventListener('close', () => {
    clearInterval(filMinuteur);
    filReservation = null;
    // À la fermeture, la liste et la pastille reflètent ce qui vient d'être lu.
    if (!$('[data-panneau="messages"]').hidden) chargerConversations(); else majPastille();
  });
  majPastille();
  setInterval(majPastille, 30000);
  $('#fil-fermer').addEventListener('click', () => fil.close());
  $('#fil-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const champ = e.target.contenu;
    const contenu = champ.value.trim();
    if (!contenu) return;
    occupe(e.submitter, async () => {
      await req(sb.from('messages').insert({ reservation_id: filReservation, expediteur_id: moi.id, contenu }));
      champ.value = '';
      await chargerFil();
    });
  });

  /* ---------- 7. Profil ---------- */
  const formProfil = $('#form-profil');

  async function chargerProfil() {
    afficherPhoto();
    afficherMesAvis();
    for (const champ of ['prenom', 'nom', 'ville', 'telephone', 'etablissement_declare', 'vehicule', 'bio']) {
      formProfil[champ].value = moi[champ] || '';
    }
    const methodes = { code: 'code d\'établissement', justificatif: 'justificatif', invitation: 'invitation', admin: 'l\'équipe Meet Zoe' };
    $('#profil-resume').textContent = `${Zoe.CATEGORIES[moi.categorie]} · ${moi.email} · compte vérifié par ${methodes[moi.methode_verif] || 'l\'équipe Meet Zoe'}`
      + (moi.conducteur_statut === 'valide' ? ' · conducteur validé.' : '.');
    try {
      const invitations = await req(sb.from('invitations').select('*').eq('cree_par', moi.id).order('created_at'));
      $('#invitations').innerHTML = invitations.length
        ? html`${invitations.map((i) => html`<li><code>${i.code}</code>
            <span class="badge ${i.utilise_par ? 'badge--acceptee' : 'badge--demandee'}">${i.utilise_par ? 'Utilisée' : 'Disponible'}</span></li>`)}`
        : html`<li class="aide">Aucune invitation créée.</li>`;
      $('#creer-invitation').disabled = invitations.length >= 5;
    } catch (e) { Zoe.erreur(e); }
  }

  formProfil.addEventListener('submit', (e) => {
    e.preventDefault();
    occupe(e.submitter, async () => {
      const [maj] = await req(sb.from('profils').update({
        prenom: formProfil.prenom.value.trim(),
        nom: formProfil.nom.value.trim(),
        ville: formProfil.ville.value.trim() || null,
        telephone: formProfil.telephone.value.trim() || null,
        etablissement_declare: formProfil.etablissement_declare.value.trim() || null,
        vehicule: formProfil.vehicule.value.trim() || null,
        bio: formProfil.bio.value.trim() || null,
      }).eq('id', moi.id).select());
      moi = maj;
      $('#compte-nom').textContent = `${moi.prenom} ${moi.nom}`;
      toast('Profil enregistré.');
    });
  });

  /* ---------- Avis sur un conducteur ---------- */
  $('#mes-reservations').addEventListener('submit', (e) => {
    e.preventDefault();
    const carte = e.target.closest('[data-reservation]');
    occupe(e.submitter, async () => {
      await req(sb.rpc('laisser_avis', {
        p_reservation: carte.dataset.reservation,
        p_note: Number(e.target.note.value),
        p_commentaire: e.target.commentaire.value,
      }));
      toast('Merci, votre avis est publié.');
      await chargerMesReservations();
    });
  });

  /* ---------- Fiche d'un membre ---------- */
  const fiche = $('#fiche');
  $('#fiche-fermer').addEventListener('click', () => fiche.close());

  async function ouvrirFiche(id) {
    const f = await req(sb.rpc('fiche_membre', { p_membre: id }));
    if (!f) throw new Error('Cette fiche n\'est plus disponible.');
    const urls = await Zoe.photos([f.photo_path]);
    const depuis = new Date(f.membre_depuis).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    $('#fiche-corps').innerHTML = html`
      <div class="fiche__tete">
        ${Zoe.avatar(f.prenom, f.initiale, urls[f.photo_path], 'avatar--grand')}
        <div>
          <h3>${f.prenom} ${f.initiale}.</h3>
          <p>${Zoe.CATEGORIES[f.categorie]}${f.etablissement ? ` · ${f.etablissement}` : ''}</p>
          <div class="result__tags">
            <span class="badge badge--ok">Membre vérifié</span>
            ${f.conducteur_valide ? html`<span class="badge badge--ok">Permis et identité contrôlés</span>` : ''}
          </div>
        </div>
      </div>
      <dl class="fiche__chiffres">
        <div><dt>Membre depuis</dt><dd>${depuis}</dd></div>
        <div><dt>Covoiturages</dt><dd>${f.covoiturages}</dd></div>
        <div><dt>Note</dt><dd>${f.nb_avis ? html`★ ${String(f.note_moyenne).replace('.', ',')} <small>(${f.nb_avis})</small>` : '—'}</dd></div>
      </dl>
      ${f.vehicule ? html`<p><b>Véhicule :</b> ${f.vehicule}</p>` : ''}
      ${f.bio ? html`<p class="citation">« ${f.bio} »</p>` : ''}
      <h4>Avis des passagers${f.nb_avis ? html` <small>(${f.nb_avis})</small>` : ''}</h4>
      ${f.avis.length ? html`
        <ul class="fiche__avis">${f.avis.map((a) => html`<li>
          <span class="note-etoiles">${'★'.repeat(a.note)}</span><span class="etoiles-vides">${'★'.repeat(5 - a.note)}</span> <small>${a.auteur} · ${Zoe.date(a.created_at.slice(0, 10))}</small>
          ${a.commentaire ? html`<p>${a.commentaire}</p>` : html`<p class="aide">Note sans commentaire.</p>`}</li>`)}</ul>`
        : html`<p class="aide fiche__vide">Aucun avis pour l'instant. Les passagers peuvent laisser une note et un commentaire après un covoiturage accepté${f.id === moi.id ? '' : ', depuis l\'onglet « Mes réservations »'}.</p>`}
      ${f.id === moi.id ? '' : html`<button class="lien lien--danger" type="button" data-signaler="${f.id}">Signaler ce membre</button>`}`;
    if (!fiche.open) fiche.showModal();
  }

  // Un clic sur un nom ouvre la fiche, où qu'on soit dans l'espace.
  document.addEventListener('click', (e) => {
    const lien = e.target.closest('[data-fiche]');
    if (lien) { ouvrirFiche(lien.dataset.fiche).catch(Zoe.erreur); return; }
    const signaler = e.target.closest('[data-signaler]');
    if (!signaler) return;
    const motif = prompt('Que s\'est-il passé ? Votre signalement est lu uniquement par l\'équipe Meet Zoe.');
    if (motif === null) return;
    occupe(signaler, async () => {
      await req(sb.rpc('signaler_membre', { p_cible: signaler.dataset.signaler, p_motif: motif }));
      toast('Signalement envoyé. Merci, notre équipe va l\'examiner.');
    });
  });
  $('#voir-ma-fiche').addEventListener('click', () => ouvrirFiche(moi.id).catch(Zoe.erreur));

  /* ---------- Les avis reçus, affichés dans le profil ---------- */
  async function afficherMesAvis() {
    const zone = $('#mes-avis');
    try {
      const f = await req(sb.rpc('fiche_membre', { p_membre: moi.id }));
      if (!f || !f.nb_avis) {
        zone.innerHTML = html`<p class="aide">Vous n'avez pas encore reçu d'avis. Vos passagers peuvent vous noter et laisser un commentaire après un covoiturage accepté.</p>`;
        return;
      }
      zone.innerHTML = html`
        <p class="avis-resume"><span class="note-etoiles">★ ${String(f.note_moyenne).replace('.', ',')}</span>
          sur 5 · ${f.nb_avis} avis</p>
        <ul class="fiche__avis">${f.avis.map((a) => html`<li>
          <span class="note-etoiles">${'★'.repeat(a.note)}</span><span class="etoiles-vides">${'★'.repeat(5 - a.note)}</span>
          <small>${a.auteur} · ${Zoe.date(a.created_at.slice(0, 10))}</small>
          ${a.commentaire ? html`<p>${a.commentaire}</p>` : html`<p class="aide">Note sans commentaire.</p>`}</li>`)}</ul>
        ${f.nb_avis > f.avis.length ? html`<p class="aide">Les ${f.avis.length} avis les plus récents sont affichés.</p>` : ''}`;
    } catch (e) { zone.innerHTML = html`<p class="aide">Les avis n'ont pas pu être chargés.</p>`; }
  }

  /* ---------- Photo de profil ---------- */
  async function afficherPhoto() {
    const urls = await Zoe.photos([moi.photo_path]);
    $('#photo-apercu').innerHTML = Zoe.avatar(moi.prenom, moi.nom[0], urls[moi.photo_path], 'avatar--grand');
    $('#photo-retirer').hidden = !moi.photo_path;
  }

  // Réduit l'image à un carré de 480 px. Au passage, les informations cachées
  // dans le fichier (lieu, appareil) disparaissent.
  async function reduireImage(fichier) {
    const image = await createImageBitmap(fichier);
    const cote = Math.min(image.width, image.height);
    const toile = document.createElement('canvas');
    toile.width = 480; toile.height = 480;
    toile.getContext('2d').drawImage(image, (image.width - cote) / 2, (image.height - cote) / 2, cote, cote, 0, 0, 480, 480);
    return new Promise((resoudre) => toile.toBlob(resoudre, 'image/jpeg', 0.85));
  }

  $('#photo-fichier').addEventListener('change', (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    occupe(null, async () => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(fichier.type)) throw new Error('Choisissez une image JPG, PNG ou WebP.');
      const image = await reduireImage(fichier);
      const chemin = `${moi.id}/photo-${Date.now()}.jpg`;
      await req(sb.storage.from('photos').upload(chemin, image, { contentType: 'image/jpeg' }));
      const ancienne = moi.photo_path;
      await req(sb.rpc('definir_photo', { p_path: chemin }));
      if (ancienne) await sb.storage.from('photos').remove([ancienne]);
      moi.photo_path = chemin;
      e.target.value = '';
      await afficherPhoto();
      toast('Photo enregistrée.');
    });
  });

  $('#photo-retirer').addEventListener('click', (e) => occupe(e.currentTarget, async () => {
    const ancienne = moi.photo_path;
    await req(sb.rpc('definir_photo', { p_path: null }));
    if (ancienne) await sb.storage.from('photos').remove([ancienne]);
    moi.photo_path = null;
    await afficherPhoto();
    toast('Photo retirée.');
  }));

  $('#creer-invitation').addEventListener('click', (e) => occupe(e.currentTarget, async () => {
    const code = await req(sb.rpc('creer_invitation'));
    toast(`Invitation créée : ${code}`);
    await chargerProfil();
  }));

  // Inscrit comme conducteur mais pas encore validé : on commence par les documents.
  if (moi.souhaite_conduire && ['non', 'refuse'].includes(moi.conducteur_statut)) montrer('proposer');

  $('#supprimer-compte').addEventListener('click', (e) => {
    if (!confirm('Supprimer définitivement votre compte et toutes vos données ?')) return;
    occupe(e.currentTarget, async () => {
      // Efface d'abord les fichiers éventuellement déposés.
      for (const dossier of ['justificatifs', 'documents-conducteur', 'photos']) {
        const { data: fichiers } = await sb.storage.from(dossier).list(moi.id);
        if (fichiers && fichiers.length) await sb.storage.from(dossier).remove(fichiers.map((f) => `${moi.id}/${f.name}`));
      }
      await req(sb.rpc('supprimer_mon_compte'));
      await sb.auth.signOut();
      location.href = 'index.html';
    });
  });
})();
