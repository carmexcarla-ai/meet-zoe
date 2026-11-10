/* =========================================================
   Meet Zoe — administration
   1. Membres : vérification, suspension, rôles
   2. Établissements : quotas et abonnements
   3. Demandes de contact
   ========================================================= */
(async () => {
  const { sb, $, html, toast, occupe, req } = Zoe;

  const moi = await Zoe.exigerProfil();
  if (!moi) return;
  if (moi.statut !== 'verifie' || moi.role !== 'admin') {
    location.replace(Zoe.pageAccueil(moi));
    return;
  }

  $('#compte-nom').textContent = `${moi.prenom} ${moi.nom}`;
  $('#deconnexion').addEventListener('click', Zoe.deconnexion);
  $('#contenu').hidden = false;

  let etablissements = [];
  const chargerListeEtablissements = async () => {
    etablissements = await req(sb.from('etablissements').select('*').order('nom'));
  };
  const nomEtab = (id) => (etablissements.find((e) => e.id === id) || {}).nom;

  /* ---------- 1. Membres ---------- */
  const METHODES = { code: 'Code d\'établissement', justificatif: 'Justificatif', invitation: 'Invitation', admin: 'Administration' };
  let membres = [];

  async function chargerMembres() {
    const statut = $('#filtre-statut').value;
    let requete = sb.from('profils').select('*').order('created_at', { ascending: false }).limit(300);
    if (statut === 'conducteurs') requete = requete.eq('conducteur_statut', 'en_attente');
    else if (statut) requete = requete.eq('statut', statut);
    membres = await req(requete);

    $('#membres').innerHTML = membres.length
      ? html`${membres.map((m) => html`
        <tr data-membre="${m.id}">
          <td><strong>${m.prenom} ${m.nom}</strong><br><small>${m.email}</small><br><small>Inscrit le ${Zoe.date(m.created_at.slice(0, 10))}</small>
            ${m.photo_path ? html`<br><button class="lien" type="button" data-action="photo-voir">Voir la photo</button> <button class="lien lien--danger" type="button" data-action="photo-retirer">Retirer</button>` : ''}</td>
          <td>${Zoe.CATEGORIES[m.categorie]}<br><small>${nomEtab(m.etablissement_id) || m.etablissement_declare || '—'}</small></td>
          <td>${METHODES[m.methode_verif] || 'Aucune démarche'}
            ${m.justificatif_path ? html`<br><button class="lien" type="button" data-action="justificatif">Voir le justificatif</button>` : ''}
            ${m.conducteur_statut !== 'non' ? html`<div class="bloc-conducteur">
              <span class="badge badge--cond-${m.conducteur_statut}">${Zoe.CONDUCTEUR[m.conducteur_statut]}</span>
              ${m.conducteur_statut === 'en_attente' ? html`
                <button class="lien" type="button" data-action="doc-permis">Voir le permis</button>
                <button class="lien" type="button" data-action="doc-identite">Voir : ${Zoe.IDENTITES[m.identite_type] || 'pièce d\'identité'}</button>
                <span class="element__actions">
                  <button class="btn btn--green btn--sm" type="button" data-action="conducteur-oui">Valider le conducteur</button>
                  <button class="lien lien--danger" type="button" data-action="conducteur-non">Refuser</button>
                </span>` : ''}
            </div>` : ''}</td>
          <td><span class="badge badge--${m.statut}">${Zoe.STATUTS[m.statut]}</span></td>
          <td>${m.id === moi.id ? 'Admin (vous)' : html`
            <select data-champ="role" aria-label="Rôle">
              ${['membre', 'partenaire', 'admin'].map((r) => html`<option value="${r}" ${m.role === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`)}
            </select>
            <select data-champ="etab" aria-label="Établissement géré" ${m.role === 'partenaire' ? '' : 'hidden'}>
              <option value="">Établissement géré…</option>
              ${etablissements.map((e) => html`<option value="${e.id}" ${m.role === 'partenaire' && m.etablissement_id === e.id ? 'selected' : ''}>${e.nom}</option>`)}
            </select>
            <button class="lien" type="button" data-action="role">Appliquer</button>`}</td>
          <td class="tableau__actions">${m.id === moi.id ? '' : html`
            ${m.statut !== 'verifie' ? html`<button class="btn btn--green btn--sm" type="button" data-action="verifie">${m.statut === 'suspendu' ? 'Réactiver' : 'Valider'}</button>` : ''}
            ${m.statut === 'en_attente' ? html`<button class="lien lien--danger" type="button" data-action="refuse">Refuser</button>` : ''}
            ${m.statut === 'verifie' ? html`<button class="lien lien--danger" type="button" data-action="suspendu">Suspendre</button>` : ''}`}</td>
        </tr>`)}`
      : html`<tr><td colspan="6" class="aide">Aucun membre dans cette liste.</td></tr>`;
  }

  $('#filtre-statut').addEventListener('change', () => chargerMembres().catch(Zoe.erreur));

  // Le choix de l'établissement n'apparaît que pour le rôle « partenaire ».
  $('#membres').addEventListener('change', (e) => {
    if (e.target.dataset.champ !== 'role') return;
    e.target.closest('tr').querySelector('[data-champ="etab"]').hidden = e.target.value !== 'partenaire';
  });

  $('#membres').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const ligne = bouton.closest('tr');
    const membre = membres.find((m) => m.id === ligne.dataset.membre);
    const action = bouton.dataset.action;

    occupe(bouton, async () => {
      if (action === 'justificatif') {
        // Lien temporaire (2 minutes) vers le fichier privé.
        const { signedUrl } = await req(sb.storage.from('justificatifs').createSignedUrl(membre.justificatif_path, 120));
        window.open(signedUrl, '_blank', 'noopener');
        return;
      }
      if (action === 'doc-permis' || action === 'doc-identite') {
        const chemin = action === 'doc-permis' ? membre.permis_path : membre.identite_path;
        const { signedUrl } = await req(sb.storage.from('documents-conducteur').createSignedUrl(chemin, 120));
        window.open(signedUrl, '_blank', 'noopener');
        return;
      }
      if (action === 'conducteur-oui' || action === 'conducteur-non') {
        const valider = action === 'conducteur-oui';
        if (!valider && !confirm(`Refuser ${membre.prenom} ${membre.nom} comme conducteur ?`)) return;
        await req(sb.rpc('admin_valider_conducteur', { p_membre: membre.id, p_valider: valider }));
        // Le contrôle est fait : le permis et la pièce d'identité sont effacés.
        const fichiers = [membre.permis_path, membre.identite_path].filter(Boolean);
        if (fichiers.length) await sb.storage.from('documents-conducteur').remove(fichiers);
        toast(valider ? 'Conducteur validé. Documents effacés.' : 'Conducteur refusé. Documents effacés.');
        await chargerMembres();
        return;
      }
      if (action === 'photo-voir') {
        const { signedUrl } = await req(sb.storage.from('photos').createSignedUrl(membre.photo_path, 120));
        window.open(signedUrl, '_blank', 'noopener');
        return;
      }
      if (action === 'photo-retirer') {
        if (!confirm(`Retirer la photo de ${membre.prenom} ${membre.nom} ?`)) return;
        await req(sb.rpc('admin_retirer_photo', { p_membre: membre.id }));
        await sb.storage.from('photos').remove([membre.photo_path]);
        toast('Photo retirée.');
        await chargerMembres();
        return;
      }
      if (action === 'role') {
        const role = ligne.querySelector('[data-champ="role"]').value;
        const etab = ligne.querySelector('[data-champ="etab"]').value || null;
        await req(sb.rpc('admin_definir_role', { p_membre: membre.id, p_role: role, p_etablissement: role === 'partenaire' ? etab : null }));
        toast('Rôle mis à jour.');
      } else {
        if (action === 'suspendu' && !confirm(`Suspendre ${membre.prenom} ${membre.nom} ?`)) return;
        await req(sb.rpc('admin_definir_statut', { p_membre: membre.id, p_statut: action }));
        // Une fois la décision prise, le justificatif n'a plus à être conservé.
        if (membre.justificatif_path && ['verifie', 'refuse'].includes(action)) {
          await sb.storage.from('justificatifs').remove([membre.justificatif_path]);
        }
        toast({ verifie: 'Membre vérifié.', refuse: 'Demande refusée.', suspendu: 'Membre suspendu.' }[action]);
      }
      await chargerMembres();
    });
  });

  /* ---------- 2. Établissements ---------- */
  const formEtab = $('#form-etab');
  const champVille = $('#e-ville');
  Zoe.champCommune(champVille);

  async function chargerEtablissements() {
    await chargerListeEtablissements();
    const rattaches = await req(sb.from('profils').select('etablissement_id').eq('role', 'membre').eq('statut', 'verifie').not('etablissement_id', 'is', null));
    const compte = {};
    rattaches.forEach((p) => { compte[p.etablissement_id] = (compte[p.etablissement_id] || 0) + 1; });

    $('#etablissements').innerHTML = etablissements.length
      ? html`${etablissements.map((e) => html`
        <tr data-etab="${e.id}">
          <td><strong>${e.nom}</strong><br><small>${Zoe.TYPES_ETAB[e.type]} · ${e.ville}</small></td>
          <td>${compte[e.id] || 0} / ${e.quota}</td>
          <td>${Zoe.FORMULES[e.formule]}</td>
          <td><span class="badge badge--abo-${e.abonnement_statut}">${Zoe.ABONNEMENTS[e.abonnement_statut]}</span>
            ${e.abonnement_fin ? html`<br><small>jusqu'au ${Zoe.date(e.abonnement_fin)}</small>` : ''}</td>
          <td class="tableau__actions">
            <button class="lien" type="button" data-action="code">Créer un code</button>
            <button class="lien" type="button" data-action="modifier">Modifier</button>
            <button class="lien lien--danger" type="button" data-action="supprimer">Supprimer</button>
          </td>
        </tr>`)}`
      : html`<tr><td colspan="5" class="aide">Aucun établissement. Ajoutez le premier ci-dessus.</td></tr>`;
  }

  function viderFormEtab() {
    formEtab.reset();
    formEtab.etab_id.value = '';
    delete champVille.dataset.lat;
    delete champVille.dataset.lng;
    $('#form-etab-titre').textContent = 'Ajouter un établissement';
    $('#etab-annuler').hidden = true;
  }
  $('#etab-annuler').addEventListener('click', viderFormEtab);

  formEtab.addEventListener('submit', (e) => {
    e.preventDefault();
    occupe(e.submitter, async () => {
      const commune = Zoe.lireCommune(champVille);
      const valeurs = {
        nom: formEtab.nom.value.trim(),
        type: formEtab.type.value,
        ville: commune.ville, lat: commune.lat, lng: commune.lng,
        quota: Number(formEtab.quota.value),
        formule: formEtab.formule.value,
        abonnement_statut: formEtab.abonnement_statut.value,
        abonnement_fin: formEtab.abonnement_fin.value || null,
      };
      if (formEtab.etab_id.value) await req(sb.from('etablissements').update(valeurs).eq('id', formEtab.etab_id.value));
      else await req(sb.from('etablissements').insert(valeurs));
      toast('Établissement enregistré.');
      viderFormEtab();
      await chargerEtablissements();
    });
  });

  $('#etablissements').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const etab = etablissements.find((x) => x.id === bouton.closest('tr').dataset.etab);
    const action = bouton.dataset.action;

    if (action === 'modifier') {
      formEtab.etab_id.value = etab.id;
      for (const champ of ['nom', 'type', 'quota', 'formule', 'abonnement_statut']) formEtab[champ].value = etab[champ];
      formEtab.abonnement_fin.value = etab.abonnement_fin || '';
      champVille.value = etab.ville;
      champVille.dataset.lat = etab.lat;
      champVille.dataset.lng = etab.lng;
      $('#form-etab-titre').textContent = `Modifier ${etab.nom}`;
      $('#etab-annuler').hidden = false;
      formEtab.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'supprimer' && !confirm(`Supprimer ${etab.nom} et ses codes d'accès ? Les membres déjà vérifiés conservent leur compte.`)) return;

    occupe(bouton, async () => {
      if (action === 'code') {
        const code = await req(sb.rpc('creer_code', { p_libelle: 'Créé par l\'administration', p_max: null, p_expire: null, p_etablissement: etab.id }));
        prompt(`Code d'accès pour ${etab.nom} (copiez-le) :`, code);
      } else {
        await req(sb.from('etablissements').delete().eq('id', etab.id));
        toast('Établissement supprimé.');
        await chargerEtablissements();
      }
    });
  });

  /* ---------- 3. Demandes de contact ---------- */
  async function chargerContacts() {
    const demandes = await req(sb.from('demandes_contact').select('*').order('created_at', { ascending: false }).limit(200));
    $('#contacts').innerHTML = demandes.length
      ? html`${demandes.map((d) => html`
        <article class="element" data-contact="${d.id}" data-traitee="${d.traitee}">
          <div class="element__tete">
            <div>
              <strong>${d.nom}</strong>${d.organisme ? ` · ${d.organisme}` : ''}
              <p><a href="mailto:${d.email}">${d.email}</a> · ${Zoe.dateHeure(d.created_at)}</p>
              ${d.message ? html`<p class="citation">${d.message}</p>` : ''}
            </div>
            <div class="element__actions">
              <span class="badge ${d.traitee ? 'badge--acceptee' : 'badge--demandee'}">${d.traitee ? 'Traitée' : 'À traiter'}</span>
              <button class="lien" type="button" data-action="basculer">${d.traitee ? 'Rouvrir' : 'Marquer traitée'}</button>
              <button class="lien lien--danger" type="button" data-action="supprimer">Supprimer</button>
            </div>
          </div>
        </article>`)}`
      : html`<div class="empty">Aucune demande de contact.</div>`;
  }

  $('#contacts').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const carte = bouton.closest('[data-contact]');
    if (bouton.dataset.action === 'supprimer' && !confirm('Supprimer cette demande ?')) return;
    occupe(bouton, async () => {
      if (bouton.dataset.action === 'basculer') {
        await req(sb.from('demandes_contact').update({ traitee: carte.dataset.traitee !== 'true' }).eq('id', carte.dataset.contact));
      } else {
        await req(sb.from('demandes_contact').delete().eq('id', carte.dataset.contact));
      }
      await chargerContacts();
    });
  });

  /* ---------- 4. Modération : signalements et avis ---------- */
  async function chargerModeration() {
    const signalements = await req(sb.from('signalements').select('*').order('created_at', { ascending: false }).limit(100));
    const ids = [...new Set(signalements.flatMap((s) => [s.auteur_id, s.cible_id]).filter(Boolean))];
    const noms = ids.length ? Object.fromEntries((await req(sb.from('profils').select('id, prenom, nom, statut').in('id', ids))).map((p) => [p.id, p])) : {};
    const nom = (id) => (noms[id] ? `${noms[id].prenom} ${noms[id].nom}` : 'Compte supprimé');

    $('#signalements').innerHTML = signalements.length
      ? html`${signalements.map((s) => html`
        <article class="element" data-signalement="${s.id}" data-cible="${s.cible_id}" data-traite="${s.statut === 'traite'}">
          <div class="element__tete">
            <div>
              <strong>${nom(s.cible_id)}</strong> signalé par ${nom(s.auteur_id)}
              <p>${Zoe.dateHeure(s.created_at)}${noms[s.cible_id] ? ` · compte ${Zoe.STATUTS[noms[s.cible_id].statut].toLowerCase()}` : ''}</p>
              <p class="citation">${s.motif}</p>
            </div>
            <div class="element__actions">
              <span class="badge ${s.statut === 'traite' ? 'badge--acceptee' : 'badge--demandee'}">${s.statut === 'traite' ? 'Traité' : 'À traiter'}</span>
              ${noms[s.cible_id] && noms[s.cible_id].statut === 'verifie' ? html`<button class="lien lien--danger" type="button" data-action="suspendre">Suspendre le membre</button>` : ''}
              <button class="lien" type="button" data-action="basculer">${s.statut === 'traite' ? 'Rouvrir' : 'Marquer traité'}</button>
            </div>
          </div>
        </article>`)}`
      : html`<div class="empty">Aucun signalement.</div>`;

    const ouverts = signalements.filter((s) => s.statut === 'ouvert').length;
    $('#pastille-moderation').hidden = ouverts === 0;
    $('#pastille-moderation').textContent = ouverts;

    const avis = await req(sb.rpc('admin_avis'));
    $('#avis').innerHTML = avis.length
      ? html`${avis.map((a) => html`
        <article class="element" data-avis="${a.id}" data-masque="${a.masque}">
          <div class="element__tete">
            <div>
              <strong>${'★'.repeat(a.note)}</strong> pour ${a.cible}, par ${a.auteur}
              <p>${Zoe.dateHeure(a.created_at)}</p>
              ${a.commentaire ? html`<p class="citation">${a.commentaire}</p>` : ''}
            </div>
            <div class="element__actions">
              ${a.masque ? html`<span class="badge badge--annulee">Masqué</span>` : ''}
              <button class="lien ${a.masque ? '' : 'lien--danger'}" type="button" data-action="masquer">${a.masque ? 'Réafficher' : 'Masquer'}</button>
            </div>
          </div>
        </article>`)}`
      : html`<div class="empty">Aucun avis pour l'instant.</div>`;
  }

  $('[data-panneau="moderation"]').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const carte = bouton.closest('.element');
    const action = bouton.dataset.action;
    if (action === 'suspendre' && !confirm('Suspendre ce membre ? Il perdra immédiatement l\'accès aux trajets.')) return;
    occupe(bouton, async () => {
      if (action === 'masquer') {
        await req(sb.rpc('admin_masquer_avis', { p_avis: carte.dataset.avis, p_masquer: carte.dataset.masque !== 'true' }));
      } else if (action === 'suspendre') {
        await req(sb.rpc('admin_definir_statut', { p_membre: carte.dataset.cible, p_statut: 'suspendu' }));
        toast('Membre suspendu.');
      } else {
        await req(sb.from('signalements').update({ statut: carte.dataset.traite === 'true' ? 'ouvert' : 'traite' }).eq('id', carte.dataset.signalement));
      }
      await chargerModeration();
    });
  });

  /* ---------- 5. Journal ---------- */
  async function chargerJournal() {
    const lignes = await req(sb.from('journal_admin').select('*').order('created_at', { ascending: false }).limit(200));
    const ids = [...new Set(lignes.flatMap((l) => [l.admin_id, l.cible_id]).filter(Boolean))];
    const noms = ids.length ? Object.fromEntries((await req(sb.from('profils').select('id, prenom, nom').in('id', ids))).map((p) => [p.id, `${p.prenom} ${p.nom}`])) : {};
    $('#journal').innerHTML = lignes.length
      ? html`${lignes.map((l) => html`<tr>
          <td>${Zoe.dateHeure(l.created_at)}</td>
          <td>${noms[l.admin_id] || '—'}</td>
          <td>${l.action}</td>
          <td>${l.cible_id ? (noms[l.cible_id] || 'Compte supprimé') : (l.detail || '—')}</td>
        </tr>`)}`
      : html`<tr><td colspan="4" class="aide">Aucune action enregistrée.</td></tr>`;
  }

  /* ---------- Démarrage ---------- */
  const chargeurs = { membres: chargerMembres, etablissements: chargerEtablissements, contacts: chargerContacts, moderation: chargerModeration, journal: chargerJournal };
  Zoe.onglets($('#onglets'), (nom) => chargeurs[nom]().catch(Zoe.erreur));
  try {
    await chargerListeEtablissements();
    await chargerMembres();
    // Pastille des signalements à traiter, dès l'arrivée.
    const { count } = await sb.from('signalements').select('id', { count: 'exact', head: true }).eq('statut', 'ouvert');
    $('#pastille-moderation').hidden = !count;
    $('#pastille-moderation').textContent = count || '';
  } catch (e) { Zoe.erreur(e); }
})();
