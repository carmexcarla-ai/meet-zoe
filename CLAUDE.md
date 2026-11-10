# Instructions de travail — Meet Zoe

## Règle n° 1 : proposer avant de faire

Demandée par le propriétaire du projet, à plusieurs reprises. Elle s'applique à
chaque session et à chaque demande, même petite, même quand la demande semble
claire (« on peut pas faire mieux ? », « fais ce qui est mieux », etc.).

1. **Avant toute modification** (code, textes, base de données, réglages) :
   décrire ce qui va être fait, en français simple, et attendre un accord
   explicite. Ne rien écrire dans les fichiers avant cet accord.
2. **Avant toute mise en ligne** : la branche `main` est publiée
   automatiquement sur le site. Travailler sur une branche à part, montrer le
   résultat (captures d'écran, description) et ne fusionner dans `main`
   qu'après validation.
3. Une validation vaut pour ce qui a été proposé, pas pour la suite. Un
   correctif ou une idée supplémentaire se propose à son tour.
4. Seules exceptions : répondre à une question, lire le code, faire tourner
   des tests en local. Rien de cela ne modifie le site.

## La personne

- Elle ne code pas : expliquer sans jargon, guider écran par écran.
- Tout se fait en français. Son navigateur traduit parfois les pages
  (Supabase, GitHub, Render) : donner les libellés en français et en anglais.
- Donner un avis franc, y compris quand il est défavorable.
- Ne jamais inventer de chiffres, de partenaires ou de témoignages sur le site.
- Ne pas changer les couleurs du site.

## Le projet

- Site statique (HTML, CSS, JavaScript sans compilation) à la racine du dépôt.
- Données et comptes : Supabase. Hébergement : Render, branche `main`,
  répertoire de publication `.`.
- Toute modification de `supabase/schema.sql` doit être recollée à la main
  dans l'éditeur SQL de Supabase par le propriétaire : le lui dire clairement,
  et tester la mise à jour sur une base contenant déjà l'ancienne version.
- Le script SQL doit rester relançable sans perte de données.
- Les règles d'accès se font dans la base (RLS et fonctions), jamais
  seulement dans le navigateur.

## Avant de dire que c'est fini

- Tester le parcours complet sur une copie locale de Supabase, y compris les
  tentatives de contournement.
- Vérifier l'affichage à 360, 390, 768 et 1280 px.
- Dire ce qui n'a pas pu être testé.
