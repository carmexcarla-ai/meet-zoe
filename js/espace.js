/* =========================================================
   Meet Zoe — espace membre
   1. Vérification du compte
   2. Recherche de trajets (matching)
   3. Proposer un trajet
   4. Mes trajets (conducteur)
   5. Mes réservations (passager)
   6. Messagerie
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
        const etablissement = await req(sb.rpc('utiliser_code', { p_code: e.target.code.value }));
        toast(`Bienvenue ! Vous êtes rattaché(e) à ${etablissement}.`);
        setTimeout(() => location.reload(), 900);
      });
    });

    $('#form-invitation').addEventListener('submit', (e) => {
      e.preventDefault();
      occupe(e.submitter, async () => {
        await req(sb.rpc('utiliser_invitation', { p_code: e.target.code.value }));
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
  const chargeurs = { trajets: chargerMesTrajets, reservations: chargerMesReservations, profil: chargerProfil };
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
    <p>${t.destination_ville} · arrivée ${Zoe.heure(t.heure_arrivee)}${t.heure_retour ? ` · retour ${Zoe.heure(t.heure_retour)}` : ''}</p>
    <p>${Zoe.jours(t.jours)} · du ${Zoe.date(t.date_debut)} au ${Zoe.date(t.date_fin)}</p>`;

  /* ---------- 2. Recherche ---------- */
  const rDepart = $('#r-depart');
  const rDestination = $('#r-destination');
  Zoe.champCommune(rDepart);
  Zoe.champCommune(rDestination);
  $('#r-date').value = Zoe.aujourdhui();
  $('#r-date').min = Zoe.aujourdhui();

  async function rechercher() {
    const depart = Zoe.lireCommune(rDepart);
    const destination = Zoe.lireCommune(rDestination);
    const trajets = await req(sb.rpc('rechercher_trajets', {
      p_dep_lat: depart.lat, p_dep_lng: depart.lng,
      p_dest_lat: destination.lat, p_dest_lng: destination.lng,
      p_date: $('#r-date').value, p_heure: $('#r-heure').value,
    }));
    const zone = $('#resultats');
    if (!trajets.length) {
      zone.innerHTML = html`<div class="empty"><strong>Aucun trajet compatible pour le moment.</strong>
        <p>Essayez une autre date ou une heure d'arrivée plus tardive. Vous pouvez aussi proposer votre propre trajet.</p></div>`;
      return;
    }
    zone.innerHTML = html`${trajets.map((t) => html`
      <article class="result" data-trajet="${t.id}">
        <div class="result__score" style="--p:${Math.max(0, t.score)}" aria-label="Compatibilité ${t.score} %">${Math.max(0, t.score)}%</div>
        <div class="result__main">
          <strong>${t.prenom} ${t.initiale}.</strong> <span class="badge badge--ok">Vérifié</span>
          <p>${Zoe.CATEGORIES[t.categorie]}${t.etablissement ? ` · ${t.etablissement}` : ''}</p>
          <p><b>${t.depart_ville} → ${t.destination_nom}</b> (${t.destination_ville})</p>
          <p>${Zoe.jours(t.jours)} · jusqu'au ${Zoe.date(t.date_fin)}${t.heure_retour ? ` · retour ${Zoe.heure(t.heure_retour)}` : ''}</p>
          ${t.commentaire ? html`<p class="citation">« ${t.commentaire} »</p>` : ''}
          <div class="result__tags">
            <span class="tag ${t.detour_km <= 2 ? 'tag--ok' : ''}">${t.detour_km <= 2 ? 'Sur le chemin' : `Détour de ${t.detour_km} km`}</span>
            <span class="tag ${t.avance_min <= 15 ? 'tag--ok' : ''}">Arrivée ${Zoe.heure(t.heure_arrivee)}</span>
          </div>
        </div>
        <div class="result__side">
          <span class="seats">${t.places_restantes > 0 ? `${t.places_restantes} place${t.places_restantes > 1 ? 's' : ''}` : 'Complet'}</span>
          ${t.ma_reservation && t.ma_reservation !== 'annulee'
            ? badgeReservation(t.ma_reservation)
            : t.places_restantes > 0 ? html`<button class="btn btn--primary btn--sm" type="button" data-action="demander">Demander une place</button>` : ''}
        </div>
        <form class="result__demande" hidden>
          <label>Message au conducteur <small>(facultatif)</small>
            <textarea name="message" rows="2" maxlength="2000" placeholder="Bonjour, je suis en stage au même endroit…"></textarea>
          </label>
          <button class="btn btn--green btn--sm" type="submit">Envoyer ma demande</button>
        </form>
      </article>`)}`;
  }

  $('#form-recherche').addEventListener('submit', (e) => {
    e.preventDefault();
    occupe(e.submitter, rechercher);
  });

  $('#resultats').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action="demander"]');
    if (!bouton) return;
    const formulaire = $('.result__demande', bouton.closest('.result'));
    formulaire.hidden = false;
    bouton.hidden = true;
    formulaire.message.focus();
  });

  $('#resultats').addEventListener('submit', (e) => {
    e.preventDefault();
    const carte = e.target.closest('.result');
    occupe(e.submitter, async () => {
      await req(sb.rpc('demander_reservation', { p_trajet: carte.dataset.trajet, p_message: e.target.message.value }));
      toast('Demande envoyée au conducteur.');
      await rechercher();
    });
  });

  /* ---------- 3. Proposer un trajet ---------- */
  const tDepart = $('#t-depart');
  const tDestination = $('#t-destination');
  Zoe.champCommune(tDepart);
  Zoe.champCommune(tDestination);
  const formTrajet = $('#form-trajet');
  formTrajet.date_debut.min = Zoe.aujourdhui();
  formTrajet.date_debut.value = Zoe.aujourdhui();
  formTrajet.date_debut.addEventListener('change', () => { formTrajet.date_fin.min = formTrajet.date_debut.value; });

  // Suggestions : les établissements partenaires déjà connus.
  req(sb.from('etablissements_publics').select('nom').order('nom')).then((liste) => {
    $('#liste-etablissements').replaceChildren(...liste.map((e) => new Option(e.nom)));
  }).catch(() => {});

  formTrajet.addEventListener('submit', (e) => {
    e.preventDefault();
    occupe(e.submitter, async () => {
      const depart = Zoe.lireCommune(tDepart);
      const destination = Zoe.lireCommune(tDestination);
      const jours = $$('[name=jours]:checked', formTrajet).map((c) => Number(c.value));
      if (!jours.length) throw new Error('Cochez au moins un jour.');
      if (formTrajet.date_fin.value < formTrajet.date_debut.value) throw new Error('La date de fin doit suivre la date de début.');

      await req(sb.from('trajets').insert({
        conducteur_id: moi.id,
        depart_ville: depart.ville, depart_lat: depart.lat, depart_lng: depart.lng,
        destination_nom: formTrajet.destination_nom.value.trim(),
        destination_ville: destination.ville, dest_lat: destination.lat, dest_lng: destination.lng,
        date_debut: formTrajet.date_debut.value,
        date_fin: formTrajet.date_fin.value,
        jours,
        heure_arrivee: formTrajet.heure_arrivee.value,
        heure_retour: formTrajet.heure_retour.value || null,
        places: Number(formTrajet.places.value),
        detour_max_km: Number(formTrajet.detour_max_km.value),
        commentaire: formTrajet.commentaire.value.trim() || null,
      }));
      toast('Trajet publié.');
      formTrajet.reset();
      formTrajet.date_debut.value = Zoe.aujourdhui();
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
        const demandes = reservations.filter((r) => r.trajet_id === t.id && r.statut !== 'annulee');
        const prises = demandes.filter((r) => r.statut === 'acceptee').length;
        return html`
        <article class="element" data-trajet="${t.id}">
          <div class="element__tete">
            <div>${resumeTrajet(t)}</div>
            <div class="element__actions">
              <span class="seats">Places : ${prises}/${t.places}</span>
              ${t.actif ? '' : html`<span class="badge badge--annulee">En pause</span>`}
              <button class="lien" type="button" data-action="pause">${t.actif ? 'Mettre en pause' : 'Réactiver'}</button>
              <button class="lien lien--danger" type="button" data-action="supprimer">Supprimer</button>
            </div>
          </div>
          ${demandes.length ? html`<ul class="demandes">${demandes.map((r) => html`
            <li data-reservation="${r.id}" data-nom="${nomMembre(membres[r.passager_id])}">
              <span class="avatar">${membres[r.passager_id] ? Zoe.initiales(membres[r.passager_id].prenom, membres[r.passager_id].initiale) : '?'}</span>
              <div>
                <strong>${nomMembre(membres[r.passager_id])}</strong>
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

    if (action === 'messages') { ouvrirFil(ligne.dataset.reservation, ligne.dataset.nom); return; }
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
      const reservations = await req(sb.from('reservations').select('*').eq('passager_id', moi.id).order('created_at', { ascending: false }));
      if (!reservations.length) {
        zone.innerHTML = html`<div class="empty">Vous n'avez pas encore demandé de place.</div>`;
        return;
      }
      const trajets = await req(sb.from('trajets').select('*').in('id', reservations.map((r) => r.trajet_id)));
      const parId = Object.fromEntries(trajets.map((t) => [t.id, t]));
      const membres = await membresParId(trajets.map((t) => t.conducteur_id));

      zone.innerHTML = html`${reservations.filter((r) => parId[r.trajet_id]).map((r) => {
        const t = parId[r.trajet_id];
        const conducteur = nomMembre(membres[t.conducteur_id]);
        return html`
        <article class="element" data-reservation="${r.id}" data-nom="${conducteur}">
          <div class="element__tete">
            <div>
              ${resumeTrajet(t)}
              <p>Conducteur : <b>${conducteur}</b></p>
            </div>
            <div class="element__actions">
              ${badgeReservation(r.statut)}
              <button class="lien" type="button" data-action="messages">Messages</button>
              ${['demandee', 'acceptee'].includes(r.statut) ? html`<button class="lien lien--danger" type="button" data-action="annuler">Annuler</button>` : ''}
            </div>
          </div>
        </article>`;
      })}`;
    } catch (e) { Zoe.erreur(e); }
  }

  $('#mes-reservations').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const carte = bouton.closest('[data-reservation]');
    if (bouton.dataset.action === 'messages') { ouvrirFil(carte.dataset.reservation, carte.dataset.nom); return; }
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
  }

  function ouvrirFil(reservation, nom) {
    filReservation = reservation;
    $('#fil-titre').textContent = `Messages avec ${nom}`;
    $('#fil-messages').innerHTML = '';
    fil.showModal();
    chargerFil().catch(Zoe.erreur);
    // Rafraîchit la conversation toutes les 8 secondes tant qu'elle est ouverte.
    filMinuteur = setInterval(() => chargerFil().catch(() => {}), 8000);
  }

  fil.addEventListener('close', () => { clearInterval(filMinuteur); filReservation = null; });
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
    for (const champ of ['prenom', 'nom', 'ville', 'telephone', 'etablissement_declare']) {
      formProfil[champ].value = moi[champ] || '';
    }
    const methodes = { code: 'code d\'établissement', justificatif: 'justificatif', invitation: 'invitation', admin: 'l\'équipe Meet Zoe' };
    $('#profil-resume').textContent = `${Zoe.CATEGORIES[moi.categorie]} · ${moi.email} · compte vérifié par ${methodes[moi.methode_verif] || 'l\'équipe Meet Zoe'}.`;
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
      }).eq('id', moi.id).select());
      moi = maj;
      $('#compte-nom').textContent = `${moi.prenom} ${moi.nom}`;
      toast('Profil enregistré.');
    });
  });

  $('#creer-invitation').addEventListener('click', (e) => occupe(e.currentTarget, async () => {
    const code = await req(sb.rpc('creer_invitation'));
    toast(`Invitation créée : ${code}`);
    await chargerProfil();
  }));

  $('#supprimer-compte').addEventListener('click', (e) => {
    if (!confirm('Supprimer définitivement votre compte et toutes vos données ?')) return;
    occupe(e.currentTarget, async () => {
      await req(sb.rpc('supprimer_mon_compte'));
      await sb.auth.signOut();
      location.href = 'index.html';
    });
  });
})();
