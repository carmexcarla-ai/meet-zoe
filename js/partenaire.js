/* =========================================================
   Meet Zoe — espace partenaire
   Statistiques générales et codes d'accès de l'établissement.
   ========================================================= */
(async () => {
  const { sb, $, html, toast, occupe, req } = Zoe;

  const moi = await Zoe.exigerProfil();
  if (!moi) return;
  if (moi.statut !== 'verifie' || moi.role !== 'partenaire' || !moi.etablissement_id) {
    location.replace(Zoe.pageAccueil(moi));
    return;
  }

  $('#compte-nom').textContent = `${moi.prenom} ${moi.nom}`;
  $('#deconnexion').addEventListener('click', Zoe.deconnexion);
  $('#contenu').hidden = false;
  $('#form-code').expire.min = Zoe.aujourdhui();

  async function chargerStats() {
    const s = await req(sb.rpc('stats_etablissement'));
    const e = s.etablissement;
    $('#etab-nom').textContent = e.nom;
    $('#etab-abonnement').textContent =
      `${Zoe.TYPES_ETAB[e.type]} · ${e.ville} · formule ${Zoe.FORMULES[e.formule]} · abonnement ${Zoe.ABONNEMENTS[e.abonnement_statut].toLowerCase()}`
      + (e.abonnement_fin ? ` jusqu'au ${Zoe.date(e.abonnement_fin)}` : '');
    const taux = e.quota ? Math.min(100, Math.round((s.membres / e.quota) * 100)) : 0;
    $('#chiffres').innerHTML = html`
      <div class="chiffre">
        <span>${s.membres}<small> / ${e.quota}</small></span>
        <p>Membres rattachés</p>
        <div class="jauge"><i style="width:${taux}%"></i></div>
      </div>
      <div class="chiffre"><span>${s.trajets_actifs}</span><p>Trajets en cours</p></div>
      <div class="chiffre"><span>${s.places_proposees}</span><p>Places proposées</p></div>
      <div class="chiffre"><span>${s.places_partagees}</span><p>Places partagées</p></div>`;
  }

  async function chargerCodes() {
    const codes = await req(sb.from('codes_acces').select('*').order('created_at', { ascending: false }));
    $('#codes').innerHTML = codes.length
      ? html`${codes.map((c) => html`
        <tr data-code="${c.id}" data-actif="${c.actif}">
          <td><code>${c.code}</code></td>
          <td>${c.libelle || '—'}</td>
          <td>${c.utilisations}${c.max_utilisations ? ` / ${c.max_utilisations}` : ''}</td>
          <td>${c.expire_le ? Zoe.date(c.expire_le) : 'Sans limite'}</td>
          <td><span class="badge ${c.actif ? 'badge--acceptee' : 'badge--annulee'}">${c.actif ? 'Actif' : 'Désactivé'}</span></td>
          <td class="tableau__actions">
            <button class="lien" type="button" data-action="copier">Copier</button>
            <button class="lien" type="button" data-action="basculer">${c.actif ? 'Désactiver' : 'Réactiver'}</button>
            <button class="lien lien--danger" type="button" data-action="supprimer">Supprimer</button>
          </td>
        </tr>`)}`
      : html`<tr><td colspan="6" class="aide">Aucun code pour l'instant. Créez-en un ci-dessus.</td></tr>`;
  }

  $('#form-code').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    occupe(e.submitter, async () => {
      const code = await req(sb.rpc('creer_code', {
        p_libelle: f.libelle.value,
        p_max: f.max.value ? Number(f.max.value) : null,
        p_expire: f.expire.value || null,
      }));
      toast(`Code créé : ${code}`);
      f.reset();
      await chargerCodes();
    });
  });

  $('#codes').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const ligne = bouton.closest('tr');
    const action = bouton.dataset.action;
    if (action === 'copier') {
      const code = ligne.querySelector('code').textContent;
      navigator.clipboard.writeText(code).then(() => toast('Code copié.'), () => toast(code));
      return;
    }
    if (action === 'supprimer' && !confirm('Supprimer ce code ? Les membres déjà inscrits conservent leur accès.')) return;
    occupe(bouton, async () => {
      if (action === 'basculer') {
        await req(sb.from('codes_acces').update({ actif: ligne.dataset.actif !== 'true' }).eq('id', ligne.dataset.code));
      } else {
        await req(sb.from('codes_acces').delete().eq('id', ligne.dataset.code));
      }
      await chargerCodes();
    });
  });

  try { await Promise.all([chargerStats(), chargerCodes()]); } catch (e) { Zoe.erreur(e); }
})();
