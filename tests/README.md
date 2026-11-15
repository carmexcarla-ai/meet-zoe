# Tests automatiques de Meet Zoe

Ces tests jouent le parcours complet du site dans un vrai navigateur, sur une
copie locale de la base : inscription avec code reçu par e-mail, vérification,
conducteur, trajet, recherche, demande de place, messages, alertes et e-mails,
administration, espace partenaire, et une cinquantaine de tentatives de
contournement des règles d'accès. À lancer avant chaque mise en ligne.

## Ce qu'il faut

- Docker et la commande `supabase` (copie locale de la base, e-mails de test
  compris, confirmations par e-mail activées avec le modèle
  `supabase/emails/confirmation.html`) ;
- Node.js, avec `playwright` et `@supabase/supabase-js`.

## Lancer

```bash
# 1. La base locale, puis le script de la base (deux fois : il doit rester relançable)
supabase start
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f supabase/schema.sql

# 2. Le site local (port 8766) et la fausse boîte d'envoi des alertes (port 8777)
node tests/serveur.js &
node tests/boite.js &

# 3. La base locale envoie ses e-mails d'alerte vers la fausse boîte
#    (172.18.0.1 est l'adresse de la machine vue depuis Docker : à adapter)
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c \
  "insert into reglages_prives values ('brevo_cle','cle-test'),('brevo_url','http://172.18.0.1:8777/'),('site','http://127.0.0.1:8766') on conflict (nom) do update set valeur = excluded.valeur"

# 4. Les tests
node tests/e2e.js
```

La dernière ligne affichée doit être « N réussis, 0 échoués ». Les captures
d'écran vont dans `tests/captures/` (dossier non versionné).

Attention : le test vide la base locale au démarrage. Ne jamais le pointer vers
la vraie base.
