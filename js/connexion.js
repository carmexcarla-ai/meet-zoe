/* =========================================================
   Meet Zoe — connexion, inscription, mot de passe oublié
   ========================================================= */
(async () => {
  const { sb, $, toast, occupe, req } = Zoe;
  const montrer = Zoe.onglets($('#onglets'));

  // Arrivée depuis « Je cherche un trajet » ou « Je propose un trajet » :
  // le choix passager ou conducteur est déjà coché.
  const choix = new URLSearchParams(location.search).get('je');
  if (choix === 'conducteur' || choix === 'passager') {
    $('#form-inscription').conducteur.value = String(choix === 'conducteur');
  }

  // Arrivée depuis « Créer mon compte » : on affiche tout de suite le bon onglet.
  if (location.hash === '#inscription') montrer('inscription');

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

  $('#lien-oubli').addEventListener('click', () => montrer('oubli'));

  // Selon le réglage de config.js, l'e-mail contient un code à saisir ou un lien à cliquer.
  if (!Zoe.codeParEmail) {
    $('#code-titre').textContent = 'Vérifiez votre boîte mail.';
    $('#code-texte').textContent = 'Nous venons d\'envoyer un e-mail à';
    $('#code-suite').textContent = 'Cliquez sur le lien qu\'il contient pour confirmer votre adresse : vous serez connecté(e) automatiquement.';
    $('#code-champ').hidden = true;
    $('#form-code').code.required = false;
    $('#code-valider').hidden = true;
    $('#renvoyer-code').textContent = 'Renvoyer l\'e-mail';
  }

  // Étape de confirmation : on retient l'adresse à confirmer.
  let emailAConfirmer = '';
  function demanderCode(email) {
    emailAConfirmer = email;
    $('#code-email').textContent = email;
    montrer('confirmer');
    if (Zoe.codeParEmail) $('#form-code').code.focus();
  }

  $('#form-code').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!Zoe.codeParEmail) return;
    const f = e.target;
    occupe(f.querySelector('[type=submit]'), async () => {
      const { error } = await sb.auth.verifyOtp({ email: emailAConfirmer, token: f.code.value.trim(), type: 'email' });
      if (error) throw new Error('Ce code est incorrect ou a expiré. Vérifiez-le, ou demandez-en un nouveau.');
      await entrer();
    });
  });

  $('#renvoyer-code').addEventListener('click', (e) => occupe(e.currentTarget, async () => {
    await req(sb.auth.resend({ type: 'signup', email: emailAConfirmer, options: { emailRedirectTo: new URL('connexion.html', location.href).href } }));
    toast(Zoe.codeParEmail ? 'Un nouveau code vient de partir.' : 'L\'e-mail vient d\'être renvoyé.');
  }));

  $('#form-connexion').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    occupe(f.querySelector('[type=submit]'), async () => {
      const email = f.email.value.trim();
      const { error } = await sb.auth.signInWithPassword({ email, password: f.mdp.value });
      // Compte créé mais adresse jamais confirmée : on renvoie un code.
      if (error && /not confirmed/i.test(error.message)) {
        await sb.auth.resend({ type: 'signup', email });
        demanderCode(email);
        return;
      }
      if (error) throw error;
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
            conducteur: f.conducteur.value,
          },
        },
      }));
      if (data.session) await entrer();
      else demanderCode(f.email.value.trim());
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
