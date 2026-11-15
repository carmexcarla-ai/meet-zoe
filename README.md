# Meet Zoe

**Le covoiturage pour ceux qui prennent soin des autres.**

Site en ligne : https://meetzoe.fr
*Ensemble, allons plus loin.*

Meet Zoe est une plateforme de covoiturage réservée aux étudiants et aux
professionnels du secteur sanitaire et médico-social, pour rejoindre leurs
lieux de stage et de travail.

Ce dossier contient la **plateforme complète** : site vitrine, comptes membres
vérifiés, trajets, réservations, messagerie, espace partenaires et
administration.

## Comment c'est construit

- **Le site** : des fichiers simples (HTML, CSS, JavaScript). Rien à compiler.
- **Les comptes et les données** : [Supabase](https://supabase.com), un service
  qui fournit la base de données, la connexion des utilisateurs et le stockage
  des fichiers. L'offre gratuite suffit pour démarrer.

Tant que Supabase n'est pas relié, la vitrine s'affiche mais la connexion et
les espaces ne fonctionnent pas (un bandeau jaune le signale).

## Mise en route (une seule fois)

### 1. Créer le projet Supabase

1. Créez un compte sur supabase.com, puis un projet (**New project**).
2. Choisissez une région **en Europe** (par exemple Paris ou Francfort) : les
   données des membres doivent rester dans l'Union européenne.
3. Notez le mot de passe de base de données dans un endroit sûr.

### 2. Installer la base de données

1. Dans Supabase, ouvrez **SQL Editor** > **New query**.
2. Copiez tout le contenu du fichier `supabase/schema.sql`, collez-le, puis
   cliquez sur **Run**.

Le script peut être relancé sans danger : il ne supprime aucune donnée.
**À chaque mise à jour de `schema.sql`, recollez-le et relancez-le** : c'est
ainsi que la base reçoit les nouveautés.

### 3. Relier le site

1. Dans Supabase : **Project Settings** > **API** (ou **API Keys**).
2. Copiez l'adresse du projet (**Project URL**) et la clé publique
   (**anon** ou **publishable**).
3. Collez-les dans le fichier `config.js`.

N'utilisez jamais la clé **service_role** / **secret** dans le site.

### 4. Créer votre compte administrateur

1. Ouvrez le site, cliquez sur **Créer mon compte** et inscrivez-vous.
2. Confirmez votre adresse grâce à l'e-mail reçu.
3. Dans Supabase, **SQL Editor**, lancez (avec votre adresse) :

```sql
update public.profils
set role = 'admin', statut = 'verifie', methode_verif = 'admin'
where email = 'votre-adresse@exemple.fr';
```

4. Reconnectez-vous : vous arrivez dans l'administration.

### Confirmation de l'adresse e-mail

Le réglage actuel est le **code à 6 chiffres** : `codeParEmail: true` dans
`config.js`. À l'inscription, la personne reçoit un e-mail avec un code, qu'elle
saisit sur le site. Les e-mails partent par le service d'envoi Brevo, branché
dans Supabase (SMTP personnalisé).

Ce réglage repose sur trois éléments, à garder ensemble :

1. Supabase > **Authentification** > **Courriels** > **Configurer SMTP**, avec
   les identifiants du service d'envoi (Brevo) et une adresse d'un nom de
   domaine qui vous appartient.
2. Modèle **Confirmer l'inscription** : objet `Votre code de confirmation
   Meet Zoe`, contenu de `supabase/emails/confirmation.html`.
3. Dans `config.js`, `codeParEmail` à `true`.

Avec `codeParEmail: false`, le site attend à la place un **lien à cliquer**
dans l'e-mail (le modèle par défaut de Supabase). Ne changez ce réglage que si
le modèle d'e-mail de Supabase est changé en même temps.

### 5. Mettre le site en ligne

Le site est hébergé sur [Render](https://render.com), en « site statique »
(**Static Site**) : branche `main`, répertoire de publication (**Publish
directory**) `.`, sans commande de construction. Une fois l'adresse
connue, indiquez-la dans Supabase : **Authentication** > **URL Configuration**
> **Site URL**, et ajoutez `https://votre-site/connexion.html` dans
**Redirect URLs** (liens de confirmation et de mot de passe oublié).

Avant d'ouvrir au public, configurez aussi un service d'envoi d'e-mails dans
**Authentication** > **Emails** > **SMTP** : celui fourni par défaut est
limité à quelques e-mails par heure.

## Les pages

| Page              | Pour qui              | Ce qu'on y fait                                                        |
|-------------------|-----------------------|------------------------------------------------------------------------|
| `index.html`      | Tout le monde         | Accueil : promesse, étapes, exemple, accès vérifié, questions fréquentes |
| `a-propos.html`   | Tout le monde         | Qui sommes-nous : origine du projet, ce que nous faisons, engagements   |
| `etablissements.html` | Établissements    | Offre partenaires, formulaire de contact                               |
| `contact.html`    | Tout le monde         | Formulaire de contact ouvert à tous (profil, sujet, message)           |
| `connexion.html`  | Tout le monde         | Connexion, création de compte, mot de passe oublié                     |
| `espace.html`     | Membres               | Vérification du compte, recherche, trajets, réservations, messages, profil |
| `partenaire.html` | Établissements        | Statistiques générales, codes d'accès, quota                           |
| `admin.html`      | Équipe Meet Zoe       | Membres, justificatifs, rôles, établissements, abonnements, contacts   |

## Les fichiers

| Fichier                 | Rôle                                                        |
|-------------------------|-------------------------------------------------------------|
| `config.js`             | Adresse et clé publique de votre projet Supabase            |
| `styles.css`            | Apparence de toutes les pages (couleurs en haut du fichier) |
| `app.js`                | Pages publiques : menu mobile, année du pied de page        |
| `js/contact.js`         | Formulaires de contact (page Contact et page Établissements) |
| `js/commun.js`          | Outils partagés (connexion, affichage, communes)            |
| `js/connexion.js`       | Connexion et inscription                                    |
| `js/espace.js`          | Espace membre                                               |
| `js/partenaire.js`      | Espace partenaire                                           |
| `js/admin.js`           | Administration                                              |
| `supabase/schema.sql`   | Base de données : tables, règles de sécurité, fonctions     |
| `supabase/emails/confirmation.html` | Modèle de l'e-mail de code de confirmation |
| `vendor/supabase.js`    | Bibliothèque officielle Supabase (ne pas modifier)          |
| `vendor/qrcode.js`      | Bibliothèque de QR codes, licence MIT (ne pas modifier)     |
| `affiche.html`, `js/affiche.js` | Affiche A4 à imprimer pour un code d'accès          |
| `images/`               | Icône du site et image d'aperçu pour les partages           |
| `robots.txt`, `sitemap.xml` | Indications pour les moteurs de recherche               |
| `outils/version.sh`     | Augmente le numéro de version `?v=…` dans toutes les pages  |
| `tests/`                | Tests automatiques (voir `tests/README.md`)                 |

## Fonctionnement

**Accès vérifié.** Un nouveau compte est « en attente » et ne voit aucun
trajet. Il devient « vérifié » par l'une des trois méthodes :

1. **Code d'établissement** : accès immédiat, si l'abonnement de
   l'établissement est actif et son quota non atteint.
2. **Justificatif** (PDF ou image, 5 Mo max.) : stocké en privé, examiné par
   l'administration, puis effacé une fois la décision prise.
3. **Invitation** : chaque membre vérifié dispose de 5 invitations à usage
   unique.

**Conducteurs.** Pour proposer un trajet, un membre vérifié dépose son permis
de conduire et une pièce d'identité (carte d'identité, passeport ou titre de
séjour). L'administration les consulte dans **Membres** > **Conducteurs à
valider**, puis valide ou refuse. Les fichiers sont effacés dès la décision ;
seule la date de validation est conservée. Les passagers ne sont pas concernés.

**Fiche des membres.** Un clic sur un nom ouvre la fiche : prénom et initiale,
statut, établissement, badges de vérification, ancienneté, nombre de
covoiturages, véhicule, présentation, photo facultative, note et avis. Le nom
complet, l'e-mail, le téléphone et les documents n'y figurent jamais. Les
photos sont réduites à 480 px avant envoi et visibles des seuls membres
vérifiés.

**Avis.** Un passager dont la place a été acceptée peut noter son conducteur
(1 à 5) et laisser un commentaire, à partir du premier jour du trajet.

**Signalements et modération.** Tout membre peut signaler un autre membre
depuis sa fiche. L'onglet **Modération** de l'administration liste les
signalements et les avis récents : on peut suspendre un membre, masquer un
avis, retirer une photo.

**Journal.** Chaque action d'administration (validation, refus, suspension,
rôle, avis masqué, photo retirée, établissement créé ou modifié) est inscrite
dans un journal consultable, non modifiable depuis le site.

**Messagerie.** Un membre peut poser une question au conducteur d'un trajet
avant de demander une place. L'onglet **Messages** regroupe toutes les
conversations et signale les messages non lus. On ne peut écrire à quelqu'un
qu'à partir d'un de ses trajets.

**Recherche de trajets compatibles.** La recherche se fait sur une période : jours de la semaine,
dates, heure de prise de poste, heure de fin de poste (facultative) et marge
acceptée (30 minutes à 2 heures). Un trajet est proposé s'il va à la même
destination, si le détour du conducteur reste dans la limite qu'il a fixée,
s'il roule au moins un des jours demandés, et si son aller ou son retour colle
aux horaires. Chaque résultat indique ce qui convient : aller, retour, nombre
de jours couverts. Les postes de nuit (retour après minuit) sont gérés. Les
distances sont calculées à vol d'oiseau entre les centres des communes.

**Liens d'inscription et QR codes.** Chaque code d'accès a un lien et un QR
code (administration : **Établissements** > **Codes et QR codes** ; espace
partenaire : **Lien et QR code**). Une personne qui ouvre le lien ou scanne le
QR code arrive sur l'inscription, et son compte est validé automatiquement,
sans taper le code. Une affiche A4 prête à imprimer est proposée
(`affiche.html`). L'adresse utilisée dans les liens se règle dans `config.js`
(`site`).

**Inviter un collègue.** Dans le profil, chaque invitation disponible peut être
envoyée par WhatsApp ou copiée comme lien ; le lien valide le compte du
collègue automatiquement.

**Tableau de bord.** L'administration s'ouvre sur les chiffres clés (membres,
conducteurs, trajets, covoiturages, recherches enregistrées), l'évolution sur
huit semaines, les trajets recherchés sans conducteur et les trajets proposés.

**Formulaires.** La recherche et la publication d'un trajet posent des
questions simples, avec des raccourcis : jours (lundi au vendredi, week-end,
tous les jours), horaires (matin, après-midi, journée, nuit) et durée (cette
semaine, 4 semaines, 10 semaines, ou des dates au choix). Un conducteur indique
aussi son heure de départ, affichée aux passagers. La dernière recherche est
mémorisée sur l'appareil.

**Recherches enregistrées.** Quand rien ne convient, le membre enregistre sa
recherche (10 au maximum). Il est prévenu dans son espace dès qu'un trajet
compatible est publié. Les conducteurs voient, sans aucun nom, la liste des
trajets recherchés.

**Horaires variables.** Un trajet porte un seul horaire. Pour des horaires
différents selon les jours, on publie un trajet par horaire (bouton
« Dupliquer ») et on fait une recherche par horaire.

**Rôles.** `membre`, `partenaire` (gère un établissement) et `admin`. Les rôles
et les statuts ne peuvent être modifiés que par l'administration.

**Abonnements.** L'administration fixe la formule, le quota, le statut et la
date de fin de chaque établissement. Il n'y a pas de paiement en ligne.

**Adresses.** Les cases de départ et de destination acceptent une adresse
complète ou une commune. Les propositions viennent du service public
d'adresses de l'IGN (`data.geopf.fr`), avec la liste des communes
(`geo.api.gouv.fr`) en secours ; seul le texte tapé leur est envoyé.
L'adresse exacte n'est jamais enregistrée ni affichée : on garde le nom de la
commune et une position arrondie (1 km environ pour un trajet publié, 100 m
pour une recherche enregistrée). Le passager peut la transmettre au conducteur
dans son message de demande de place.

## Sécurité et vie privée

**Protections en place**

- Limites anti-abus : 10 essais de code ratés par jour, 20 messages par
  minute, 5 signalements par jour, 40 demandes de contact par heure.
- Politique de sécurité du contenu sur chaque page : aucun script extérieur ne
  peut s'exécuter, et le site refuse d'être affiché dans une autre page.
- Champ piège contre les robots sur le formulaire de contact.
- On ne peut plus écrire dans une conversation après un refus ou une annulation.

**À faire par le propriétaire du site** (une fois, hors du code)

- Activer la double authentification sur les comptes Supabase, GitHub et Render.
- Supabase > Authentication : longueur minimale du mot de passe (8), refus des
  mots de passe compromis, protection anti-robot (CAPTCHA) à l'inscription.
- Render > Headers : ajouter `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` et
  `Strict-Transport-Security: max-age=31536000` sur le chemin `/*`.
- Prévoir des sauvegardes de la base (l'offre gratuite de Supabase n'en fait
  pas automatiquement).
- Faire auditer le site par un professionnel avant l'ouverture au public.

**Règles d'accès**

- Toutes les règles d'accès sont appliquées par la base de données
  (`supabase/schema.sql`), pas par le navigateur.
- Entre membres, seuls le prénom, l'initiale du nom, la catégorie et
  l'établissement sont visibles. L'e-mail et le téléphone ne le sont jamais.
- Les partenaires ne voient que des totaux, aucune donnée individuelle.
- Chaque membre peut supprimer son compte et ses données depuis son profil.

## Mettre en ligne une nouvelle version

La branche `main` est publiée automatiquement sur le site. À chaque nouvelle
version, dans cet ordre :

1. Recoller tout le contenu de `supabase/schema.sql` dans l'éditeur SQL de
   Supabase (**SQL Editor** / **Éditeur SQL**), puis cliquer sur **Run** /
   **Exécuter**. Le script peut être relancé sans perte de données. Si
   `supabase/schema.sql` a changé, augmenter `version_base()` dans ce fichier
   et `VERSION_BASE` dans `js/commun.js`.
2. Lancer `sh outils/version.sh` : il augmente le numéro `?v=…` dans toutes
   les pages. Sans cela, le navigateur des visiteurs peut garder les anciens
   fichiers avec la nouvelle page, et des boutons cessent de fonctionner.
3. Fusionner la branche de travail dans `main`.

## Tests

Les tests automatiques sont dans le dossier `tests/` : voir `tests/README.md`
pour les lancer.

## Reste à faire avant l'ouverture au public

- Mentions légales, conditions d'utilisation et politique de confidentialité
  (RGPD), à faire relire par un professionnel.
- Clé du service d'e-mails pour les alertes (voir « Alertes par e-mail »
  ci-dessous) : tant qu'elle n'est pas enregistrée, les alertes s'affichent
  seulement sur le site.
- Double authentification sur Supabase, GitHub, Render, OVH et Brevo ;
  sauvegardes de la base.
- Boîte de contact et e-mail « mot de passe oublié » en français.
- Paiement en ligne des abonnements, si souhaité.
- Application mobile.

## Identité visuelle

| Couleur            | Code      |
|--------------------|-----------|
| Violet profond     | `#5425B8` |
| Bleu nuit          | `#211344` |
| Lavande            | `#EEE7FF` |
| Blanc              | `#FAF9FD` |
| Vert de confiance  | `#24A68A` |

## Alertes par e-mail

Chaque événement important (demande de place, réponse, message, compte ou
conducteur validé ou refusé, trajet modifié, mis en pause ou supprimé, dossier
à contrôler pour l'administration) crée une alerte dans l'espace du membre.
La base envoie aussi un e-mail court par le service Brevo, **si** une clé est
enregistrée. La clé se crée dans Brevo (**SMTP et API** > **Clés API** >
**Générer une nouvelle clé API**), puis s'enregistre une seule fois dans
l'éditeur SQL de Supabase :

```sql
insert into public.reglages_prives (nom, valeur) values ('brevo_cle', 'COLLER-LA-CLE-ICI')
on conflict (nom) do update set valeur = excluded.valeur;
```

Cette clé n'est lisible par aucun visiteur ni aucun membre, et ne doit jamais
être écrite dans un fichier du site ni envoyée par message. Pour arrêter les
e-mails : `delete from public.reglages_prives where nom = 'brevo_cle';`.
Les e-mails ne contiennent jamais le contenu des messages échangés, et chaque
membre peut les couper depuis son profil.
