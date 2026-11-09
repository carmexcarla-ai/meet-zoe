/* =========================================================
   Meet Zoe — connexion, inscription, mot de passe oublié
   ========================================================= */
(async () => {
  const { sb, $, toast, occupe, req } = Zoe;
  const montrer = Zoe.onglets($('#onglets'));

  if (!sb) { Zoe.pageNonConfiguree(); return; }

  // Le lien « mot de passe oublié » reçu par e-mail ramène sur cette page.
  let recuperation = location.hash.includes('type=recovery');
  sb.auth.onAuthStateChange((evenement) => {
    if (evenement === 'PASSWORD_RECOVERY') { recuperation = true; montrer('nouveau'); }
  });

  async function entrer() {
    const profil = await Zoe.exigerProfil();
    if (profil) location.replace(Zoe.pageAccueil(profil));
  }

  // Déjà connecté ? On va directement dans l'espace.
  const { data: { session } } = await sb.auth.getSession();
  if (session && !recuperation) { entrer(); return; }
  if (recuperation) montrer('nouveau');
  else if (location.hash === '#inscription') montrer('inscription');

  $('#lien-oubli').addEventListener('click', () => montrer('oubli'));

  $('#form-connexion').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    occupe(f.querySelector('[type=submit]'), async () => {
      await req(sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.mdp.value }));
      await entrer();
    });
  });

  $('#form-inscription').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    occupe(f.querySelector('[type=submit]'), async () => {
      const data = await req(sb.auth.signUp({
        email: f.email.value.trim(),
        password: f.mdp.value,
        options: {
          emailRedirectTo: new URL('connexion.html', location.href).href,
          // Ces informations servent à créer le profil. Le rôle et le statut
          // sont fixés par la base de données, jamais par le navigateur.
          data: {
            prenom: f.prenom.value.trim(),
            nom: f.nom.value.trim(),
            categorie: f.categorie.value,
            etablissement_declare: f.etablissement.value.trim(),
          },
        },
      }));
      if (data.session) await entrer();
      else montrer('confirmer');
    });
  });

  $('#form-oubli').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    occupe(f.querySelector('[type=submit]'), async () => {
      await req(sb.auth.resetPasswordForEmail(f.email.value.trim(), {
        redirectTo: new URL('connexion.html', location.href).href,
      }));
      toast('Si un compte existe avec cette adresse, un e-mail vient de partir.');
      montrer('connexion');
    });
  });

  $('#form-nouveau').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    occupe(f.querySelector('[type=submit]'), async () => {
      await req(sb.auth.updateUser({ password: f.mdp.value }));
      toast('Mot de passe enregistré.');
      await entrer();
    });
  });
})();
