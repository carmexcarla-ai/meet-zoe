/* =========================================================
   Meet Zoe — formulaires de contact (page Contact et page Établissements)
   ========================================================= */
const formContact = document.getElementById('contact');
const message = document.getElementById('message');

formContact.addEventListener('submit', async (e) => {
  e.preventDefault();
  message.className = 'form__msg';

  if (!formContact.checkValidity()) {
    message.textContent = 'Merci de compléter tous les champs, avec une adresse e-mail valide.';
    message.classList.add('err');
    formContact.reportValidity();
    return;
  }
  if (!Zoe.sb) {
    message.textContent = 'Le site n\'est pas encore relié à la base de données (voir config.js).';
    message.classList.add('err');
    return;
  }

  // Champ invisible : seul un robot le remplit. On fait comme si tout allait bien.
  if (formContact.site_web.value) {
    message.textContent = 'Merci ! Votre demande est bien enregistrée, nous revenons vers vous rapidement.';
    message.classList.add('ok');
    formContact.reset();
    return;
  }

  const bouton = formContact.querySelector('[type=submit]');
  bouton.disabled = true;
  // La demande est enregistrée ; seule l'administration peut la lire.
  const { error } = await Zoe.sb.from('demandes_contact').insert({
    nom: formContact.nom.value.trim(),
    email: formContact.email.value.trim(),
    // Page « Nous contacter » : le profil et le sujet remplacent l'établissement.
    organisme: formContact.organisme ? formContact.organisme.value.trim() : formContact.profil.value,
    message: (formContact.sujet ? `[${formContact.sujet.value}] ` : '') + formContact.message.value.trim() || null,
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
