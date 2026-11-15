/* =========================================================
   Meet Zoe — administration
   1. Membres : vérification, suspension, rôles
   2. Établissements : quotas et abonnements
   3. Demandes de contact
   4. Modération, 5. Journal et entretien, 6. Tableau de bord
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

  /* ---------- Version de la base ---------- */
  // Si la base n'a pas reçu la dernière version du script SQL, on le dit tout de suite.
  async function verifierVersion() {
    let aJour = true;
    try {
      const { data, error } = await sb.rpc('version_base');
      const absente = error && ['PGRST202', '42883'].includes(error.code);
      // Une simple coupure de réseau n'affiche pas le bandeau.
      aJour = !absente && (error ? true : Number(data) >= Zoe.VERSION_BASE);
    } catch { /* coupure de réseau : rien à signaler ici */ }
    if (aJour || $('#alerte-version')) return;
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="alerte alerte--config" id="alerte-version" role="alert"><strong>La base de données n\'est pas à jour.</strong> '
      + 'Recollez le fichier <code>supabase/schema.sql</code> dans l\'éditeur SQL de Supabase, puis rechargez cette page.</div>');
  }
  verifierVersion();
  // Les alertes destinées à l'administration sont considérées comme lues dès l'ouverture.
  sb.rpc('marquer_notifications', { p_onglet: 'admin' }).then(() => {}, () => {});

  /* ---------- Outils ---------- */
  const pluriel = (n, singulier, plurielle) => `${n} ${n > 1 ? plurielle : singulier}`;
  // Comptage exact, sans charger les lignes (aucun plafond).
  const compter = async (table, filtre = (q) => q) => {
    const { count, error } = await filtre(sb.from(table).select('*', { count: 'exact', head: true }));
    if (error) throw error;
    return count || 0;
  };
  // Lit toutes les lignes d'une requête, par paquets de 1000 (plafond du service).
  async function toutLire(fabrique) {
    const lignes = [];
    for (let debut = 0; ; debut += 1000) {
      const lot = await req(fabrique().range(debut, debut + 999));
      lignes.push(...lot);
      if (lot.length < 1000) return lignes;
    }
  }
  // Question « pourquoi ? » : une liste de motifs courts et une précision facultative.
  // Renvoie null si la personne annule, sinon le motif à montrer au membre.
  async function demanderMotif({ titre, texte, motifs, valider }) {
    const net = (t) => t.replace(/[.\s]+$/, '');   // pas de point final : la phrase affichée en ajoute un
    const r = await Zoe.demander({
      titre, texte, choix: motifs, zone: true, zoneLabel: 'Précision (facultatif)', valider, danger: true, max: 120,
      verifier: (x) => (x.choix === 'Autre' && !net(x.texte) ? 'Pour le motif « Autre », écrivez une précision.' : ''),
    });
    if (!r) return null;
    const precision = net(r.texte);
    if (r.choix === 'Autre') return precision;
    return precision ? `${r.choix} : ${precision}` : r.choix;
  }
  // Décision enregistrée après l'effacement des fichiers : si elle échoue, on dit quoi faire.
  async function decider(appel) {
    const { error } = await appel;
    if (!error) return;
    console.error(error);
    const message = Zoe.messageErreur(error);
    throw new Error(/^Une erreur est survenue|^Connexion impossible/.test(message)
      ? 'Le document est effacé mais la décision n\'a pas été enregistrée : cliquez de nouveau sur le même bouton.'
      : message);
  }
  // Efface les fichiers d'un membre et vérifie qu'il n'en reste aucun.
  // En cas d'échec, rien ne doit être enregistré ensuite.
  async function effacerFichiers(espace, membreId, quoi) {
    try {
      await Zoe.viderDossier(espace, membreId);
    } catch (e) {
      console.error(e);
      throw new Error(`${quoi} du stockage a échoué : la décision n'a pas été enregistrée. Réessayez dans un instant.`);
    }
  }
  const MOTIFS_JUSTIFICATIF = ['Document illisible', 'Document sans rapport avec une formation ou un emploi dans le soin', 'Document expiré ou trop ancien', 'Nom différent de celui du compte', 'Autre'];
  const MOTIFS_CONDUCTEUR = ['Permis illisible', 'Pièce d\'identité illisible', 'Document expiré', 'Nom différent de celui du compte', 'Autre'];
  const MOTIFS_SUSPENSION = ['Comportement signalé par d\'autres membres', 'Non-respect des règles du covoiturage', 'Informations du compte inexactes', 'Autre'];
  const demanderSuspension = (nom) => demanderMotif({
    titre: `Suspendre ${nom} ?`,
    texte: 'Cette personne perdra immédiatement l\'accès aux trajets. Le motif lui sera montré.',
    motifs: MOTIFS_SUSPENSION, valider: 'Suspendre',
  });

  /* ---------- Ce qui attend ---------- */
  let montrerOnglet = () => {};
  async function chargerAttente() {
    const [justificatifs, conducteurs, signalements, contacts] = await Promise.all([
      compter('profils', (q) => q.eq('statut', 'en_attente').not('justificatif_path', 'is', null)),
      compter('profils', (q) => q.eq('conducteur_statut', 'en_attente')),
      compter('signalements', (q) => q.eq('statut', 'ouvert')),
      compter('demandes_contact', (q) => q.eq('traitee', false)),
    ]);
    const pastille = (id, n) => { $(id).hidden = n === 0; $(id).textContent = n || ''; };
    pastille('#pastille-membres', justificatifs + conducteurs);
    pastille('#pastille-moderation', signalements);
    pastille('#pastille-contacts', contacts);

    const lignes = [
      [pluriel(justificatifs, 'justificatif à examiner', 'justificatifs à examiner'), 'membres', 'justificatifs'],
      [pluriel(conducteurs, 'conducteur à contrôler', 'conducteurs à contrôler'), 'membres', 'conducteurs'],
      [pluriel(signalements, 'signalement ouvert', 'signalements ouverts'), 'moderation', ''],
      [pluriel(contacts, 'message de contact à traiter', 'messages de contact à traiter'), 'contacts', ''],
    ];
    $('#a-faire-liste').innerHTML = justificatifs + conducteurs + signalements + contacts
      ? html`${lignes.map(([libelle, onglet, filtre]) => html`
        <li><b>${libelle}</b><button class="lien" type="button" data-aller="${onglet}" data-filtre="${filtre}">Ouvrir</button></li>`)}`
      : html`<li class="aide">Rien n'attend.</li>`;
  }
  // Rappel sur le tableau de bord si la clé du service d'e-mails n'est pas enregistrée.
  sb.rpc('etat_emails').then(({ data }) => { if (data) $('#a-faire-emails').hidden = data.cle; }, () => {});
  // Après une action, les compteurs sont recalculés sans bloquer la suite.
  const majAttente = () => chargerAttente().catch((e) => console.error(e));

  $('#a-faire-liste').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-aller]');
    if (!bouton) return;
    if (bouton.dataset.filtre) {
      $('#filtre-statut').value = bouton.dataset.filtre;
      $('#recherche-membre').value = '';
    }
    montrerOnglet(bouton.dataset.aller);
  });

  let etablissements = [];
  const chargerListeEtablissements = async () => {
    etablissements = await req(sb.from('etablissements').select('*').order('nom'));
  };
  const nomEtab = (id) => (etablissements.find((e) => e.id === id) || {}).nom;

  /* ---------- 1. Membres ---------- */
  const METHODES = { code: 'Code d\'établissement', justificatif: 'Justificatif', invitation: 'Invitation', admin: 'Administration' };
  let membres = [];

  const LIMITE_MEMBRES = 300;
  // Pour la recherche : minuscules, sans accents.
  const simplifier = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  async function chargerMembres() {
    const statut = $('#filtre-statut').value;
    let requete = sb.from('profils').select('*').order('created_at', { ascending: false }).limit(LIMITE_MEMBRES);
    if (statut === 'a_controler') requete = requete.or('and(statut.eq.en_attente,justificatif_path.not.is.null),conducteur_statut.eq.en_attente');
    else if (statut === 'justificatifs') requete = requete.eq('statut', 'en_attente').not('justificatif_path', 'is', null);
    else if (statut === 'conducteurs') requete = requete.eq('conducteur_statut', 'en_attente');
    else if (statut) requete = requete.eq('statut', statut);
    membres = await req(requete);
    afficherMembres();
  }

  // Affiche la liste chargée, réduite à ce qui est tapé dans la recherche.
  function afficherMembres() {
    const mots = simplifier($('#recherche-membre').value).split(/\s+/).filter(Boolean);
    const visibles = mots.length
      ? membres.filter((m) => { const fiche = simplifier(`${m.prenom} ${m.nom} ${m.email}`); return mots.every((mot) => fiche.includes(mot)); })
      : membres;
    $('#membres-note').textContent = `${pluriel(visibles.length, 'membre affiché', 'membres affichés')}.`
      + (membres.length >= LIMITE_MEMBRES ? ` Seuls les ${LIMITE_MEMBRES} inscrits les plus récents de cette liste sont chargés : la recherche ne porte que sur eux.` : '');

    $('#membres').innerHTML = visibles.length
      ? html`${visibles.map((m) => html`
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
              ${m.conducteur_statut === 'refuse' ? html`<small class="motif">${m.conducteur_motif ? `Motif : ${m.conducteur_motif}` : 'Aucun motif enregistré'}</small>` : ''}
            </div>` : ''}</td>
          <td><span class="badge badge--${m.statut}">${Zoe.STATUTS[m.statut]}</span>
            ${['refuse', 'suspendu'].includes(m.statut) ? html`<small class="motif">${m.motif_refus ? `Motif : ${m.motif_refus}` : 'Aucun motif enregistré'}</small>` : ''}</td>
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
            ${m.statut === 'en_attente' && m.justificatif_path ? html`<button class="lien lien--danger" type="button" data-action="refuse">Refuser</button>` : ''}
            ${m.statut === 'verifie' ? html`<button class="lien lien--danger" type="button" data-action="suspendu">Suspendre</button>` : ''}`}</td>
        </tr>`)}`
      : html`<tr><td colspan="6" class="aide">${!mots.length ? 'Aucun membre dans cette liste.' : $('#filtre-statut').value !== '' ? 'Aucun membre ne correspond dans cette liste. Pour chercher parmi tous les membres, choisissez « Tous » dans « Afficher ».' : 'Aucun membre ne correspond à cette recherche.'}</td></tr>`;
  }

  $('#filtre-statut').addEventListener('change', () => chargerMembres().catch(Zoe.erreur));
  $('#recherche-membre').addEventListener('input', afficherMembres);

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
    if (!membre) return;
    const nomComplet = `${membre.prenom} ${membre.nom}`;
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
        let motif = null;
        if (!valider) {
          motif = await demanderMotif({
            titre: `Refuser ${nomComplet} comme conducteur ?`,
            texte: 'Le motif sera montré à cette personne. Son permis et sa pièce d\'identité seront effacés.',
            motifs: MOTIFS_CONDUCTEUR, valider: 'Refuser',
          });
          if (motif === null) return;
        }
        // Le contrôle est fait : on efface d'abord le permis et la pièce d'identité,
        // on vérifie qu'il n'en reste rien, puis seulement on enregistre la décision.
        await effacerFichiers('documents-conducteur', membre.id, 'L\'effacement des documents');
        await decider(sb.rpc('admin_valider_conducteur', { p_membre: membre.id, p_valider: valider, p_motif: motif }));
        toast(valider ? 'Conducteur validé. Documents effacés.' : 'Conducteur refusé. Documents effacés.');
        await chargerMembres();
        majAttente();
        return;
      }
      if (action === 'photo-voir') {
        const { signedUrl } = await req(sb.storage.from('photos').createSignedUrl(membre.photo_path, 120));
        window.open(signedUrl, '_blank', 'noopener');
        return;
      }
      if (action === 'photo-retirer') {
        const accord = await Zoe.demander({ titre: `Retirer la photo de ${nomComplet} ?`, texte: 'La photo ne sera plus visible des autres membres.', valider: 'Retirer la photo', danger: true });
        if (!accord) return;
        await req(sb.rpc('admin_retirer_photo', { p_membre: membre.id }));
        const { error } = await sb.storage.from('photos').remove([membre.photo_path]);
        if (error) toast('Photo retirée de la fiche, mais le fichier n\'a pas pu être effacé. Utilisez « Nettoyer » dans l\'onglet Journal.', 'err');
        else toast('Photo retirée.');
        await chargerMembres();
        return;
      }
      if (action === 'role') {
        const role = ligne.querySelector('[data-champ="role"]').value;
        const etab = ligne.querySelector('[data-champ="etab"]').value || null;
        if (role === 'admin' && membre.role !== 'admin') {
          const accord = await Zoe.demander({
            titre: `Donner le rôle d'administrateur à ${nomComplet} ?`,
            texte: 'Cette personne pourra tout faire sur le site : consulter les justificatifs et les documents des conducteurs, valider ou suspendre des membres, modifier les établissements et donner des rôles. Ne confirmez que si vous lui faites entièrement confiance.',
            valider: 'Oui, donner ce rôle', danger: true,
          });
          if (!accord) { await chargerMembres(); return; }
        }
        await req(sb.rpc('admin_definir_role', { p_membre: membre.id, p_role: role, p_etablissement: role === 'partenaire' ? etab : null }));
        toast('Rôle mis à jour.');
      } else {
        if (!['verifie', 'refuse', 'suspendu'].includes(action)) return;
        let motif = null;
        if (action === 'suspendu') {
          motif = await demanderSuspension(nomComplet);
          if (motif === null) return;
        }
        if (action === 'refuse') {
          motif = await demanderMotif({
            titre: `Refuser la demande de ${nomComplet} ?`,
            texte: 'Le motif sera montré à cette personne, qui pourra envoyer un autre justificatif. Le document actuel sera effacé.',
            motifs: MOTIFS_JUSTIFICATIF, valider: 'Refuser',
          });
          if (motif === null) return;
        }
        // Une fois la décision prise, le justificatif n'a plus à être conservé :
        // on l'efface d'abord, on vérifie, puis seulement on enregistre la décision.
        const effacer = ['verifie', 'refuse'].includes(action);
        if (effacer) await effacerFichiers('justificatifs', membre.id, 'L\'effacement du justificatif');
        await decider(sb.rpc('admin_definir_statut', { p_membre: membre.id, p_statut: action, p_motif: motif }));
        toast({ verifie: 'Membre vérifié.', refuse: 'Demande refusée.', suspendu: 'Membre suspendu.' }[action] + (effacer && membre.justificatif_path ? ' Justificatif effacé.' : ''));
      }
      await chargerMembres();
      majAttente();
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
            <button class="lien" type="button" data-action="code">Codes et QR codes</button>
            <button class="lien" type="button" data-action="modifier">Modifier</button>
            <button class="lien lien--danger" type="button" data-action="supprimer">Supprimer</button>
          </td>
        </tr>`)}`
      : html`<tr><td colspan="5" class="aide">Aucun établissement. Ajoutez le premier ci-dessus.</td></tr>`;
  }

  // Un code désactivé, expiré ou complet ne permet plus de s'inscrire.
  const etatCode = (c) => (!c.actif ? 'Désactivé'
    : c.expire_le && c.expire_le < Zoe.aujourdhui() ? 'Expiré'
      : c.max_utilisations && c.utilisations >= c.max_utilisations ? 'Complet' : 'Actif');

  function viderFormEtab() {
    formEtab.reset();
    formEtab.etab_id.value = '';
    for (const cle of ['lat', 'lng', 'ville', 'precis']) delete champVille.dataset[cle];
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
      champVille.dataset.ville = etab.ville;
      delete champVille.dataset.precis;
      $('#form-etab-titre').textContent = `Modifier ${etab.nom}`;
      $('#etab-annuler').hidden = false;
      formEtab.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'code') { ouvrirCodes(etab).catch(Zoe.erreur); return; }
    if (action !== 'supprimer') return;

    occupe(bouton, async () => {
      const accord = await Zoe.demander({
        titre: `Supprimer ${etab.nom} ?`,
        texte: 'Ses codes d\'accès seront supprimés aussi. Les membres déjà vérifiés conservent leur compte. Le compte partenaire qui le gère n\'aura plus accès à son espace partenaire.',
        valider: 'Supprimer', danger: true,
      });
      if (!accord) return;
      await req(sb.from('etablissements').delete().eq('id', etab.id));
      toast('Établissement supprimé.');
      await chargerEtablissements();
    });
  });

  /* Codes d'accès d'un établissement : liste, création, lien et QR code */
  const fenetreCodes = $('#codes-etab');
  let etabCodes = null;
  $('#codes-fermer').addEventListener('click', () => fenetreCodes.close());

  async function listerCodes() {
    const codes = await req(sb.from('codes_acces').select('*').eq('etablissement_id', etabCodes.id).order('created_at', { ascending: false }));
    $('#codes-liste').innerHTML = codes.length
      ? html`${codes.map((c) => html`
        <li data-code="${c.code}" data-id="${c.id}" data-actif="${c.actif}">
          <div><code>${c.code}</code> <span class="badge ${etatCode(c) === 'Actif' ? 'badge--acceptee' : 'badge--annulee'}">${etatCode(c)}</span>
            <small>${c.libelle || 'Sans nom'} · ${pluriel(c.utilisations, 'inscription', 'inscriptions')}${c.actif ? '' : ' · ce code ne permet plus de s\'inscrire'}</small></div>
          <div class="element__actions">
            ${etatCode(c) === 'Actif' ? html`<button class="btn btn--ghost btn--sm" type="button" data-action="partager">Lien et QR code</button>` : ''}
            <button class="lien ${c.actif ? 'lien--danger' : ''}" type="button" data-action="basculer">${c.actif ? 'Désactiver' : 'Réactiver'}</button>
          </div>
        </li>`)}`
      : html`<li class="aide">Aucun code pour cet établissement. Créez le premier ci-dessus.</li>`;
  }

  async function ouvrirCodes(etab) {
    etabCodes = etab;
    $('#codes-titre').textContent = `Codes d'accès · ${etab.nom}`;
    $('#codes-liste').innerHTML = '';
    fenetreCodes.showModal();
    await listerCodes();
  }

  $('#codes-form').addEventListener('submit', (e) => {
    e.preventDefault();
    occupe(e.submitter, async () => {
      const code = await req(sb.rpc('creer_code', { p_libelle: e.target.libelle.value, p_max: null, p_expire: null, p_etablissement: etabCodes.id }));
      e.target.reset();
      await listerCodes();
      Zoe.partagerCode(code, etabCodes.nom);
    });
  });

  $('#codes-liste').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const ligne = bouton.closest('[data-code]');
    if (bouton.dataset.action === 'partager') { Zoe.partagerCode(ligne.dataset.code, etabCodes.nom); return; }
    occupe(bouton, async () => {
      const activer = ligne.dataset.actif !== 'true';
      const modifies = await req(sb.from('codes_acces').update({ actif: activer }).eq('id', ligne.dataset.id).select('id'));
      if (!modifies.length) throw new Error('Le code n\'a pas pu être modifié. Rechargez la page, puis réessayez.');
      toast(activer ? 'Code réactivé.' : 'Code désactivé : il ne permet plus de s\'inscrire.');
      await listerCodes();
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
    occupe(bouton, async () => {
      if (bouton.dataset.action === 'supprimer') {
        const accord = await Zoe.demander({ titre: 'Supprimer cette demande ?', texte: 'Le message sera effacé définitivement.', valider: 'Supprimer', danger: true });
        if (!accord) return;
      }
      if (bouton.dataset.action === 'basculer') {
        await req(sb.from('demandes_contact').update({ traitee: carte.dataset.traitee !== 'true' }).eq('id', carte.dataset.contact));
      } else {
        await req(sb.from('demandes_contact').delete().eq('id', carte.dataset.contact));
      }
      await chargerContacts();
      majAttente();
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
        <article class="element" data-signalement="${s.id}" data-cible="${s.cible_id}" data-nom="${noms[s.cible_id] ? nom(s.cible_id) : ''}" data-traite="${s.statut === 'traite'}">
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
    occupe(bouton, async () => {
      if (action === 'masquer') {
        await req(sb.rpc('admin_masquer_avis', { p_avis: carte.dataset.avis, p_masquer: carte.dataset.masque !== 'true' }));
      } else if (action === 'suspendre') {
        const motif = await demanderSuspension(carte.dataset.nom || 'ce membre');
        if (motif === null) return;
        await req(sb.rpc('admin_definir_statut', { p_membre: carte.dataset.cible, p_statut: 'suspendu', p_motif: motif }));
        toast('Membre suspendu.');
      } else {
        await req(sb.from('signalements').update({ statut: carte.dataset.traite === 'true' ? 'ouvert' : 'traite' }).eq('id', carte.dataset.signalement));
      }
      await chargerModeration();
      majAttente();
    });
  });

  /* ---------- 5. Journal et entretien ---------- */
  // Les actions sont enregistrées par la base avec des mots techniques : on les traduit.
  const ACTIONS_STATUT = { verifie: 'Membre vérifié', refuse: 'Demande refusée', suspendu: 'Membre suspendu', en_attente: 'Membre remis en attente' };
  const ACTIONS_ROLE = { membre: 'Rôle donné : membre', partenaire: 'Rôle donné : partenaire', admin: 'Rôle donné : administrateur' };
  function libelleAction(action) {
    const statut = /^Statut du membre : (\w+)$/.exec(action);
    if (statut) return ACTIONS_STATUT[statut[1]] || 'Statut du membre modifié';
    const role = /^Rôle du membre : (\w+)$/.exec(action);
    if (role) return ACTIONS_ROLE[role[1]] || 'Rôle du membre modifié';
    return action;
  }
  const libelleDetail = (detail) => String(detail || '')
    .replace(/abonnement (essai|actif|suspendu|termine)\b/, (tout, etat) => `abonnement ${Zoe.ABONNEMENTS[etat].toLowerCase()}`);

  async function chargerJournal() {
    const lignes = await req(sb.from('journal_admin').select('*').order('created_at', { ascending: false }).limit(200));
    const ids = [...new Set(lignes.flatMap((l) => [l.admin_id, l.cible_id]).filter(Boolean))];
    const noms = ids.length ? Object.fromEntries((await req(sb.from('profils').select('id, prenom, nom').in('id', ids))).map((p) => [p.id, `${p.prenom} ${p.nom}`])) : {};
    $('#journal').innerHTML = lignes.length
      ? html`${lignes.map((l) => html`<tr>
          <td>${Zoe.dateHeure(l.created_at)}</td>
          <td>${noms[l.admin_id] || (l.admin_id ? 'Compte supprimé' : '—')}</td>
          <td>${libelleAction(l.action)}</td>
          <td>${l.cible_id
    ? html`${noms[l.cible_id] || 'Compte supprimé'}${l.detail ? html`<small class="motif">Motif : ${l.detail}</small>` : ''}`
    : (libelleDetail(l.detail) || '—')}</td>
        </tr>`)}`
      : html`<tr><td colspan="4" class="aide">Aucune action enregistrée.</td></tr>`;
  }

  /* Entretien : fichiers restés dans le stockage, pannes notées par le site */
  const LIMITE_ORPHELINS = 200;   // la base en renvoie 200 au plus à la fois
  async function chargerOrphelins() {
    const fichiers = await req(sb.rpc('fichiers_orphelins'));
    $('#orphelins-nb').textContent = fichiers.length >= LIMITE_ORPHELINS ? `${LIMITE_ORPHELINS} ou plus` : fichiers.length;
    $('#orphelins-nettoyer').hidden = fichiers.length === 0;
    return fichiers;
  }

  // Les e-mails d'alerte partent-ils ? (clé enregistrée, envois en échec depuis 24 heures)
  async function chargerEtatEmails() {
    const zone = $('#etat-emails');
    const { data, error } = await sb.rpc('etat_emails');
    if (error || !data) { zone.textContent = 'État inconnu.'; zone.className = 'aide'; return; }
    zone.className = data.cle && !data.echecs ? 'aide' : 'alerte alerte--err';
    zone.textContent = !data.cle
      ? 'Clé du service d\'e-mails absente : les alertes s\'affichent sur le site, mais aucun e-mail ne part. Voir le fichier README, section « Alertes par e-mail ».'
      : data.echecs
        ? `${pluriel(data.echecs, 'envoi en échec', 'envois en échec')} depuis 24 h sur ${data.envois}. Vérifiez la clé et l'expéditeur dans Brevo.`
        : `Actifs : ${pluriel(data.envois, 'e-mail envoyé', 'e-mails envoyés')} depuis 24 h.`;
    const rappel = $('#a-faire-emails');
    if (rappel) rappel.hidden = data.cle;
  }

  async function chargerPannes() {
    const pannes = await req(sb.from('erreurs_client').select('id, page, message, created_at').order('created_at', { ascending: false }).limit(30));
    $('#pannes').innerHTML = pannes.length
      ? html`${pannes.map((p) => html`<tr>
          <td>${Zoe.dateHeure(p.created_at)}</td>
          <td>${p.page || '—'}</td>
          <td>${p.message || '—'}</td>
        </tr>`)}`
      : html`<tr><td colspan="3" class="aide">Aucune panne signalée.</td></tr>`;
    $('#pannes-vider').hidden = pannes.length === 0;
  }

  $('#orphelins-nettoyer').addEventListener('click', (e) => occupe(e.currentTarget, async () => {
    const fichiers = await chargerOrphelins();
    if (!fichiers.length) { toast('Aucun fichier à nettoyer.'); return; }
    const parEspace = {};
    fichiers.forEach((f) => { (parEspace[f.bucket] = parEspace[f.bucket] || []).push(f.chemin); });
    let effaces = 0;
    for (const [espace, chemins] of Object.entries(parEspace)) {
      const { data, error } = await sb.storage.from(espace).remove(chemins);
      if (error) throw error;
      effaces += (data || []).length;
    }
    const restants = await chargerOrphelins();
    if (effaces < fichiers.length) {
      throw new Error(`Effacement incomplet : ${effaces} sur ${fichiers.length}. Réessayez dans un instant.`);
    }
    toast(restants.length
      ? `${pluriel(effaces, 'fichier effacé', 'fichiers effacés')}. Il en reste : cliquez de nouveau sur « Nettoyer ».`
      : `${pluriel(effaces, 'fichier effacé', 'fichiers effacés')}.`);
  }));

  $('#pannes-vider').addEventListener('click', (e) => occupe(e.currentTarget, async () => {
    const accord = await Zoe.demander({ titre: 'Vider la liste des pannes ?', texte: 'Toutes les pannes notées par le site seront effacées, y compris celles qui ne sont pas affichées ici.', valider: 'Vider la liste', danger: true });
    if (!accord) return;
    await req(sb.from('erreurs_client').delete().gte('id', 0));
    toast('Liste vidée.');
    await chargerPannes();
  }));

  async function chargerJournalEtEntretien() {
    // Chaque bloc se charge séparément : une panne sur l'un n'empêche pas les autres.
    const resultats = await Promise.allSettled([chargerJournal(), chargerOrphelins(), chargerPannes(), chargerEtatEmails()]);
    const echec = resultats.find((r) => r.status === 'rejected');
    if (echec) throw echec.reason;
  }

  /* ---------- 6. Tableau de bord ---------- */
  // Lundi de la semaine d'une date, au format AAAA-MM-JJ.
  const lundiDe = (date) => {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toLocaleDateString('fr-CA');
  };

  async function chargerBord() {
    // Huit dernières semaines, la plus récente en haut.
    const semaines = [];
    for (let i = 0; i < 8; i += 1) { const d = new Date(); d.setDate(d.getDate() - 7 * i); semaines.push(lundiDe(d)); }
    const depuis = new Date(`${semaines[7]}T00:00:00`).toISOString();
    const membre = (q) => q.eq('role', 'membre');

    // Les totaux sont comptés par la base (comptage exact, sans plafond) ; les
    // listes nécessaires aux regroupements sont lues en entier, par paquets.
    const [verifies, enAttente, conducteursValides, conducteursAValider, acceptees, demandees, actifs, inscrits, trajets, reservations, demandes] = await Promise.all([
      compter('profils', (q) => membre(q).eq('statut', 'verifie')),
      compter('profils', (q) => membre(q).eq('statut', 'en_attente')),
      compter('profils', (q) => q.eq('conducteur_statut', 'valide')),
      compter('profils', (q) => q.eq('conducteur_statut', 'en_attente')),
      compter('reservations', (q) => q.eq('statut', 'acceptee')),
      compter('reservations', (q) => q.eq('statut', 'demandee')),
      toutLire(() => sb.from('trajets').select('depart_ville, destination_ville, places').eq('actif', true).gte('date_fin', Zoe.aujourdhui()).order('created_at').order('id')),
      toutLire(() => membre(sb.from('profils').select('created_at')).gte('created_at', depuis).order('created_at').order('id')),
      toutLire(() => sb.from('trajets').select('created_at').gte('created_at', depuis).order('created_at').order('id')),
      toutLire(() => sb.from('reservations').select('statut, created_at').gte('created_at', depuis).order('created_at').order('id')),
      req(sb.rpc('besoins_ouverts')),
    ]);
    const tuile = (valeur, libelle, note) => html`<div class="chiffre"><span>${valeur}</span><p>${libelle}</p>${note ? html`<small>${note}</small>` : ''}</div>`;

    $('#bord-chiffres').innerHTML = html`
      ${tuile(verifies, 'Membres vérifiés', enAttente ? `${enAttente} en attente` : '')}
      ${tuile(conducteursValides, 'Conducteurs validés', conducteursAValider ? `${conducteursAValider} à valider` : '')}
      ${tuile(actifs.length, 'Trajets proposés', pluriel(actifs.reduce((s, t) => s + t.places, 0), 'place', 'places'))}
      ${tuile(acceptees, 'Covoiturages acceptés', '')}
      ${tuile(demandees, 'Demandes en attente', '')}
      ${tuile(demandes.length >= 30 ? '30+' : demandes.length, 'Recherches enregistrées', demandes.length >= 30 ? 'Seules les 30 plus récentes sont détaillées ci-dessous' : '')}`;

    const parSemaines = (liste, filtre = () => true) => {
      const total = {};
      liste.filter(filtre).forEach((x) => { const s = lundiDe(x.created_at); total[s] = (total[s] || 0) + 1; });
      return total;
    };
    const parSemaine = {
      inscriptions: parSemaines(inscrits), trajets: parSemaines(trajets),
      demandes: parSemaines(reservations, (r) => r.statut !== 'contact'), acceptes: parSemaines(reservations, (r) => r.statut === 'acceptee'),
    };
    $('#bord-semaines').innerHTML = html`${semaines.map((s) => html`<tr>
      <td>${Zoe.date(s)}</td>
      <td>${parSemaine.inscriptions[s] || 0}</td><td>${parSemaine.trajets[s] || 0}</td>
      <td>${parSemaine.demandes[s] || 0}</td><td>${parSemaine.acceptes[s] || 0}</td></tr>`)}`;

    // Regroupe par parcours, du plus demandé au moins demandé.
    const regrouper = (liste) => Object.entries(liste.reduce((acc, x) => {
      const cle = `${x.depart_ville} → ${x.destination_ville}`;
      acc[cle] = (acc[cle] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const lignes = (groupes, mot, vide) => (groupes.length
      ? html`${groupes.map(([parcours, n]) => html`<li><b>${parcours}</b><span>${n} ${mot}${n > 1 ? 's' : ''}</span></li>`)}`
      : html`<li class="aide">${vide}</li>`);
    $('#bord-demandes').innerHTML = lignes(regrouper(demandes), 'recherche', 'Aucune recherche enregistrée pour le moment.');
    $('#bord-offres').innerHTML = lignes(regrouper(actifs), 'trajet', 'Aucun trajet proposé pour le moment.');
  }
  $('#bord-actualiser').addEventListener('click', (e) => occupe(e.currentTarget, async () => { await Promise.all([chargerBord(), chargerAttente()]); }));

  /* ---------- Démarrage ---------- */
  const chargeurs = { bord: chargerBord, membres: chargerMembres, etablissements: chargerEtablissements, contacts: chargerContacts, moderation: chargerModeration, journal: chargerJournalEtEntretien };
  montrerOnglet = Zoe.onglets($('#onglets'), (nom) => {
    chargeurs[nom]().catch(Zoe.erreur);
    majAttente();
  });
  // Les pastilles et le bloc « À faire » d'abord : c'est ce qui compte en arrivant.
  try { await chargerAttente(); } catch (e) { Zoe.erreur(e); }
  try {
    await chargerListeEtablissements();
    await chargerMembres();
    await chargerBord();
  } catch (e) { Zoe.erreur(e); }
})();
