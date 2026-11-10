# Meet Zoe

**Le covoiturage pour ceux qui prennent soin des autres.**
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

### 5. Mettre le site en ligne

Le dossier `meet-zoe` peut être déposé tel quel chez un hébergeur de sites
statiques (Netlify, Cloudflare Pages, GitHub Pages…). Une fois l'adresse
connue, indiquez-la dans Supabase : **Authentication** > **URL Configuration**
> **Site URL**, et ajoutez `https://votre-site/connexion.html` dans
**Redirect URLs** (liens de confirmation et de mot de passe oublié).

Avant d'ouvrir au public, configurez aussi un service d'envoi d'e-mails dans
**Authentication** > **Emails** > **SMTP** : celui fourni par défaut est
limité à quelques e-mails par heure.

## Les pages

| Page              | Pour qui              | Ce qu'on y fait                                                        |
|-------------------|-----------------------|------------------------------------------------------------------------|
| `index.html`      | Tout le monde         | Accueil en 4 sections : promesse, constat, étapes, questions            |
| `etablissements.html` | Établissements    | Offre partenaires, formules, formulaire de contact                     |
| `connexion.html`  | Tout le monde         | Connexion, création de compte, mot de passe oublié                     |
| `espace.html`     | Membres               | Vérification du compte, recherche, trajets, réservations, messages, profil |
| `partenaire.html` | Établissements        | Statistiques générales, codes d'accès, quota                           |
| `admin.html`      | Équipe Meet Zoe       | Membres, justificatifs, rôles, établissements, abonnements, contacts   |

## Les fichiers

| Fichier                 | Rôle                                                        |
|-------------------------|-------------------------------------------------------------|
| `config.js`             | Adresse et clé publique de votre projet Supabase            |
| `styles.css`            | Apparence de toutes les pages (couleurs en haut du fichier) |
| `app.js`                | Pages publiques : menu mobile                               |
| `js/contact.js`         | Formulaire de contact des établissements                    |
| `js/commun.js`          | Outils partagés (connexion, affichage, communes)            |
| `js/connexion.js`       | Connexion et inscription                                    |
| `js/espace.js`          | Espace membre                                               |
| `js/partenaire.js`      | Espace partenaire                                           |
| `js/admin.js`           | Administration                                              |
| `supabase/schema.sql`   | Base de données : tables, règles de sécurité, fonctions     |
| `vendor/supabase.js`    | Bibliothèque officielle Supabase (ne pas modifier)          |

## Fonctionnement

**Accès vérifié.** Un nouveau compte est « en attente » et ne voit aucun
trajet. Il devient « vérifié » par l'une des trois méthodes :

1. **Code d'établissement** : accès immédiat, si l'abonnement de
   l'établissement est actif et son quota non atteint.
2. **Justificatif** (PDF ou image, 5 Mo max.) : stocké en privé, examiné par
   l'administration, puis effacé une fois la décision prise.
3. **Invitation** : chaque membre vérifié dispose de 5 invitations à usage
   unique.

**Matching.** La recherche compare la destination, la date et le jour, l'heure
d'arrivée (le conducteur doit arriver avant l'heure demandée, avec 90 minutes
d'avance au plus) et le **détour** imposé au conducteur pour passer prendre le
passager, dans la limite qu'il a fixée. Les distances sont calculées à vol
d'oiseau entre les centres des communes.

**Rôles.** `membre`, `partenaire` (gère un établissement) et `admin`. Les rôles
et les statuts ne peuvent être modifiés que par l'administration.

**Abonnements.** L'administration fixe la formule, le quota, le statut et la
date de fin de chaque établissement. Il n'y a pas de paiement en ligne.

**Communes.** La saisie des communes utilise le service public
`geo.api.gouv.fr` (gratuit, sans compte). Seul le nom tapé lui est envoyé.

## Sécurité et vie privée

- Toutes les règles d'accès sont appliquées par la base de données
  (`supabase/schema.sql`), pas par le navigateur.
- Entre membres, seuls le prénom, l'initiale du nom, la catégorie et
  l'établissement sont visibles. L'e-mail et le téléphone ne le sont jamais.
- Les partenaires ne voient que des totaux, aucune donnée individuelle.
- Chaque membre peut supprimer son compte et ses données depuis son profil.

## Reste à faire avant l'ouverture au public

- Mentions légales, conditions d'utilisation et politique de confidentialité
  (RGPD), à faire relire par un professionnel.
- Envoi d'e-mails (SMTP) et nom de domaine.
- Notifications (nouvelle demande, nouveau message).
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
