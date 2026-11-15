-- =====================================================================
-- Meet Zoe — base de données (Supabase / PostgreSQL)
--
-- À coller en entier dans Supabase : SQL Editor > New query > Run.
-- Le script peut être relancé sans danger : il ne supprime aucune donnée.
--
-- Principe de sécurité : chaque table est protégée ligne par ligne (RLS).
-- Tout ce qui est sensible (vérifier un membre, utiliser un code, accepter
-- une réservation, changer un rôle) passe par des fonctions qui contrôlent
-- les droits côté serveur. Le navigateur ne peut pas les contourner.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.etablissements (
  id                uuid primary key default gen_random_uuid(),
  nom               text not null check (char_length(nom) between 2 and 120),
  type              text not null check (type in ('ifsi','ifas','hopital','ehpad','fam','foyer','autre')),
  ville             text not null,
  lat               double precision,
  lng               double precision,
  quota             integer not null default 50 check (quota >= 0),
  formule           text not null default 'etablissement' check (formule in ('etablissement','institut','reseau')),
  abonnement_statut text not null default 'essai' check (abonnement_statut in ('essai','actif','suspendu','termine')),
  abonnement_fin    date,
  created_at        timestamptz not null default now()
);

create table if not exists public.profils (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text not null,
  prenom                text not null check (char_length(prenom) between 1 and 60),
  nom                   text not null check (char_length(nom) between 1 and 60),
  categorie             text not null check (categorie in ('esi','eas','autre_formation','pro_diplome','pro_non_diplome','etablissement')),
  etablissement_declare text check (char_length(etablissement_declare) <= 120),
  ville                 text check (char_length(ville) <= 80),
  telephone             text check (char_length(telephone) <= 20),
  role                  text not null default 'membre' check (role in ('membre','partenaire','admin')),
  statut                text not null default 'en_attente' check (statut in ('en_attente','verifie','refuse','suspendu')),
  methode_verif         text check (methode_verif in ('code','justificatif','invitation','admin')),
  etablissement_id      uuid references public.etablissements (id) on delete set null,
  justificatif_path     text,
  invite_par            uuid references public.profils (id) on delete set null,
  verifie_le            timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists profils_etablissement_idx on public.profils (etablissement_id);

-- Conducteurs : permis et pièce d'identité contrôlés par l'administration.
-- Les fichiers sont effacés après le contrôle ; seule la décision est gardée.
alter table public.profils add column if not exists souhaite_conduire boolean not null default false;
alter table public.profils add column if not exists conducteur_statut text not null default 'non';
alter table public.profils add column if not exists permis_path text;
alter table public.profils add column if not exists identite_path text;
alter table public.profils add column if not exists identite_type text;
alter table public.profils add column if not exists conducteur_valide_le timestamptz;
-- Fiche visible des autres membres : présentation, véhicule, photo facultative.
alter table public.profils add column if not exists bio text;
alter table public.profils add column if not exists vehicule text;
alter table public.profils add column if not exists photo_path text;
alter table public.profils drop constraint if exists profils_fiche_check;
alter table public.profils add constraint profils_fiche_check
  check (char_length(bio) <= 300 and char_length(vehicule) <= 60);
-- Essais de codes ratés dans la journée (contre les devinettes en série).
alter table public.profils add column if not exists essais_code integer not null default 0;
alter table public.profils add column if not exists essais_le date;
alter table public.profils drop constraint if exists profils_conducteur_statut_check;
alter table public.profils add constraint profils_conducteur_statut_check
  check (conducteur_statut in ('non','en_attente','valide','refuse'));
alter table public.profils drop constraint if exists profils_identite_type_check;
alter table public.profils add constraint profils_identite_type_check
  check (identite_type is null or identite_type in ('cni','passeport','titre_sejour'));

create table if not exists public.codes_acces (
  id               uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  code             text not null unique,
  libelle          text check (char_length(libelle) <= 80),
  max_utilisations integer check (max_utilisations is null or max_utilisations > 0),
  utilisations     integer not null default 0,
  expire_le        date,
  actif            boolean not null default true,
  cree_par         uuid references public.profils (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  cree_par    uuid not null references public.profils (id) on delete cascade,
  utilise_par uuid references public.profils (id) on delete set null,
  utilise_le  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.trajets (
  id                uuid primary key default gen_random_uuid(),
  conducteur_id     uuid not null references public.profils (id) on delete cascade,
  depart_ville      text not null check (char_length(depart_ville) <= 80),
  depart_lat        double precision not null,
  depart_lng        double precision not null,
  destination_nom   text not null check (char_length(destination_nom) between 2 and 120),
  destination_ville text not null check (char_length(destination_ville) <= 80),
  dest_lat          double precision not null,
  dest_lng          double precision not null,
  date_debut        date not null,
  date_fin          date not null,
  jours             smallint[] not null check (cardinality(jours) between 1 and 7 and jours <@ array[1,2,3,4,5,6,7]::smallint[]),
  heure_arrivee     time not null,
  heure_retour      time,
  places            smallint not null check (places between 1 and 8),
  detour_max_km     smallint not null default 10 check (detour_max_km between 0 and 50),
  commentaire       text check (char_length(commentaire) <= 500),
  actif             boolean not null default true,
  created_at        timestamptz not null default now(),
  check (date_fin >= date_debut)
);
-- Heure à laquelle le conducteur part de chez lui (affichée aux passagers).
alter table public.trajets add column if not exists heure_depart time;
create index if not exists trajets_conducteur_idx on public.trajets (conducteur_id);
create index if not exists trajets_dates_idx on public.trajets (date_debut, date_fin) where actif;

create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  trajet_id   uuid not null references public.trajets (id) on delete cascade,
  passager_id uuid not null references public.profils (id) on delete cascade,
  statut      text not null default 'demandee',
  created_at  timestamptz not null default now(),
  unique (trajet_id, passager_id)
);
create index if not exists reservations_passager_idx on public.reservations (passager_id);

-- Une ligne « contact » est une simple conversation avec le conducteur,
-- sans demande de place. Elle devient « demandee » si le membre réserve.
alter table public.reservations drop constraint if exists reservations_statut_check;
alter table public.reservations add constraint reservations_statut_check
  check (statut in ('contact','demandee','acceptee','refusee','annulee'));
-- Dernière lecture de la conversation par chacun (pour les messages non lus).
alter table public.reservations add column if not exists lu_passager_le timestamptz not null default now();
alter table public.reservations add column if not exists lu_conducteur_le timestamptz not null default now();

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  expediteur_id  uuid not null references public.profils (id) on delete cascade,
  contenu        text not null check (char_length(contenu) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index if not exists messages_reservation_idx on public.messages (reservation_id, created_at);

-- Recherches enregistrées : le besoin d'un membre, gardé tant qu'aucun
-- trajet ne convient. Sert aussi à montrer aux conducteurs ce qui est demandé.
create table if not exists public.besoins (
  id                uuid primary key default gen_random_uuid(),
  membre_id         uuid not null references public.profils (id) on delete cascade,
  depart_ville      text not null check (char_length(depart_ville) <= 80),
  depart_lat        double precision not null,
  depart_lng        double precision not null,
  destination_ville text not null check (char_length(destination_ville) <= 80),
  dest_lat          double precision not null,
  dest_lng          double precision not null,
  date_debut        date not null,
  date_fin          date not null,
  jours             smallint[] not null check (cardinality(jours) between 1 and 7 and jours <@ array[1,2,3,4,5,6,7]::smallint[]),
  heure_arrivee     time not null,
  heure_retour      time,
  marge_min         smallint not null default 60 check (marge_min between 15 and 180),
  vu_le             timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  check (date_fin >= date_debut)
);
create index if not exists besoins_membre_idx on public.besoins (membre_id);

-- Avis laissés par un passager sur son conducteur après un covoiturage accepté.
create table if not exists public.avis (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations (id) on delete set null,
  auteur_id      uuid not null references public.profils (id) on delete cascade,
  cible_id       uuid not null references public.profils (id) on delete cascade,
  note           smallint not null check (note between 1 and 5),
  commentaire    text check (char_length(commentaire) <= 500),
  masque         boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (reservation_id, auteur_id)
);
create index if not exists avis_cible_idx on public.avis (cible_id);

-- Signalements d'un membre, traités par l'administration.
create table if not exists public.signalements (
  id         uuid primary key default gen_random_uuid(),
  auteur_id  uuid references public.profils (id) on delete set null,
  cible_id   uuid not null references public.profils (id) on delete cascade,
  motif      text not null check (char_length(motif) between 10 and 1000),
  statut     text not null default 'ouvert' check (statut in ('ouvert','traite')),
  created_at timestamptz not null default now()
);

-- Journal des actions d'administration : qui a fait quoi, et quand.
create table if not exists public.journal_admin (
  id         bigint generated always as identity primary key,
  admin_id   uuid,
  action     text not null,
  cible_id   uuid,
  detail     text,
  created_at timestamptz not null default now()
);

create table if not exists public.demandes_contact (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null check (char_length(nom) between 1 and 120),
  email      text not null check (char_length(email) between 5 and 160 and email like '%_@_%'),
  organisme  text check (char_length(organisme) <= 160),
  message    text check (char_length(message) <= 2000),
  traitee    boolean not null default false,
  created_at timestamptz not null default now()
);

-- Motifs de refus affichés au membre, et choix de recevoir ou non les e-mails.
alter table public.profils add column if not exists motif_refus text;
alter table public.profils add column if not exists conducteur_motif text;
alter table public.profils add column if not exists notif_email boolean not null default true;
alter table public.reservations add column if not exists motif_refus text;

-- Alertes affichées dans l'espace du membre (et doublées d'un e-mail court).
create table if not exists public.notifications (
  id             bigint generated always as identity primary key,
  membre_id      uuid not null references public.profils (id) on delete cascade,
  type           text not null,
  onglet         text not null default 'recherche',
  titre          text not null,
  texte          text,
  reservation_id uuid,
  lu             boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists notifications_membre_idx on public.notifications (membre_id, lu, created_at desc);

-- Réglages privés (clé du service d'e-mails). Aucun droit de lecture n'est
-- donné : seules les fonctions internes de la base y accèdent.
create table if not exists public.reglages_prives (
  nom    text primary key,
  valeur text not null
);

-- Empreintes (illisibles) des adresses e-mail de comptes suspendus qui se
-- sont supprimés : empêche de revenir en recréant un compte.
create table if not exists public.adresses_bloquees (
  empreinte  text primary key,
  created_at timestamptz not null default now()
);

-- Pannes rencontrées par les visiteurs, consultables par l'administration.
create table if not exists public.erreurs_client (
  id         bigint generated always as identity primary key,
  membre_id  uuid,
  page       text,
  message    text,
  created_at timestamptz not null default now()
);

-- Envoi d'e-mails depuis la base (extension fournie par Supabase).
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'Extension pg_net indisponible : les alertes resteront sur le site, sans e-mail.';
end $$;

-- ---------------------------------------------------------------------
-- 2. FONCTIONS D'AIDE (qui suis-je ?)
-- ---------------------------------------------------------------------

create or replace function public.est_verifie() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and statut = 'verifie');
$$;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and statut = 'verifie' and role = 'admin');
$$;

-- Conducteur dont le permis et la pièce d'identité ont été validés.
create or replace function public.est_conducteur() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and statut = 'verifie' and conducteur_statut = 'valide');
$$;

-- Établissement géré par le partenaire connecté (sinon NULL).
create or replace function public.mon_etablissement_gere() returns uuid
language sql stable security definer set search_path = public as $$
  select etablissement_id from profils
  where id = auth.uid() and statut = 'verifie' and role = 'partenaire';
$$;

create or replace function public.participe_reservation(p_reservation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reservations r join trajets t on t.id = r.trajet_id
    where r.id = p_reservation and auth.uid() in (r.passager_id, t.conducteur_id)
  );
$$;

-- On ne peut écrire que dans une conversation en cours : plus après un refus
-- ou une annulation.
create or replace function public.conversation_ouverte(p_reservation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reservations r join trajets t on t.id = r.trajet_id
    where r.id = p_reservation and auth.uid() in (r.passager_id, t.conducteur_id)
      and r.statut in ('contact', 'demandee', 'acceptee')
  );
$$;

-- Numéro de version de ce script : le site vérifie que la base est à jour.
create or replace function public.version_base() returns integer
language sql immutable as $$ select 16; $$;

create or replace function public.empreinte_email(p_email text) returns text
language sql immutable as $$
  select encode(sha256(convert_to('meetzoe:' || lower(trim(p_email)), 'UTF8')), 'hex');
$$;

-- Distance à vol d'oiseau entre deux points, en kilomètres.
create or replace function public.distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Code lisible, sans caractères ambigus (pas de 0/O, 1/I).
create or replace function public.code_aleatoire(p_prefixe text) returns text
language sql volatile set search_path = public, extensions as $$
  select p_prefixe || '-' || string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1), ''
  ) from generate_series(1, 8);
$$;

-- ---------------------------------------------------------------------
-- 3. CRÉATION AUTOMATIQUE DU PROFIL À L'INSCRIPTION
--    Le rôle et le statut ne viennent jamais du navigateur.
-- ---------------------------------------------------------------------

create or replace function public.creer_profil() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_categorie text := m ->> 'categorie';
begin
  if v_categorie is null or v_categorie not in ('esi','eas','autre_formation','pro_diplome','pro_non_diplome','etablissement') then
    v_categorie := 'autre_formation';
  end if;
  insert into profils (id, email, prenom, nom, categorie, etablissement_declare, ville, souhaite_conduire, statut)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(m ->> 'prenom'), ''), 'Membre'), 60),
    left(coalesce(nullif(trim(m ->> 'nom'), ''), '-'), 60),
    v_categorie,
    left(nullif(trim(m ->> 'etablissement_declare'), ''), 120),
    left(nullif(trim(m ->> 'ville'), ''), 80),
    coalesce(m ->> 'conducteur', '') = 'true',
    -- Une adresse dont le compte suspendu a été supprimé reste suspendue.
    case when exists (select 1 from adresses_bloquees where empreinte = empreinte_email(new.email))
         then 'suspendu' else 'en_attente' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.creer_profil();

-- ---------------------------------------------------------------------
-- 4. VÉRIFICATION DES MEMBRES
-- ---------------------------------------------------------------------

-- Compte un essai raté. Au-delà de 10 dans la journée, on bloque jusqu'au lendemain.
create or replace function public.essai_rate(p_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update profils set
    essais_code = case when essais_le = current_date then essais_code + 1 else 1 end,
    essais_le = current_date
  where id = auth.uid();
  return jsonb_build_object('ok', false, 'message', p_message);
end;
$$;

create or replace function public.trop_d_essais() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and essais_le = current_date and essais_code >= 10);
$$;

-- 4a. Code d'établissement : contrôle l'abonnement et le quota.
drop function if exists public.utiliser_code(text);
create or replace function public.utiliser_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profil profils;
  v_code   codes_acces;
  v_etab   etablissements;
  v_nb     integer;
begin
  select * into v_profil from profils where id = auth.uid();
  if v_profil.id is null then raise exception 'Connectez-vous pour utiliser un code.'; end if;
  if v_profil.statut = 'verifie' then raise exception 'Votre compte est déjà vérifié.'; end if;
  if v_profil.statut = 'suspendu' then raise exception 'Votre compte est suspendu.'; end if;
  if trop_d_essais() then
    return jsonb_build_object('ok', false, 'message', 'Trop d''essais aujourd''hui. Réessayez demain ou contactez votre établissement.');
  end if;

  select * into v_code from codes_acces where code = upper(trim(p_code)) for update;
  if v_code.id is null or not v_code.actif then return essai_rate('Ce code n''est pas valide.'); end if;
  if v_code.expire_le is not null and v_code.expire_le < current_date then return essai_rate('Ce code a expiré.'); end if;
  if v_code.max_utilisations is not null and v_code.utilisations >= v_code.max_utilisations then
    return jsonb_build_object('ok', false, 'message', 'Ce code a atteint son nombre maximal d''utilisations.');
  end if;

  select * into v_etab from etablissements where id = v_code.etablissement_id for update;
  if v_etab.abonnement_statut not in ('essai','actif')
     or (v_etab.abonnement_fin is not null and v_etab.abonnement_fin < current_date) then
    return jsonb_build_object('ok', false, 'message', 'L''abonnement de cet établissement n''est pas actif.');
  end if;

  select count(*) into v_nb from profils
  where etablissement_id = v_etab.id and role = 'membre' and statut = 'verifie';
  if v_nb >= v_etab.quota then
    return jsonb_build_object('ok', false, 'message', 'Le quota de membres de cet établissement est atteint.');
  end if;

  update codes_acces set utilisations = utilisations + 1 where id = v_code.id;
  update profils set statut = 'verifie', methode_verif = 'code', etablissement_id = v_etab.id, verifie_le = now(), essais_code = 0
  where id = v_profil.id;
  return jsonb_build_object('ok', true, 'etablissement', v_etab.nom);
end;
$$;

-- 4b. Invitation par un membre déjà vérifié (5 invitations par membre).
create or replace function public.creer_invitation() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not est_verifie() then raise exception 'Seuls les membres vérifiés peuvent inviter.'; end if;
  -- Un membre entré par invitation ne peut pas inviter à son tour : chaque
  -- invité reste recommandé par une personne dont la situation a été contrôlée.
  if exists (select 1 from profils where id = auth.uid() and methode_verif = 'invitation') then
    raise exception 'Les invitations sont réservées aux membres vérifiés par un code ou un justificatif.';
  end if;
  if (select count(*) from invitations where cree_par = auth.uid()) >= 5 then
    raise exception 'Vous avez utilisé vos 5 invitations.';
  end if;
  v_code := code_aleatoire('INV');
  insert into invitations (code, cree_par) values (v_code, auth.uid());
  return v_code;
end;
$$;

drop function if exists public.utiliser_invitation(text);
create or replace function public.utiliser_invitation(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profil profils;
  v_inv    invitations;
begin
  select * into v_profil from profils where id = auth.uid();
  if v_profil.id is null then raise exception 'Connectez-vous pour utiliser une invitation.'; end if;
  if v_profil.statut = 'verifie' then raise exception 'Votre compte est déjà vérifié.'; end if;
  if v_profil.statut = 'suspendu' then raise exception 'Votre compte est suspendu.'; end if;
  if trop_d_essais() then
    return jsonb_build_object('ok', false, 'message', 'Trop d''essais aujourd''hui. Réessayez demain.');
  end if;

  select * into v_inv from invitations where code = upper(trim(p_code)) for update;
  if v_inv.id is null or v_inv.utilise_par is not null then return essai_rate('Cette invitation n''est pas valide.'); end if;
  if not exists (select 1 from profils where id = v_inv.cree_par and statut = 'verifie') then
    return essai_rate('Cette invitation n''est plus valable.');
  end if;

  update invitations set utilise_par = v_profil.id, utilise_le = now() where id = v_inv.id;
  update profils set statut = 'verifie', methode_verif = 'invitation', invite_par = v_inv.cree_par, verifie_le = now(), essais_code = 0
  where id = v_profil.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 4c. Justificatif individuel : le fichier est déposé dans le stockage privé,
--     puis un administrateur valide ou refuse.
create or replace function public.soumettre_justificatif(p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_statut text;
begin
  select statut into v_statut from profils where id = auth.uid();
  if v_statut is null then raise exception 'Connectez-vous pour envoyer un justificatif.'; end if;
  if v_statut = 'verifie' then raise exception 'Votre compte est déjà vérifié.'; end if;
  if v_statut = 'suspendu' then raise exception 'Votre compte est suspendu.'; end if;
  if p_path is null or p_path not like auth.uid()::text || '/%' then raise exception 'Fichier invalide.'; end if;

  update profils set justificatif_path = p_path, methode_verif = 'justificatif', statut = 'en_attente', motif_refus = null
  where id = auth.uid();
end;
$$;

-- 4d. Conducteurs : dépôt du permis et d'une pièce d'identité.
create or replace function public.soumettre_documents_conducteur(p_permis text, p_identite text, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profil profils;
begin
  select * into v_profil from profils where id = auth.uid();
  if v_profil.id is null or v_profil.statut <> 'verifie' then raise exception 'Accès réservé aux membres vérifiés.'; end if;
  if v_profil.conducteur_statut = 'valide' then raise exception 'Vous êtes déjà validé comme conducteur.'; end if;
  if p_type is null or p_type not in ('cni','passeport','titre_sejour') then raise exception 'Type de pièce d''identité inconnu.'; end if;
  if p_permis is null or p_permis not like auth.uid()::text || '/%'
     or p_identite is null or p_identite not like auth.uid()::text || '/%' then
    raise exception 'Fichier invalide.';
  end if;

  update profils set permis_path = p_permis, identite_path = p_identite, identite_type = p_type,
    conducteur_statut = 'en_attente', souhaite_conduire = true, conducteur_motif = null
  where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- 5. TRAJETS, RECHERCHE ET RÉSERVATIONS
-- ---------------------------------------------------------------------

-- Matching. Pour un besoin (départ, destination, période, jours, heure de
-- prise de poste, heure de fin de poste, marge acceptée), trouve les trajets :
--   - vers la même destination (5 km au plus) ;
--   - dont le détour pour passer prendre le passager reste acceptable ;
--   - qui roulent au moins un des jours demandés sur la période ;
--   - dont l'aller OU le retour colle aux horaires, dans la marge.
-- Les écarts d'heure sont calculés « modulo 24 h » pour les postes de nuit.
drop function if exists public.rechercher_trajets(double precision, double precision, double precision, double precision, date, time);

create or replace function public.trajets_compatibles(
  p_membre uuid,
  p_dep_lat double precision, p_dep_lng double precision,
  p_dest_lat double precision, p_dest_lng double precision,
  p_debut date, p_fin date, p_jours smallint[],
  p_arrivee time, p_retour time, p_marge integer
)
returns table (
  trajet_id uuid, detour double precision, d_dest double precision,
  aller_ok boolean, retour_ok boolean, avance_min integer, attente_min integer,
  dates_communes integer, jours_communs smallint[], cree_le timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, x.detour, x.d_dest,
    x.avance <= p_marge,
    coalesce(x.attente <= p_marge, false),
    x.avance, x.attente,
    c.n,
    array(select j from unnest(p_jours) j where j = any (t.jours) order by j)::smallint[],
    t.created_at
  from trajets t
  join profils p on p.id = t.conducteur_id and p.statut = 'verifie' and p.conducteur_statut = 'valide'
  cross join lateral (
    select
      distance_km(t.dest_lat, t.dest_lng, p_dest_lat, p_dest_lng) as d_dest,
      greatest(0,
        distance_km(t.depart_lat, t.depart_lng, p_dep_lat, p_dep_lng)
        + distance_km(p_dep_lat, p_dep_lng, t.dest_lat, t.dest_lng)
        - distance_km(t.depart_lat, t.depart_lng, t.dest_lat, t.dest_lng)) as detour,
      -- Minutes d'avance à l'arrivée, puis minutes d'attente avant le retour.
      ((extract(epoch from (p_arrivee - t.heure_arrivee)) / 60)::integer + 1440) % 1440 as avance,
      case when p_retour is null or t.heure_retour is null then null
           else ((extract(epoch from (t.heure_retour - p_retour)) / 60)::integer + 1440) % 1440 end as attente
  ) x
  cross join lateral (
    select count(*)::integer as n
    from generate_series(greatest(p_debut, t.date_debut, current_date)::timestamp,
                         least(p_fin, t.date_fin, p_debut + 366)::timestamp, interval '1 day') d
    where extract(isodow from d)::smallint = any (p_jours)
      and extract(isodow from d)::smallint = any (t.jours)
  ) c
  where t.actif
    and t.conducteur_id <> p_membre
    and x.d_dest <= 5
    and x.detour <= greatest(t.detour_max_km, 1)
    and c.n > 0
    and (x.avance <= p_marge or coalesce(x.attente <= p_marge, false));
$$;

-- Recherche sur une période, aller et retour, avec une note de compatibilité :
-- 40 points pour le détour, 25 pour les horaires, 20 pour les jours couverts,
-- 15 si tous les trajets demandés (aller, et retour s'il est demandé) sont assurés.
drop function if exists public.rechercher_trajets_periode(double precision, double precision, double precision, double precision, date, date, smallint[], time, time, integer);
drop view if exists public.membres;
create or replace function public.rechercher_trajets_periode(
  p_dep_lat double precision, p_dep_lng double precision,
  p_dest_lat double precision, p_dest_lng double precision,
  p_debut date, p_fin date, p_jours smallint[],
  p_arrivee time, p_retour time default null, p_marge integer default 60
)
returns table (
  id uuid, conducteur_id uuid, prenom text, initiale text, categorie text, etablissement text,
  depart_ville text, destination_nom text, destination_ville text,
  date_debut date, date_fin date, jours smallint[], heure_arrivee time, heure_retour time,
  places smallint, places_restantes integer, commentaire text,
  detour_km integer, aller_ok boolean, retour_ok boolean, avance_min integer, attente_min integer,
  dates_communes integer, dates_demandees integer, jours_communs smallint[],
  score integer, ma_reservation text,
  note_moyenne numeric, nb_avis integer, photo_path text, heure_depart time,
  etablissement_verifie boolean
)
language sql stable security definer set search_path = public as $$
  with demande as (
    select greatest(count(*), 1)::integer as n
    from generate_series(greatest(p_debut, current_date)::timestamp, least(p_fin, p_debut + 366)::timestamp, interval '1 day') d
    where extract(isodow from d)::smallint = any (p_jours)
  )
  select t.id, t.conducteur_id, p.prenom, upper(left(p.nom, 1)), p.categorie,
    coalesce(e.nom, p.etablissement_declare),
    t.depart_ville, t.destination_nom, t.destination_ville,
    t.date_debut, t.date_fin, t.jours, t.heure_arrivee, t.heure_retour,
    t.places,
    (t.places - (select count(*) from reservations r where r.trajet_id = t.id and r.statut = 'acceptee'))::integer,
    t.commentaire,
    round(c.detour)::integer, c.aller_ok, c.retour_ok, c.avance_min, c.attente_min,
    c.dates_communes, demande.n, c.jours_communs,
    round(
      40 * (1 - c.detour / greatest(t.detour_max_km, 1))
      + 25 * (1 - (case when c.aller_ok and c.retour_ok then (c.avance_min + c.attente_min) / 2.0
                        when c.aller_ok then c.avance_min else c.attente_min end)::numeric / greatest(p_marge, 1))
      + 20 * least(1, c.dates_communes::numeric / demande.n)
      + 15 * (case when c.aller_ok and (p_retour is null or c.retour_ok) then 1 else 0 end)
    )::integer as score,
    (select r.statut from reservations r where r.trajet_id = t.id and r.passager_id = auth.uid()),
    (select round(avg(a.note), 1) from avis a where a.cible_id = t.conducteur_id and not a.masque),
    (select count(*) from avis a where a.cible_id = t.conducteur_id and not a.masque)::integer,
    p.photo_path,
    t.heure_depart,
    e.id is not null
  from trajets_compatibles(auth.uid(), p_dep_lat, p_dep_lng, p_dest_lat, p_dest_lng,
         p_debut, p_fin, p_jours, p_arrivee, p_retour, least(greatest(p_marge, 15), 180)) c
  join trajets t on t.id = c.trajet_id
  join profils p on p.id = t.conducteur_id
  left join etablissements e on e.id = p.etablissement_id
  cross join demande
  where est_verifie()
  order by score desc, c.dates_communes desc;
$$;

-- Mes recherches enregistrées, avec le nombre de trajets compatibles
-- et le nombre de trajets publiés depuis ma dernière consultation.
create or replace function public.mes_besoins()
returns table (
  id uuid, depart_ville text, depart_lat double precision, depart_lng double precision,
  destination_ville text, dest_lat double precision, dest_lng double precision,
  date_debut date, date_fin date, jours smallint[], heure_arrivee time, heure_retour time, marge_min smallint,
  nb_trajets integer, nb_nouveaux integer
)
language sql stable security definer set search_path = public as $$
  select b.id, b.depart_ville, b.depart_lat, b.depart_lng, b.destination_ville, b.dest_lat, b.dest_lng,
    b.date_debut, b.date_fin, b.jours, b.heure_arrivee, b.heure_retour, b.marge_min,
    (select count(*) from trajets_compatibles(b.membre_id, b.depart_lat, b.depart_lng, b.dest_lat, b.dest_lng,
        b.date_debut, b.date_fin, b.jours, b.heure_arrivee, b.heure_retour, b.marge_min))::integer,
    (select count(*) from trajets_compatibles(b.membre_id, b.depart_lat, b.depart_lng, b.dest_lat, b.dest_lng,
        b.date_debut, b.date_fin, b.jours, b.heure_arrivee, b.heure_retour, b.marge_min) c
      where c.cree_le > b.vu_le)::integer
  from besoins b
  where est_verifie() and b.membre_id = auth.uid()
  order by b.created_at desc;
$$;

create or replace function public.nb_besoins() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from besoins where membre_id = auth.uid();
$$;

-- Ce que les autres membres recherchent en ce moment, sans aucun nom :
-- aide les conducteurs à savoir quels trajets proposer.
create or replace function public.besoins_ouverts()
returns table (
  depart_ville text, destination_ville text, jours smallint[],
  heure_arrivee time, heure_retour time, date_debut date, date_fin date
)
language sql stable security definer set search_path = public as $$
  select b.depart_ville, b.destination_ville, b.jours, b.heure_arrivee, b.heure_retour, b.date_debut, b.date_fin
  from besoins b
  join profils p on p.id = b.membre_id and p.statut = 'verifie'
  where est_verifie() and b.membre_id <> auth.uid() and b.date_fin >= current_date
  order by b.created_at desc
  limit 30;
$$;

create or replace function public.demander_reservation(p_trajet uuid, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_trajet trajets;
  v_res    reservations;
  v_prises integer;
begin
  if not est_verifie() then raise exception 'Accès réservé aux membres vérifiés.'; end if;
  select * into v_trajet from trajets where id = p_trajet for update;
  if v_trajet.id is null or not v_trajet.actif then raise exception 'Ce trajet n''est plus disponible.'; end if;
  if v_trajet.conducteur_id = auth.uid() then raise exception 'Vous ne pouvez pas réserver votre propre trajet.'; end if;
  if v_trajet.date_fin < current_date then raise exception 'Ce trajet est terminé.'; end if;

  select count(*) into v_prises from reservations where trajet_id = p_trajet and statut = 'acceptee';
  if v_prises >= v_trajet.places then raise exception 'Ce trajet est complet.'; end if;

  select * into v_res from reservations where trajet_id = p_trajet and passager_id = auth.uid();
  if v_res.id is null then
    -- « epoch » : le conducteur n'a encore rien lu de cette conversation.
    insert into reservations (trajet_id, passager_id, lu_conducteur_le) values (p_trajet, auth.uid(), 'epoch') returning * into v_res;
  elsif v_res.statut in ('annulee', 'contact') then
    update reservations set statut = 'demandee', motif_refus = null, lu_conducteur_le = 'epoch' where id = v_res.id;
  elsif v_res.statut = 'refusee' then
    raise exception 'Le conducteur a refusé cette demande.';
  else
    raise exception 'Vous avez déjà une demande en cours pour ce trajet.';
  end if;

  if nullif(trim(p_message), '') is not null then
    insert into messages (reservation_id, expediteur_id, contenu)
    values (v_res.id, auth.uid(), left(trim(p_message), 2000));
    update reservations set lu_passager_le = now() where id = v_res.id;
  end if;
  return v_res.id;
end;
$$;

-- Écrire au conducteur d'un trajet sans demander de place.
create or replace function public.contacter_conducteur(p_trajet uuid, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_trajet trajets;
  v_id     uuid;
  v_statut text;
begin
  if not est_verifie() then raise exception 'Accès réservé aux membres vérifiés.'; end if;
  if nullif(trim(p_message), '') is null then raise exception 'Écrivez votre message.'; end if;
  select * into v_trajet from trajets where id = p_trajet;
  if v_trajet.id is null or not v_trajet.actif then raise exception 'Ce trajet n''est plus disponible.'; end if;
  if v_trajet.conducteur_id = auth.uid() then raise exception 'C''est votre propre trajet.'; end if;

  select id, statut into v_id, v_statut from reservations where trajet_id = p_trajet and passager_id = auth.uid();
  if v_id is null then
    insert into reservations (trajet_id, passager_id, statut, lu_conducteur_le) values (p_trajet, auth.uid(), 'contact', 'epoch') returning id into v_id;
  elsif v_statut = 'refusee' then
    raise exception 'Le conducteur a refusé votre demande : vous ne pouvez plus lui écrire au sujet de ce trajet.';
  elsif v_statut = 'annulee' then
    -- Après une annulation, la conversation reprend comme une simple discussion.
    update reservations set statut = 'contact' where id = v_id;
  end if;
  insert into messages (reservation_id, expediteur_id, contenu) values (v_id, auth.uid(), left(trim(p_message), 2000));
  update reservations set lu_passager_le = now() where id = v_id;
  return v_id;
end;
$$;

-- Boîte de réception : toutes mes conversations, la plus récente d'abord.
drop function if exists public.mes_conversations();
create or replace function public.mes_conversations()
returns table (
  reservation_id uuid, statut text, je_conduis boolean,
  autre_id uuid, autre_prenom text, autre_initiale text,
  depart_ville text, destination_nom text,
  dernier_message text, dernier_le timestamptz, dernier_de_moi boolean, non_lus integer
)
language sql stable security definer set search_path = public as $$
  select r.id, r.statut, t.conducteur_id = auth.uid(),
    a.id, a.prenom, upper(left(a.nom, 1)),
    t.depart_ville, t.destination_nom,
    d.contenu, d.created_at, d.expediteur_id = auth.uid(),
    (select count(*) from messages m
      where m.reservation_id = r.id and m.expediteur_id <> auth.uid()
        and m.created_at > case when t.conducteur_id = auth.uid() then r.lu_conducteur_le else r.lu_passager_le end)::integer
  from reservations r
  join trajets t on t.id = r.trajet_id
  join profils a on a.id = case when t.conducteur_id = auth.uid() then r.passager_id else t.conducteur_id end
  join lateral (
    select m.contenu, m.created_at, m.expediteur_id from messages m
    where m.reservation_id = r.id order by m.created_at desc limit 1
  ) d on true
  where est_verifie() and auth.uid() in (r.passager_id, t.conducteur_id)
  order by d.created_at desc;
$$;

-- Marque une conversation comme lue par le membre connecté.
create or replace function public.marquer_lu(p_reservation uuid) returns void
language sql security definer set search_path = public as $$
  update reservations r set
    lu_passager_le = case when r.passager_id = auth.uid() then now() else r.lu_passager_le end,
    lu_conducteur_le = case when t.conducteur_id = auth.uid() then now() else r.lu_conducteur_le end
  from trajets t
  where t.id = r.trajet_id and r.id = p_reservation and auth.uid() in (r.passager_id, t.conducteur_id);
  update notifications set lu = true
  where membre_id = auth.uid() and reservation_id = p_reservation and type in ('message', 'demande') and not lu;
$$;

-- Le conducteur accepte ou refuse une demande.
drop function if exists public.repondre_reservation(uuid, boolean);
create or replace function public.repondre_reservation(p_reservation uuid, p_accepter boolean, p_motif text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res    reservations;
  v_trajet trajets;
  v_prises integer;
begin
  if not est_verifie() then raise exception 'Accès réservé aux membres vérifiés.'; end if;
  select * into v_res from reservations where id = p_reservation;
  select * into v_trajet from trajets where id = v_res.trajet_id for update;
  if v_res.id is null or v_trajet.conducteur_id <> auth.uid() then raise exception 'Réservation introuvable.'; end if;
  if v_res.statut = 'annulee' then raise exception 'Le passager a annulé sa demande.'; end if;
  if v_res.statut = 'contact' and p_accepter then raise exception 'Ce membre n''a pas demandé de place.'; end if;

  if p_accepter then
    select count(*) into v_prises from reservations
    where trajet_id = v_trajet.id and statut = 'acceptee' and id <> v_res.id;
    if v_prises >= v_trajet.places then raise exception 'Il ne reste plus de place sur ce trajet.'; end if;
    update reservations set statut = 'acceptee', motif_refus = null where id = v_res.id;
  else
    update reservations set statut = 'refusee', motif_refus = left(nullif(trim(p_motif), ''), 200) where id = v_res.id;
  end if;
end;
$$;

-- Le passager annule sa demande ou sa place.
create or replace function public.annuler_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update reservations set statut = 'annulee'
  where id = p_reservation and passager_id = auth.uid() and statut in ('demandee','acceptee');
  if not found then raise exception 'Réservation introuvable.'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. ESPACE PARTENAIRES
-- ---------------------------------------------------------------------

-- Crée un code d'accès. Un partenaire ne peut en créer que pour son
-- établissement ; un administrateur précise l'établissement.
create or replace function public.creer_code(
  p_libelle text, p_max integer, p_expire date, p_etablissement uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_etab uuid := mon_etablissement_gere();
  v_code text;
begin
  if est_admin() and p_etablissement is not null then v_etab := p_etablissement; end if;
  if v_etab is null then raise exception 'Action réservée aux établissements partenaires.'; end if;
  if p_max is not null and p_max < 1 then raise exception 'Le nombre d''utilisations doit être positif.'; end if;
  v_code := code_aleatoire('ZOE');
  insert into codes_acces (etablissement_id, code, libelle, max_utilisations, expire_le, cree_par)
  values (v_etab, v_code, left(nullif(trim(p_libelle), ''), 80), p_max, p_expire, auth.uid());
  return v_code;
end;
$$;

-- Statistiques générales d'un établissement : uniquement des totaux,
-- jamais de donnée individuelle.
create or replace function public.stats_etablissement(p_etablissement uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_etab uuid := mon_etablissement_gere();
begin
  if est_admin() and p_etablissement is not null then v_etab := p_etablissement; end if;
  if v_etab is null then raise exception 'Action réservée aux établissements partenaires.'; end if;

  return (
    with m as (
      select id from profils where etablissement_id = v_etab and role = 'membre' and statut = 'verifie'
    )
    select jsonb_build_object(
      'etablissement', (select to_jsonb(e) from (
          select nom, type, ville, quota, formule, abonnement_statut, abonnement_fin
          from etablissements where id = v_etab) e),
      'membres', (select count(*) from m),
      'trajets_actifs', (select count(*) from trajets t
          where t.conducteur_id in (select id from m) and t.actif and t.date_fin >= current_date),
      'places_proposees', (select coalesce(sum(t.places), 0) from trajets t
          where t.conducteur_id in (select id from m) and t.actif and t.date_fin >= current_date),
      'places_partagees', (select count(*) from reservations r join trajets t on t.id = r.trajet_id
          where r.statut = 'acceptee'
            and (t.conducteur_id in (select id from m) or r.passager_id in (select id from m)))
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6 bis. FICHE DES MEMBRES, AVIS ET SIGNALEMENTS
-- ---------------------------------------------------------------------

-- Inscrit une action dans le journal d'administration (usage interne).
create or replace function public.journaliser(p_action text, p_cible uuid, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into journal_admin (admin_id, action, cible_id, detail) values (auth.uid(), p_action, p_cible, left(p_detail, 300));
$$;

-- Ce qu'un membre vérifié voit d'un autre : jamais le nom complet,
-- l'e-mail, le téléphone ni les documents.
create or replace function public.fiche_membre(p_membre uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id,
    'prenom', p.prenom,
    'initiale', upper(left(p.nom, 1)),
    'categorie', p.categorie,
    'etablissement', coalesce(e.nom, p.etablissement_declare),
    -- Vrai seulement si le membre est rattaché à un établissement par un code.
    'etablissement_verifie', e.id is not null,
    'methode_verif', p.methode_verif,
    'conducteur_valide', p.conducteur_statut = 'valide',
    'membre_depuis', p.created_at,
    'vehicule', p.vehicule,
    'bio', p.bio,
    'photo_path', p.photo_path,
    'covoiturages', (select count(*) from reservations r join trajets t on t.id = r.trajet_id
        where r.statut = 'acceptee' and p.id in (r.passager_id, t.conducteur_id)),
    'note_moyenne', (select round(avg(a.note), 1) from avis a where a.cible_id = p.id and not a.masque),
    'nb_avis', (select count(*) from avis a where a.cible_id = p.id and not a.masque),
    'avis', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select a.note, a.commentaire, a.created_at, au.prenom || ' ' || upper(left(au.nom, 1)) || '.' as auteur
        from avis a join profils au on au.id = a.auteur_id
        where a.cible_id = p.id and not a.masque
        order by a.created_at desc limit 10
      ) x), '[]'::jsonb)
  )
  from profils p
  left join etablissements e on e.id = p.etablissement_id
  where p.id = p_membre and p.statut = 'verifie' and est_verifie();
$$;

-- Un passager note son conducteur, une fois le covoiturage accepté et commencé.
create or replace function public.laisser_avis(p_reservation uuid, p_note integer, p_commentaire text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res    reservations;
  v_trajet trajets;
begin
  if not est_verifie() then raise exception 'Accès réservé aux membres vérifiés.'; end if;
  if p_note is null or p_note not between 1 and 5 then raise exception 'La note va de 1 à 5.'; end if;
  select * into v_res from reservations where id = p_reservation and passager_id = auth.uid();
  if v_res.id is null or v_res.statut <> 'acceptee' then raise exception 'Vous ne pouvez noter qu''un covoiturage accepté.'; end if;
  select * into v_trajet from trajets where id = v_res.trajet_id;
  if v_trajet.date_debut > current_date then raise exception 'Vous pourrez laisser un avis après le premier trajet.'; end if;

  insert into avis (reservation_id, auteur_id, cible_id, note, commentaire)
  values (v_res.id, auth.uid(), v_trajet.conducteur_id, p_note, left(nullif(trim(p_commentaire), ''), 500))
  on conflict (reservation_id, auteur_id)
  do update set note = excluded.note, commentaire = excluded.commentaire, created_at = now();
end;
$$;

-- Signaler un membre à l'administration (5 signalements par jour au plus).
create or replace function public.signaler_membre(p_cible uuid, p_motif text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_verifie() then raise exception 'Accès réservé aux membres vérifiés.'; end if;
  if p_cible = auth.uid() then raise exception 'Vous ne pouvez pas vous signaler vous-même.'; end if;
  if char_length(coalesce(trim(p_motif), '')) < 10 then raise exception 'Décrivez le problème en quelques mots (10 caractères au moins).'; end if;
  if not exists (select 1 from profils where id = p_cible) then raise exception 'Membre introuvable.'; end if;
  if (select count(*) from signalements where auteur_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Vous avez déjà envoyé plusieurs signalements aujourd''hui.';
  end if;
  insert into signalements (auteur_id, cible_id, motif) values (auth.uid(), p_cible, left(trim(p_motif), 1000));
end;
$$;

-- Enregistre (ou retire, avec NULL) la photo de profil.
create or replace function public.definir_photo(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connectez-vous.'; end if;
  if p_path is not null and p_path not like auth.uid()::text || '/%' then raise exception 'Fichier invalide.'; end if;
  update profils set photo_path = p_path where id = auth.uid();
end;
$$;

-- Modération : masquer un avis, retirer une photo.
create or replace function public.admin_masquer_avis(p_avis uuid, p_masquer boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_cible uuid;
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  update avis set masque = p_masquer where id = p_avis returning cible_id into v_cible;
  if not found then raise exception 'Avis introuvable.'; end if;
  perform journaliser(case when p_masquer then 'Avis masqué' else 'Avis réaffiché' end, v_cible, null);
end;
$$;

create or replace function public.admin_retirer_photo(p_membre uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  update profils set photo_path = null where id = p_membre;
  perform journaliser('Photo retirée', p_membre, null);
end;
$$;

-- Liste de modération : avis récents avec les noms (administration seulement).
create or replace function public.admin_avis()
returns table (id uuid, note smallint, commentaire text, masque boolean, created_at timestamptz, auteur text, cible text, cible_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.note, a.commentaire, a.masque, a.created_at,
         au.prenom || ' ' || au.nom, c.prenom || ' ' || c.nom, c.id
  from avis a join profils au on au.id = a.auteur_id join profils c on c.id = a.cible_id
  where est_admin()
  order by a.created_at desc limit 100;
$$;

-- ---------------------------------------------------------------------
-- 6 ter. GARDE-FOUS CONTRE LES ABUS
-- ---------------------------------------------------------------------

-- Messages : 20 par minute et 400 par jour au plus, par membre.
create or replace function public.limiter_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from messages where expediteur_id = new.expediteur_id and created_at > now() - interval '1 minute') >= 20
     or (select count(*) from messages where expediteur_id = new.expediteur_id and created_at > now() - interval '1 day') >= 400 then
    raise exception 'Vous envoyez trop de messages. Patientez un instant.';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_limite on public.messages;
create trigger messages_limite before insert on public.messages
  for each row execute function public.limiter_messages();

-- Formulaire de contact public : 40 demandes par heure au plus, tous visiteurs confondus.
create or replace function public.limiter_contacts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from demandes_contact where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Trop de demandes pour le moment. Réessayez un peu plus tard.';
  end if;
  return new;
end;
$$;
drop trigger if exists contacts_limite on public.demandes_contact;
create trigger contacts_limite before insert on public.demandes_contact
  for each row execute function public.limiter_contacts();

-- Journal : toute création, modification ou suppression d'établissement.
create or replace function public.journal_etablissements() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into journal_admin (admin_id, action, detail)
  values (auth.uid(),
    case tg_op when 'INSERT' then 'Établissement créé' when 'UPDATE' then 'Établissement modifié' else 'Établissement supprimé' end,
    case when tg_op = 'DELETE' then old.nom
         else new.nom || ' · quota ' || new.quota || ' · abonnement ' || new.abonnement_statut end);
  return null;
end;
$$;
drop trigger if exists etablissements_journal on public.etablissements;
create trigger etablissements_journal after insert or update or delete on public.etablissements
  for each row execute function public.journal_etablissements();

-- ---------------------------------------------------------------------
-- 6 quater. ALERTES ET E-MAILS
--   Chaque événement important crée une alerte dans l'espace du membre et,
--   si la clé du service d'e-mails est renseignée, un e-mail court.
--   Les e-mails ne contiennent jamais le contenu des messages.
-- ---------------------------------------------------------------------

create or replace function public.texte_html(p text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- Envoie un e-mail par le service Brevo. Ne bloque jamais l'action en cours :
-- sans clé, ou si l'envoi échoue, il ne se passe simplement rien.
create or replace function public.envoyer_email(p_email text, p_prenom text, p_titre text, p_texte text, p_page text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cle  text := (select valeur from reglages_prives where nom = 'brevo_cle');
  v_url  text := coalesce((select valeur from reglages_prives where nom = 'brevo_url'), 'https://api.brevo.com/v3/smtp/email');
  v_site text := coalesce((select valeur from reglages_prives where nom = 'site'), 'https://meetzoe.fr');
  v_exp  text := coalesce((select valeur from reglages_prives where nom = 'expediteur'), 'contact@meetzoe.fr');
begin
  if v_cle is null or p_email is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('api-key', v_cle, 'content-type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object(
      'sender', jsonb_build_object('name', 'Meet Zoe', 'email', v_exp),
      'to', jsonb_build_array(jsonb_build_object('email', p_email)),
      'subject', p_titre,
      'htmlContent',
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#2b2233;max-width:520px">'
        || '<p>Bonjour ' || texte_html(p_prenom) || ',</p>'
        || '<p><strong>' || texte_html(p_titre) || '</strong></p>'
        || case when nullif(p_texte, '') is null then '' else '<p>' || texte_html(p_texte) || '</p>' end
        || '<p><a href="' || v_site || '/' || p_page || '">Ouvrir Meet Zoe</a></p>'
        || '<p style="font-size:13px;color:#6b6475">Vous recevez cet e-mail parce que vous avez un compte sur Meet Zoe. '
        || 'Pour ne plus recevoir ces alertes, décochez « Recevoir les alertes par e-mail » dans votre profil. '
        || 'Merci de ne pas répondre à cet e-mail : écrivez-nous depuis la page Contact du site.</p></div>'
    )
  );
exception when others then
  null;
end;
$$;

create or replace function public.notifier(
  p_membre uuid, p_type text, p_onglet text, p_titre text, p_texte text default null, p_reservation uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p profils;
begin
  select * into v_p from profils where id = p_membre;
  if v_p.id is null then return; end if;
  insert into notifications (membre_id, type, onglet, titre, texte, reservation_id)
  values (p_membre, p_type, p_onglet, left(p_titre, 200), left(p_texte, 500), p_reservation);
  -- Un compte suspendu ne reçoit plus que les e-mails qui concernent son compte.
  if v_p.notif_email and (v_p.statut <> 'suspendu' or p_type = 'compte') then
    perform envoyer_email(v_p.email, v_p.prenom, p_titre, p_texte,
      case when p_type = 'admin' then 'admin.html' else 'espace.html' end);
  end if;
end;
$$;

create or replace function public.notifier_admins(p_titre text, p_texte text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  for v_id in select id from profils where role = 'admin' and statut = 'verifie' loop
    -- Une seule alerte par sujet tant qu'elle n'est pas lue : un afflux de
    -- messages de contact ne peut pas épuiser le quota d'e-mails.
    if not exists (select 1 from notifications where membre_id = v_id and type = 'admin' and titre = p_titre and not lu) then
      perform notifier(v_id, 'admin', 'admin', p_titre, p_texte);
    end if;
  end loop;
end;
$$;

create or replace function public.nom_court(p_membre uuid) returns text
language sql stable security definer set search_path = public as $$
  select prenom || ' ' || upper(left(nom, 1)) || '.' from profils where id = p_membre;
$$;

-- Le membre marque ses alertes comme lues (toutes, ou celles d'un onglet).
create or replace function public.marquer_notifications(p_onglet text default null) returns void
language sql security definer set search_path = public as $$
  update notifications set lu = true
  where membre_id = auth.uid() and not lu and (p_onglet is null or onglet = p_onglet);
$$;

-- Demandes de place, réponses et annulations.
create or replace function public.notif_reservations() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_t    trajets;
  v_pass text := nom_court(new.passager_id);
  v_cond text;
  v_traj text;
  v_motif text := case when new.motif_refus is null then '' else ' Motif indiqué : ' || rtrim(new.motif_refus, '. ') || '.' end;
begin
  if tg_op = 'UPDATE' and new.statut = old.statut then return null; end if;
  select * into v_t from trajets where id = new.trajet_id;
  if v_t.id is null then return null; end if;
  v_cond := nom_court(v_t.conducteur_id);
  v_traj := 'Trajet ' || v_t.depart_ville || ' → ' || v_t.destination_nom || '.';

  if new.statut = 'demandee' then
    perform notifier(v_t.conducteur_id, 'demande', 'trajets', v_pass || ' demande une place',
      v_traj || ' Répondez depuis « Mes trajets ».', new.id);
  elsif tg_op = 'UPDATE' and new.statut = 'acceptee' then
    perform notifier(new.passager_id, 'reponse', 'reservations', v_cond || ' a accepté votre demande',
      v_traj || ' Organisez-vous ensemble par message.', new.id);
  elsif tg_op = 'UPDATE' and new.statut = 'refusee' and old.statut = 'acceptee' then
    perform notifier(new.passager_id, 'reponse', 'reservations', v_cond || ' a retiré votre place',
      v_traj || v_motif || ' Vous pouvez chercher un autre trajet.', new.id);
  elsif tg_op = 'UPDATE' and new.statut = 'refusee' and old.statut = 'demandee' then
    perform notifier(new.passager_id, 'reponse', 'reservations', v_cond || ' n''a pas retenu votre demande',
      v_traj || v_motif || ' Vous pouvez chercher un autre trajet.', new.id);
  elsif tg_op = 'UPDATE' and new.statut = 'annulee' and old.statut = 'acceptee' then
    perform notifier(v_t.conducteur_id, 'annulation', 'trajets', v_pass || ' a annulé sa place',
      v_traj || ' La place est de nouveau libre.', new.id);
  elsif tg_op = 'UPDATE' and new.statut = 'annulee' and old.statut = 'demandee' then
    perform notifier(v_t.conducteur_id, 'annulation', 'trajets', v_pass || ' a annulé sa demande', v_traj, new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists reservations_notif on public.reservations;
create trigger reservations_notif after insert or update on public.reservations
  for each row execute function public.notif_reservations();

-- Nouveau message : une seule alerte tant que la précédente n'a pas été lue.
create or replace function public.notif_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_r    reservations;
  v_t    trajets;
  v_dest uuid;
begin
  select * into v_r from reservations where id = new.reservation_id;
  select * into v_t from trajets where id = v_r.trajet_id;
  if v_t.id is null then return null; end if;
  v_dest := case when new.expediteur_id = v_r.passager_id then v_t.conducteur_id else v_r.passager_id end;
  if exists (select 1 from notifications
             where membre_id = v_dest and reservation_id = v_r.id and not lu
               and (type = 'message' or (type = 'demande' and created_at = now()))) then
    return null;
  end if;
  perform notifier(v_dest, 'message', 'messages', nom_court(new.expediteur_id) || ' vous a écrit',
    'Au sujet du trajet ' || v_t.depart_ville || ' → ' || v_t.destination_nom || '. Lisez son message sur le site.', v_r.id);
  return null;
end;
$$;
drop trigger if exists messages_notif on public.messages;
create trigger messages_notif after insert on public.messages
  for each row execute function public.notif_messages();

-- Compte vérifié ou refusé, conducteur validé ou refusé, dossiers à contrôler.
create or replace function public.notif_profils() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'verifie' then
      perform notifier(new.id, 'compte', 'recherche', 'Votre compte Meet Zoe est vérifié',
        'Vous pouvez maintenant chercher un trajet ou en proposer un.');
    elsif new.statut = 'refuse' then
      perform notifier(new.id, 'compte', 'recherche', 'Votre justificatif n''a pas été accepté',
        coalesce('Motif : ' || rtrim(new.motif_refus, '. ') || '. ', '') || 'Vous pouvez en envoyer un autre depuis votre espace.');
    elsif new.statut = 'suspendu' then
      perform notifier(new.id, 'compte', 'recherche', 'Votre compte Meet Zoe est suspendu',
        coalesce('Motif : ' || rtrim(new.motif_refus, '. ') || '. ', '') || 'Pour toute question, écrivez-nous depuis la page Contact.');
    end if;
  end if;
  if new.conducteur_statut is distinct from old.conducteur_statut then
    if new.conducteur_statut = 'valide' then
      perform notifier(new.id, 'conducteur', 'proposer', 'Vous êtes validé comme conducteur',
        'Vous pouvez publier votre premier trajet.');
    elsif new.conducteur_statut = 'refuse' then
      perform notifier(new.id, 'conducteur', 'proposer', 'Vos documents de conducteur n''ont pas été acceptés',
        coalesce('Motif : ' || rtrim(new.conducteur_motif, '. ') || '. ', '') || 'Vous pouvez les renvoyer depuis « Proposer un trajet ».');
    elsif new.conducteur_statut = 'en_attente' then
      perform notifier_admins('Documents de conducteur à contrôler', new.prenom || ' ' || new.nom);
    end if;
  end if;
  if new.justificatif_path is not null and new.justificatif_path is distinct from old.justificatif_path then
    perform notifier_admins('Justificatif à contrôler', new.prenom || ' ' || new.nom);
  end if;
  return null;
end;
$$;
drop trigger if exists profils_notif on public.profils;
create trigger profils_notif after update on public.profils
  for each row execute function public.notif_profils();

-- Le nom et le prénom ont été contrôlés avec la pièce d'identité :
-- un conducteur ne peut plus les changer lui-même.
create or replace function public.verrouiller_nom() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.prenom is distinct from old.prenom or new.nom is distinct from old.nom)
     and (old.conducteur_statut in ('en_attente', 'valide')
          or (old.statut = 'verifie' and old.methode_verif = 'justificatif')
          or old.justificatif_path is not null)
     and auth.uid() = old.id then
    raise exception 'Votre nom a été contrôlé avec votre justificatif ou votre pièce d''identité. Pour le corriger, écrivez-nous depuis la page Contact.';
  end if;
  return new;
end;
$$;
drop trigger if exists profils_nom_verrou on public.profils;
create trigger profils_nom_verrou before update on public.profils
  for each row execute function public.verrouiller_nom();

-- Trajet modifié, mis en pause, réactivé ou supprimé : les passagers sont prévenus.
create or replace function public.notif_trajets() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cond  text := coalesce(nom_court(old.conducteur_id), 'Le conducteur');
  v_traj  text := 'Trajet ' || old.depart_ville || ' → ' || old.destination_nom || '.';
  v_titre text;
  v_texte text;
  v_r     record;
begin
  if tg_op = 'DELETE' then
    v_titre := v_cond || ' a supprimé son trajet';
    v_texte := v_traj || ' Votre demande n''existe plus. Vous pouvez chercher un autre trajet.';
  elsif new.actif is distinct from old.actif then
    v_titre := v_cond || case when new.actif then ' a réactivé son trajet' else ' a mis son trajet en pause' end;
    v_texte := v_traj || case when new.actif then '' else ' Ce trajet n''est pas assuré pour le moment.' end;
  elsif (new.heure_depart, new.heure_arrivee, new.heure_retour, new.date_debut, new.date_fin, new.jours, new.depart_ville, new.destination_nom)
        is distinct from
        (old.heure_depart, old.heure_arrivee, old.heure_retour, old.date_debut, old.date_fin, old.jours, old.depart_ville, old.destination_nom) then
    v_titre := v_cond || ' a modifié son trajet';
    v_texte := v_traj || ' Vérifiez les jours et les horaires dans « Mes réservations ».';
  else
    return null;
  end if;
  for v_r in select id, passager_id from reservations where trajet_id = old.id and statut in ('demandee', 'acceptee') loop
    perform notifier(v_r.passager_id, 'trajet', case when tg_op = 'DELETE' then 'recherche' else 'reservations' end,
      v_titre, v_texte, case when tg_op = 'DELETE' then null else v_r.id end);
  end loop;
  -- Avant une suppression, il faut rendre la ligne pour que la suppression ait lieu.
  if tg_op = 'DELETE' then return old; end if;
  return null;
end;
$$;
drop trigger if exists trajets_notif_maj on public.trajets;
create trigger trajets_notif_maj after update on public.trajets
  for each row execute function public.notif_trajets();
drop trigger if exists trajets_notif_suppr on public.trajets;
create trigger trajets_notif_suppr before delete on public.trajets
  for each row execute function public.notif_trajets();

-- Nouveau trajet : les membres dont une recherche enregistrée correspond sont prévenus.
create or replace function public.notif_nouveau_trajet() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_b    besoins;
  v_vus  uuid[] := '{}';
begin
  if not new.actif then return null; end if;
  for v_b in select b.* from besoins b join profils p on p.id = b.membre_id and p.statut = 'verifie'
             where b.membre_id <> new.conducteur_id and b.date_fin >= current_date order by b.created_at limit 500 loop
    if v_b.membre_id = any (v_vus) then continue; end if;
    if exists (select 1 from trajets_compatibles(v_b.membre_id, v_b.depart_lat, v_b.depart_lng, v_b.dest_lat, v_b.dest_lng,
                 v_b.date_debut, v_b.date_fin, v_b.jours, v_b.heure_arrivee, v_b.heure_retour, v_b.marge_min) c
               where c.trajet_id = new.id) then
      v_vus := v_vus || v_b.membre_id;
      perform notifier(v_b.membre_id, 'trajet', 'recherche', 'Un nouveau trajet correspond à votre recherche',
        v_b.depart_ville || ' → ' || v_b.destination_ville || '. Retrouvez-le dans « Mes recherches enregistrées ».');
    end if;
  end loop;
  return null;
end;
$$;
drop trigger if exists trajets_notif_nouveau on public.trajets;
create trigger trajets_notif_nouveau after insert on public.trajets
  for each row execute function public.notif_nouveau_trajet();

-- Signalements et messages de contact : l'administration est prévenue.
create or replace function public.notif_admin_arrivee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'signalements' then
    perform notifier_admins('Nouveau signalement à traiter', 'Ouvrez l''onglet « Modération ».');
  else
    perform notifier_admins('Nouveau message de contact', left(new.nom || coalesce(' · ' || new.organisme, ''), 200));
  end if;
  return null;
end;
$$;
drop trigger if exists signalements_notif on public.signalements;
create trigger signalements_notif after insert on public.signalements
  for each row execute function public.notif_admin_arrivee();
drop trigger if exists contacts_notif on public.demandes_contact;
create trigger contacts_notif after insert on public.demandes_contact
  for each row execute function public.notif_admin_arrivee();

-- Une panne rencontrée dans le navigateur est notée (300 par jour au plus).
create or replace function public.signaler_erreur(p_page text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from erreurs_client where created_at > now() - interval '1 day') >= 300 then return; end if;
  if exists (select 1 from erreurs_client where message = left(p_message, 500) and created_at > now() - interval '1 day') then return; end if;
  insert into erreurs_client (membre_id, page, message) values (auth.uid(), left(p_page, 80), left(p_message, 500));
  delete from erreurs_client where created_at < now() - interval '60 days';
end;
$$;

-- Conversation supprimée (trajet ou compte effacé) : ses alertes ne restent pas « non lues ».
create or replace function public.reservations_nettoyage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update notifications set lu = true where reservation_id = old.id and not lu;
  return old;
end;
$$;
drop trigger if exists reservations_nettoyage on public.reservations;
create trigger reservations_nettoyage before delete on public.reservations
  for each row execute function public.reservations_nettoyage();
update public.notifications n set lu = true
where n.type = 'message' and not n.lu and n.reservation_id is not null
  and not exists (select 1 from public.reservations r where r.id = n.reservation_id);

-- On ne peut pas proposer moins de places que de passagers déjà acceptés.
create or replace function public.verifier_places() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  select count(*) into v_n from reservations where trajet_id = new.id and statut = 'acceptee';
  if new.places < v_n then
    raise exception 'Vous avez déjà accepté % passager(s) : gardez au moins autant de places, ou retirez d''abord un passager.', v_n;
  end if;
  return new;
end;
$$;
drop trigger if exists trajets_places on public.trajets;
create trigger trajets_places before update of places on public.trajets
  for each row execute function public.verifier_places();

-- État des e-mails d'alerte, pour l'administration : la clé est-elle
-- enregistrée, et combien d'envois ont échoué depuis 24 heures ?
create or replace function public.etat_emails() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_envois integer := 0;
  v_echecs integer := 0;
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  begin
    select count(*), count(*) filter (where status_code is null or status_code >= 400)
      into v_envois, v_echecs
    from net._http_response where created > now() - interval '1 day';
  exception when others then
    v_envois := 0; v_echecs := 0;
  end;
  return jsonb_build_object(
    'cle', exists (select 1 from reglages_prives where nom = 'brevo_cle'),
    'envois', v_envois, 'echecs', v_echecs);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. ADMINISTRATION
-- ---------------------------------------------------------------------

drop function if exists public.admin_definir_statut(uuid, text);
create or replace function public.admin_definir_statut(p_membre uuid, p_statut text, p_motif text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  if p_statut not in ('en_attente','verifie','refuse','suspendu') then raise exception 'Statut inconnu.'; end if;
  if p_membre = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre statut.'; end if;
  -- Le justificatif doit avoir été réellement effacé avant d'enregistrer la décision.
  if p_statut in ('verifie','refuse') and exists (
       select 1 from storage.objects where bucket_id = 'justificatifs' and name like p_membre::text || '/%') then
    raise exception 'Le justificatif n''a pas pu être effacé. Réessayez dans un instant.';
  end if;
  update profils set
    statut = p_statut,
    methode_verif = case when p_statut = 'verifie' then coalesce(methode_verif, 'admin') else methode_verif end,
    verifie_le = case when p_statut = 'verifie' then coalesce(verifie_le, now()) else verifie_le end,
    justificatif_path = case when p_statut in ('verifie','refuse') then null else justificatif_path end,
    motif_refus = case when p_statut in ('refuse','suspendu') then left(nullif(trim(p_motif), ''), 200) else null end
  where id = p_membre
  returning email into v_email;
  if not found then raise exception 'Membre introuvable.'; end if;
  if p_statut <> 'suspendu' then
    delete from adresses_bloquees where empreinte = empreinte_email(v_email);
  else
    -- Les trajets d'un membre suspendu sont mis en pause : ses passagers sont prévenus.
    update trajets set actif = false where conducteur_id = p_membre and actif;
  end if;
  perform journaliser('Statut du membre : ' || p_statut, p_membre, p_motif);
end;
$$;

-- Valide ou refuse un conducteur après contrôle de ses documents.
-- Les fichiers doivent avoir été effacés du stockage avant la décision :
-- la base le vérifie elle-même, sans se fier au navigateur.
drop function if exists public.admin_valider_conducteur(uuid, boolean);
create or replace function public.admin_valider_conducteur(p_membre uuid, p_valider boolean, p_motif text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'documents-conducteur' and name like p_membre::text || '/%') then
    raise exception 'Les documents n''ont pas pu être effacés. Réessayez dans un instant.';
  end if;
  update profils set
    conducteur_statut = case when p_valider then 'valide' else 'refuse' end,
    conducteur_valide_le = case when p_valider then now() else null end,
    conducteur_motif = case when p_valider then null else left(nullif(trim(p_motif), ''), 200) end,
    permis_path = null, identite_path = null
  where id = p_membre;
  if not found then raise exception 'Membre introuvable.'; end if;
  perform journaliser(case when p_valider then 'Conducteur validé' else 'Conducteur refusé' end, p_membre, p_motif);
  -- Un conducteur refusé ne peut plus proposer ses trajets.
  if not p_valider then update trajets set actif = false where conducteur_id = p_membre and actif; end if;
end;
$$;

-- Fichiers restés dans le stockage sans être rattachés à un dossier en cours
-- (dépôt interrompu, ancien envoi remplacé…). L'administration les efface.
create or replace function public.fichiers_orphelins()
returns table (bucket text, chemin text)
language sql stable security definer set search_path = public as $$
  select o.bucket_id, o.name
  from storage.objects o
  left join profils p on p.id::text = (storage.foldername(o.name))[1]
  where est_admin()
    and o.bucket_id in ('justificatifs', 'documents-conducteur', 'photos')
    and o.created_at < now() - interval '1 hour'
    and (p.id is null
      or (o.bucket_id = 'justificatifs' and o.name is distinct from p.justificatif_path)
      or (o.bucket_id = 'documents-conducteur' and o.name is distinct from p.permis_path and o.name is distinct from p.identite_path)
      or (o.bucket_id = 'photos' and o.name is distinct from p.photo_path))
  limit 200;
$$;

-- Donne un rôle. Pour « partenaire », l'établissement géré est obligatoire.
create or replace function public.admin_definir_role(p_membre uuid, p_role text, p_etablissement uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  if p_role not in ('membre','partenaire','admin') then raise exception 'Rôle inconnu.'; end if;
  if p_membre = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.'; end if;
  if p_role = 'partenaire' and p_etablissement is null then raise exception 'Choisissez l''établissement géré.'; end if;
  -- Le rôle ne vérifie pas le compte à la place du contrôle : le justificatif
  -- passe toujours par la validation, qui l'efface.
  if p_role in ('partenaire','admin') and (select statut from profils where id = p_membre) is distinct from 'verifie' then
    raise exception 'Validez d''abord ce membre, puis donnez-lui ce rôle.';
  end if;
  update profils set
    role = p_role,
    etablissement_id = case when p_role = 'partenaire' then p_etablissement else etablissement_id end
  where id = p_membre;
  if not found then raise exception 'Membre introuvable.'; end if;
  perform journaliser('Rôle du membre : ' || p_role, p_membre, null);
end;
$$;

-- Droit à l'effacement (RGPD) : un membre supprime son propre compte.
create or replace function public.supprimer_mon_compte() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profil profils;
begin
  select * into v_profil from profils where id = auth.uid();
  if v_profil.id is null then raise exception 'Connectez-vous.'; end if;
  -- Aucun fichier (justificatif, permis, pièce d'identité, photo) ne doit rester.
  if exists (select 1 from storage.objects
             where bucket_id in ('justificatifs', 'documents-conducteur', 'photos')
               and name like v_profil.id::text || '/%') then
    raise exception 'Vos fichiers n''ont pas pu être effacés. Réessayez dans un instant.';
  end if;
  if v_profil.statut = 'suspendu' then
    insert into adresses_bloquees (empreinte) values (empreinte_email(v_profil.email)) on conflict do nothing;
  end if;
  -- Les conducteurs chez qui ce membre avait une demande ou une place sont prévenus.
  update reservations set statut = 'annulee' where passager_id = v_profil.id and statut in ('demandee', 'acceptee');
  delete from auth.users where id = v_profil.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. VUES PUBLIQUES (informations limitées, visibles des membres vérifiés)
-- ---------------------------------------------------------------------

-- Ce qu'un membre voit d'un autre : prénom, initiale du nom, catégorie,
-- établissement. Jamais l'e-mail, le téléphone ou le justificatif.
create or replace view public.membres as
  select p.id, p.prenom, upper(left(p.nom, 1)) as initiale, p.categorie,
         coalesce(e.nom, p.etablissement_declare) as etablissement,
         e.id is not null as etablissement_verifie
  from public.profils p
  left join public.etablissements e on e.id = p.etablissement_id
  where p.statut = 'verifie' and public.est_verifie();

create or replace view public.etablissements_publics as
  select id, nom, type, ville, lat, lng
  from public.etablissements
  where public.est_verifie();

-- ---------------------------------------------------------------------
-- 9. DROITS ET SÉCURITÉ LIGNE PAR LIGNE
-- ---------------------------------------------------------------------

alter table public.etablissements   enable row level security;
alter table public.profils          enable row level security;
alter table public.codes_acces      enable row level security;
alter table public.invitations      enable row level security;
alter table public.trajets          enable row level security;
alter table public.reservations     enable row level security;
alter table public.messages         enable row level security;
alter table public.demandes_contact enable row level security;
alter table public.besoins          enable row level security;
alter table public.avis             enable row level security;
alter table public.signalements     enable row level security;
alter table public.journal_admin    enable row level security;
alter table public.notifications    enable row level security;
alter table public.reglages_prives  enable row level security;
alter table public.adresses_bloquees enable row level security;
alter table public.erreurs_client   enable row level security;

-- On retire tous les droits par défaut, puis on n'accorde que le nécessaire.
revoke all on public.etablissements, public.profils, public.codes_acces, public.invitations,
              public.trajets, public.reservations, public.messages, public.demandes_contact,
              public.besoins, public.avis, public.signalements, public.journal_admin,
              public.membres, public.etablissements_publics,
              public.notifications, public.reglages_prives, public.adresses_bloquees, public.erreurs_client
  from anon, authenticated;
revoke all on public.reglages_prives, public.adresses_bloquees from public;

grant select on public.membres, public.etablissements_publics to authenticated;

grant select, insert, update, delete on public.etablissements to authenticated;
grant select on public.profils to authenticated;
grant update (prenom, nom, ville, telephone, etablissement_declare, bio, vehicule, notif_email) on public.profils to authenticated;
grant select on public.notifications, public.erreurs_client to authenticated;
grant delete on public.erreurs_client to authenticated;
grant select on public.avis, public.signalements, public.journal_admin to authenticated;
grant update (statut) on public.signalements to authenticated;
grant select on public.codes_acces to authenticated;
grant update (libelle, max_utilisations, expire_le, actif) on public.codes_acces to authenticated;
grant delete on public.codes_acces to authenticated;
grant select on public.invitations to authenticated;
grant select, insert, delete on public.trajets to authenticated;
grant update (depart_ville, depart_lat, depart_lng, destination_nom, destination_ville, dest_lat, dest_lng,
              date_debut, date_fin, jours, heure_depart, heure_arrivee, heure_retour, places, detour_max_km, commentaire, actif)
  on public.trajets to authenticated;
grant select on public.reservations to authenticated;
grant select, insert, delete on public.besoins to authenticated;
grant update (vu_le, date_debut, date_fin) on public.besoins to authenticated;
grant select, insert on public.messages to authenticated;
grant insert (nom, email, organisme, message) on public.demandes_contact to anon, authenticated;
grant select, delete on public.demandes_contact to authenticated;
grant update (traitee) on public.demandes_contact to authenticated;

-- Établissements : l'administration gère tout, le partenaire voit le sien.
drop policy if exists etab_lecture on public.etablissements;
create policy etab_lecture on public.etablissements for select to authenticated
  using (public.est_admin() or id = public.mon_etablissement_gere());
drop policy if exists etab_admin_insert on public.etablissements;
create policy etab_admin_insert on public.etablissements for insert to authenticated
  with check (public.est_admin());
drop policy if exists etab_admin_update on public.etablissements;
create policy etab_admin_update on public.etablissements for update to authenticated
  using (public.est_admin()) with check (public.est_admin());
drop policy if exists etab_admin_delete on public.etablissements;
create policy etab_admin_delete on public.etablissements for delete to authenticated
  using (public.est_admin());

-- Profils : chacun voit et modifie le sien ; l'administration voit tout.
drop policy if exists profil_lecture on public.profils;
create policy profil_lecture on public.profils for select to authenticated
  using (id = auth.uid() or public.est_admin());
drop policy if exists profil_modification on public.profils;
create policy profil_modification on public.profils for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Codes d'accès : le partenaire gère ceux de son établissement.
drop policy if exists codes_lecture on public.codes_acces;
create policy codes_lecture on public.codes_acces for select to authenticated
  using (public.est_admin() or etablissement_id = public.mon_etablissement_gere());
drop policy if exists codes_modification on public.codes_acces;
create policy codes_modification on public.codes_acces for update to authenticated
  using (public.est_admin() or etablissement_id = public.mon_etablissement_gere())
  with check (public.est_admin() or etablissement_id = public.mon_etablissement_gere());
drop policy if exists codes_suppression on public.codes_acces;
create policy codes_suppression on public.codes_acces for delete to authenticated
  using (public.est_admin() or etablissement_id = public.mon_etablissement_gere());

-- Invitations : chacun voit les siennes.
drop policy if exists invitations_lecture on public.invitations;
create policy invitations_lecture on public.invitations for select to authenticated
  using (cree_par = auth.uid() or public.est_admin());

-- Trajets : visibles des seuls membres vérifiés ; chacun gère les siens.
drop policy if exists trajets_lecture on public.trajets;
create policy trajets_lecture on public.trajets for select to authenticated
  using (public.est_verifie() and (
    conducteur_id = auth.uid() or public.est_admin()
    or exists (select 1 from public.reservations r where r.trajet_id = trajets.id and r.passager_id = auth.uid())));
drop policy if exists trajets_creation on public.trajets;
create policy trajets_creation on public.trajets for insert to authenticated
  with check (public.est_conducteur() and conducteur_id = auth.uid());
drop policy if exists trajets_modification on public.trajets;
create policy trajets_modification on public.trajets for update to authenticated
  using (public.est_conducteur() and conducteur_id = auth.uid())
  with check (conducteur_id = auth.uid());
drop policy if exists trajets_suppression on public.trajets;
create policy trajets_suppression on public.trajets for delete to authenticated
  using (conducteur_id = auth.uid() or public.est_admin());

-- Recherches enregistrées : chacun gère les siennes (10 au maximum).
drop policy if exists besoins_lecture on public.besoins;
create policy besoins_lecture on public.besoins for select to authenticated
  using (membre_id = auth.uid());
drop policy if exists besoins_creation on public.besoins;
create policy besoins_creation on public.besoins for insert to authenticated
  with check (public.est_verifie() and membre_id = auth.uid() and public.nb_besoins() < 10);
drop policy if exists besoins_modification on public.besoins;
create policy besoins_modification on public.besoins for update to authenticated
  using (membre_id = auth.uid()) with check (membre_id = auth.uid());
drop policy if exists besoins_suppression on public.besoins;
create policy besoins_suppression on public.besoins for delete to authenticated
  using (membre_id = auth.uid());

-- Avis : on lit les siens ; les autres passent par la fiche du membre.
drop policy if exists avis_lecture on public.avis;
create policy avis_lecture on public.avis for select to authenticated
  using (auteur_id = auth.uid() or public.est_admin());

-- Signalements et journal : réservés à l'administration.
drop policy if exists signalements_lecture on public.signalements;
create policy signalements_lecture on public.signalements for select to authenticated
  using (public.est_admin());
drop policy if exists signalements_traitement on public.signalements;
create policy signalements_traitement on public.signalements for update to authenticated
  using (public.est_admin()) with check (public.est_admin());
drop policy if exists journal_lecture on public.journal_admin;
create policy journal_lecture on public.journal_admin for select to authenticated
  using (public.est_admin());

-- Réservations : visibles du passager et du conducteur concernés.
drop policy if exists reservations_lecture on public.reservations;
create policy reservations_lecture on public.reservations for select to authenticated
  using ((public.participe_reservation(id) and public.est_verifie()) or public.est_admin());

-- Messages : uniquement entre le passager et le conducteur d'une réservation.
drop policy if exists messages_lecture on public.messages;
create policy messages_lecture on public.messages for select to authenticated
  using (public.participe_reservation(reservation_id) and public.est_verifie());

-- Alertes : chacun lit les siennes. Pannes : lues par l'administration.
drop policy if exists notifications_lecture on public.notifications;
create policy notifications_lecture on public.notifications for select to authenticated
  using (membre_id = auth.uid());
drop policy if exists erreurs_lecture on public.erreurs_client;
create policy erreurs_lecture on public.erreurs_client for select to authenticated
  using (public.est_admin());
drop policy if exists erreurs_suppression on public.erreurs_client;
create policy erreurs_suppression on public.erreurs_client for delete to authenticated
  using (public.est_admin());
drop policy if exists messages_envoi on public.messages;
create policy messages_envoi on public.messages for insert to authenticated
  with check (public.est_verifie() and expediteur_id = auth.uid() and public.conversation_ouverte(reservation_id));

-- Demandes de contact : tout le monde peut écrire, seule l'administration lit.
drop policy if exists contact_envoi on public.demandes_contact;
create policy contact_envoi on public.demandes_contact for insert to anon, authenticated
  with check (true);
drop policy if exists contact_lecture on public.demandes_contact;
create policy contact_lecture on public.demandes_contact for select to authenticated
  using (public.est_admin());
drop policy if exists contact_modification on public.demandes_contact;
create policy contact_modification on public.demandes_contact for update to authenticated
  using (public.est_admin()) with check (public.est_admin());
drop policy if exists contact_suppression on public.demandes_contact;
create policy contact_suppression on public.demandes_contact for delete to authenticated
  using (public.est_admin());

-- Fonctions : fermées par défaut, ouvertes une par une.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.est_verifie(), public.est_admin(), public.est_conducteur(), public.mon_etablissement_gere(),
  public.soumettre_documents_conducteur(text, text, text), public.admin_valider_conducteur(uuid, boolean, text),
  public.contacter_conducteur(uuid, text), public.mes_conversations(), public.marquer_lu(uuid),
  public.participe_reservation(uuid), public.conversation_ouverte(uuid),
  public.fiche_membre(uuid), public.laisser_avis(uuid, integer, text), public.signaler_membre(uuid, text),
  public.definir_photo(text), public.admin_masquer_avis(uuid, boolean), public.admin_retirer_photo(uuid), public.admin_avis(),
  public.utiliser_code(text), public.creer_invitation(), public.utiliser_invitation(text),
  public.soumettre_justificatif(text),
  public.rechercher_trajets_periode(double precision, double precision, double precision, double precision, date, date, smallint[], time, time, integer),
  public.mes_besoins(), public.nb_besoins(), public.besoins_ouverts(),
  public.demander_reservation(uuid, text), public.repondre_reservation(uuid, boolean, text),
  public.annuler_reservation(uuid),
  public.creer_code(text, integer, date, uuid), public.stats_etablissement(uuid),
  public.admin_definir_statut(uuid, text, text), public.admin_definir_role(uuid, text, uuid),
  public.supprimer_mon_compte(), public.marquer_notifications(text), public.fichiers_orphelins(), public.etat_emails()
  to authenticated;
grant execute on function public.version_base(), public.signaler_erreur(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. STOCKAGE PRIVÉ DES JUSTIFICATIFS (PDF ou image, 5 Mo maximum)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('justificatifs', 'justificatifs', false, 5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists justificatifs_depot on storage.objects;
create policy justificatifs_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'justificatifs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists justificatifs_lecture on storage.objects;
create policy justificatifs_lecture on storage.objects for select to authenticated
  using (bucket_id = 'justificatifs' and ((storage.foldername(name))[1] = auth.uid()::text or public.est_admin()));
drop policy if exists justificatifs_suppression on storage.objects;
create policy justificatifs_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'justificatifs' and ((storage.foldername(name))[1] = auth.uid()::text or public.est_admin()));

-- ---------------------------------------------------------------------
-- 11. STOCKAGE PRIVÉ DES DOCUMENTS DES CONDUCTEURS
--     (permis et pièce d'identité, effacés après contrôle)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents-conducteur', 'documents-conducteur', false, 5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists documents_conducteur_depot on storage.objects;
create policy documents_conducteur_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'documents-conducteur' and (storage.foldername(name))[1] = auth.uid()::text and public.est_verifie());
drop policy if exists documents_conducteur_lecture on storage.objects;
create policy documents_conducteur_lecture on storage.objects for select to authenticated
  using (bucket_id = 'documents-conducteur' and ((storage.foldername(name))[1] = auth.uid()::text or public.est_admin()));
drop policy if exists documents_conducteur_suppression on storage.objects;
create policy documents_conducteur_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'documents-conducteur' and ((storage.foldername(name))[1] = auth.uid()::text or public.est_admin()));

-- ---------------------------------------------------------------------
-- 12. PHOTOS DE PROFIL (visibles des seuls membres vérifiés)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists photos_depot on storage.objects;
create policy photos_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.est_verifie());
drop policy if exists photos_lecture on storage.objects;
create policy photos_lecture on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.est_verifie()));
drop policy if exists photos_suppression on storage.objects;
create policy photos_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.est_admin()));
