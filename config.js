/* =========================================================
   Meet Zoe — configuration
   Remplacez les deux valeurs ci-dessous par celles de votre
   projet Supabase (Project Settings > API).

   La clé « anon / publishable » est faite pour être publique :
   la sécurité repose sur les règles de la base de données,
   pas sur le secret de cette clé.
   N'utilisez JAMAIS ici la clé « service_role / secret ».
   ========================================================= */
window.ZOE_CONFIG = {
  url: 'https://ckucrgsftfpwekijbjgn.supabase.co',
  cle: 'sb_publishable_fmr027WsnYNwZhPhhM6gxw_5KWPQG5P',

  // Confirmation de l'adresse à l'inscription :
  //   false = l'e-mail contient un lien à cliquer (réglage par défaut de Supabase)
  //   true  = l'e-mail contient un code à 6 chiffres à saisir sur le site
  // Ne passez à true qu'après avoir branché un service d'envoi d'e-mails (SMTP)
  // et collé le modèle supabase/emails/confirmation.html dans Supabase.
  codeParEmail: true,
};
