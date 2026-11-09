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
create index if not exists trajets_conducteur_idx on public.trajets (conducteur_id);
create index if not exists trajets_dates_idx on public.trajets (date_debut, date_fin) where actif;

create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  trajet_id   uuid not null references public.trajets (id) on delete cascade,
  passager_id uuid not null references public.profils (id) on delete cascade,
  statut      text not null default 'demandee' check (statut in ('demandee','acceptee','refusee','annulee')),
  created_at  timestamptz not null default now(),
  unique (trajet_id, passager_id)
);
create index if not exists reservations_passager_idx on public.reservations (passager_id);

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  expediteur_id  uuid not null references public.profils (id) on delete cascade,
  contenu        text not null check (char_length(contenu) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index if not exists messages_reservation_idx on public.messages (reservation_id, created_at);

create table if not exists public.demandes_contact (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null check (char_length(nom) between 1 and 120),
  email      text not null check (char_length(email) between 5 and 160 and email like '%_@_%'),
  organisme  text check (char_length(organisme) <= 160),
  message    text check (char_length(message) <= 2000),
  traitee    boolean not null default false,
  created_at timestamptz not null default now()
);

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
  insert into profils (id, email, prenom, nom, categorie, etablissement_declare, ville)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(m ->> 'prenom'), ''), 'Membre'), 60),
    left(coalesce(nullif(trim(m ->> 'nom'), ''), '-'), 60),
    v_categorie,
    left(nullif(trim(m ->> 'etablissement_declare'), ''), 120),
    left(nullif(trim(m ->> 'ville'), ''), 80)
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

-- 4a. Code d'établissement : contrôle l'abonnement et le quota.
create or replace function public.utiliser_code(p_code text) returns text
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

  select * into v_code from codes_acces where code = upper(trim(p_code)) for update;
  if v_code.id is null or not v_code.actif then raise exception 'Ce code n''est pas valide.'; end if;
  if v_code.expire_le is not null and v_code.expire_le < current_date then raise exception 'Ce code a expiré.'; end if;
  if v_code.max_utilisations is not null and v_code.utilisations >= v_code.max_utilisations then
    raise exception 'Ce code a atteint son nombre maximal d''utilisations.';
  end if;

  select * into v_etab from etablissements where id = v_code.etablissement_id for update;
  if v_etab.abonnement_statut not in ('essai','actif')
     or (v_etab.abonnement_fin is not null and v_etab.abonnement_fin < current_date) then
    raise exception 'L''abonnement de cet établissement n''est pas actif.';
  end if;

  select count(*) into v_nb from profils
  where etablissement_id = v_etab.id and role = 'membre' and statut = 'verifie';
  if v_nb >= v_etab.quota then
    raise exception 'Le quota de membres de cet établissement est atteint.';
  end if;

  update codes_acces set utilisations = utilisations + 1 where id = v_code.id;
  update profils set statut = 'verifie', methode_verif = 'code', etablissement_id = v_etab.id, verifie_le = now()
  where id = v_profil.id;
  return v_etab.nom;
end;
$$;

-- 4b. Invitation par un membre déjà vérifié (5 invitations par membre).
create or replace function public.creer_invitation() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not est_verifie() then raise exception 'Seuls les membres vérifiés peuvent inviter.'; end if;
  if (select count(*) from invitations where cree_par = auth.uid()) >= 5 then
    raise exception 'Vous avez utilisé vos 5 invitations.';
  end if;
  v_code := code_aleatoire('INV');
  insert into invitations (code, cree_par) values (v_code, auth.uid());
  return v_code;
end;
$$;

create or replace function public.utiliser_invitation(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profil profils;
  v_inv    invitations;
begin
  select * into v_profil from profils where id = auth.uid();
  if v_profil.id is null then raise exception 'Connectez-vous pour utiliser une invitation.'; end if;
  if v_profil.statut = 'verifie' then raise exception 'Votre compte est déjà vérifié.'; end if;
  if v_profil.statut = 'suspendu' then raise exception 'Votre compte est suspendu.'; end if;

  select * into v_inv from invitations where code = upper(trim(p_code)) for update;
  if v_inv.id is null or v_inv.utilise_par is not null then raise exception 'Cette invitation n''est pas valide.'; end if;
  if not exists (select 1 from profils where id = v_inv.cree_par and statut = 'verifie') then
    raise exception 'Cette invitation n''est plus valable.';
  end if;

  update invitations set utilise_par = v_profil.id, utilise_le = now() where id = v_inv.id;
  update profils set statut = 'verifie', methode_verif = 'invitation', invite_par = v_inv.cree_par, verifie_le = now()
  where id = v_profil.id;
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

  update profils set justificatif_path = p_path, methode_verif = 'justificatif', statut = 'en_attente'
  where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- 5. TRAJETS, RECHERCHE ET RÉSERVATIONS
-- ---------------------------------------------------------------------

-- Matching : compare la destination, la date, le jour, l'heure d'arrivée
-- et le détour imposé au conducteur pour passer prendre le passager.
create or replace function public.rechercher_trajets(
  p_dep_lat double precision, p_dep_lng double precision,
  p_dest_lat double precision, p_dest_lng double precision,
  p_date date, p_heure time
)
returns table (
  id uuid, conducteur_id uuid, prenom text, initiale text, categorie text, etablissement text,
  depart_ville text, destination_nom text, destination_ville text,
  date_debut date, date_fin date, jours smallint[], heure_arrivee time, heure_retour time,
  places smallint, places_restantes integer, commentaire text,
  detour_km integer, avance_min integer, score integer, ma_reservation text
)
language sql stable security definer set search_path = public as $$
  with candidats as (
    select t.*,
      distance_km(t.dest_lat, t.dest_lng, p_dest_lat, p_dest_lng) as d_dest,
      greatest(0,
        distance_km(t.depart_lat, t.depart_lng, p_dep_lat, p_dep_lng)
        + distance_km(p_dep_lat, p_dep_lng, t.dest_lat, t.dest_lng)
        - distance_km(t.depart_lat, t.depart_lng, t.dest_lat, t.dest_lng)) as detour,
      extract(epoch from (p_heure - t.heure_arrivee)) / 60 as avance
    from trajets t
    where est_verifie()
      and t.actif
      and t.conducteur_id <> auth.uid()
      and p_date between t.date_debut and t.date_fin
      and extract(isodow from p_date)::smallint = any (t.jours)
  )
  select c.id, c.conducteur_id, p.prenom, upper(left(p.nom, 1)), p.categorie,
    coalesce(e.nom, p.etablissement_declare),
    c.depart_ville, c.destination_nom, c.destination_ville,
    c.date_debut, c.date_fin, c.jours, c.heure_arrivee, c.heure_retour,
    c.places,
    (c.places - (select count(*) from reservations r where r.trajet_id = c.id and r.statut = 'acceptee'))::integer,
    c.commentaire,
    round(c.detour)::integer,
    round(c.avance)::integer,
    round(
      55 * (1 - c.detour / greatest(c.detour_max_km, 1))
      + 35 * (1 - c.avance / 90)
      + 10 * (1 - c.d_dest / 5)
    )::integer as score,
    (select r.statut from reservations r where r.trajet_id = c.id and r.passager_id = auth.uid())
  from candidats c
  join profils p on p.id = c.conducteur_id and p.statut = 'verifie'
  left join etablissements e on e.id = p.etablissement_id
  where c.d_dest <= 5
    and c.avance between 0 and 90
    and c.detour <= greatest(c.detour_max_km, 1)
  order by score desc, c.heure_arrivee desc;
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
    insert into reservations (trajet_id, passager_id) values (p_trajet, auth.uid()) returning * into v_res;
  elsif v_res.statut = 'annulee' then
    update reservations set statut = 'demandee' where id = v_res.id;
  elsif v_res.statut = 'refusee' then
    raise exception 'Le conducteur a refusé cette demande.';
  else
    raise exception 'Vous avez déjà une demande en cours pour ce trajet.';
  end if;

  if nullif(trim(p_message), '') is not null then
    insert into messages (reservation_id, expediteur_id, contenu)
    values (v_res.id, auth.uid(), left(trim(p_message), 2000));
  end if;
  return v_res.id;
end;
$$;

-- Le conducteur accepte ou refuse une demande.
create or replace function public.repondre_reservation(p_reservation uuid, p_accepter boolean) returns void
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

  if p_accepter then
    select count(*) into v_prises from reservations
    where trajet_id = v_trajet.id and statut = 'acceptee' and id <> v_res.id;
    if v_prises >= v_trajet.places then raise exception 'Il ne reste plus de place sur ce trajet.'; end if;
    update reservations set statut = 'acceptee' where id = v_res.id;
  else
    update reservations set statut = 'refusee' where id = v_res.id;
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
-- 7. ADMINISTRATION
-- ---------------------------------------------------------------------

create or replace function public.admin_definir_statut(p_membre uuid, p_statut text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  if p_statut not in ('en_attente','verifie','refuse','suspendu') then raise exception 'Statut inconnu.'; end if;
  if p_membre = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre statut.'; end if;
  update profils set
    statut = p_statut,
    methode_verif = case when p_statut = 'verifie' then coalesce(methode_verif, 'admin') else methode_verif end,
    verifie_le = case when p_statut = 'verifie' then coalesce(verifie_le, now()) else verifie_le end,
    justificatif_path = case when p_statut in ('verifie','refuse') then null else justificatif_path end
  where id = p_membre;
  if not found then raise exception 'Membre introuvable.'; end if;
end;
$$;

-- Donne un rôle. Pour « partenaire », l'établissement géré est obligatoire.
create or replace function public.admin_definir_role(p_membre uuid, p_role text, p_etablissement uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'Action réservée à l''administration.'; end if;
  if p_role not in ('membre','partenaire','admin') then raise exception 'Rôle inconnu.'; end if;
  if p_membre = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.'; end if;
  if p_role = 'partenaire' and p_etablissement is null then raise exception 'Choisissez l''établissement géré.'; end if;
  update profils set
    role = p_role,
    etablissement_id = case when p_role = 'partenaire' then p_etablissement else etablissement_id end,
    statut = case when p_role in ('partenaire','admin') then 'verifie' else statut end,
    methode_verif = case when p_role in ('partenaire','admin') then coalesce(methode_verif, 'admin') else methode_verif end,
    verifie_le = case when p_role in ('partenaire','admin') then coalesce(verifie_le, now()) else verifie_le end
  where id = p_membre;
  if not found then raise exception 'Membre introuvable.'; end if;
end;
$$;

-- Droit à l'effacement (RGPD) : un membre supprime son propre compte.
create or replace function public.supprimer_mon_compte() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connectez-vous.'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- 8. VUES PUBLIQUES (informations limitées, visibles des membres vérifiés)
-- ---------------------------------------------------------------------

-- Ce qu'un membre voit d'un autre : prénom, initiale du nom, catégorie,
-- établissement. Jamais l'e-mail, le téléphone ou le justificatif.
create or replace view public.membres as
  select p.id, p.prenom, upper(left(p.nom, 1)) as initiale, p.categorie,
         coalesce(e.nom, p.etablissement_declare) as etablissement
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

-- On retire tous les droits par défaut, puis on n'accorde que le nécessaire.
revoke all on public.etablissements, public.profils, public.codes_acces, public.invitations,
              public.trajets, public.reservations, public.messages, public.demandes_contact,
              public.membres, public.etablissements_publics
  from anon, authenticated;

grant select on public.membres, public.etablissements_publics to authenticated;

grant select, insert, update, delete on public.etablissements to authenticated;
grant select on public.profils to authenticated;
grant update (prenom, nom, ville, telephone, etablissement_declare) on public.profils to authenticated;
grant select on public.codes_acces to authenticated;
grant update (libelle, max_utilisations, expire_le, actif) on public.codes_acces to authenticated;
grant delete on public.codes_acces to authenticated;
grant select on public.invitations to authenticated;
grant select, insert, delete on public.trajets to authenticated;
grant update (depart_ville, depart_lat, depart_lng, destination_nom, destination_ville, dest_lat, dest_lng,
              date_debut, date_fin, jours, heure_arrivee, heure_retour, places, detour_max_km, commentaire, actif)
  on public.trajets to authenticated;
grant select on public.reservations to authenticated;
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
  using (public.est_verifie());
drop policy if exists trajets_creation on public.trajets;
create policy trajets_creation on public.trajets for insert to authenticated
  with check (public.est_verifie() and conducteur_id = auth.uid());
drop policy if exists trajets_modification on public.trajets;
create policy trajets_modification on public.trajets for update to authenticated
  using (public.est_verifie() and conducteur_id = auth.uid())
  with check (conducteur_id = auth.uid());
drop policy if exists trajets_suppression on public.trajets;
create policy trajets_suppression on public.trajets for delete to authenticated
  using (conducteur_id = auth.uid() or public.est_admin());

-- Réservations : visibles du passager et du conducteur concernés.
drop policy if exists reservations_lecture on public.reservations;
create policy reservations_lecture on public.reservations for select to authenticated
  using (public.participe_reservation(id) or public.est_admin());

-- Messages : uniquement entre le passager et le conducteur d'une réservation.
drop policy if exists messages_lecture on public.messages;
create policy messages_lecture on public.messages for select to authenticated
  using (public.participe_reservation(reservation_id));
drop policy if exists messages_envoi on public.messages;
create policy messages_envoi on public.messages for insert to authenticated
  with check (public.est_verifie() and expediteur_id = auth.uid() and public.participe_reservation(reservation_id));

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
  public.est_verifie(), public.est_admin(), public.mon_etablissement_gere(),
  public.participe_reservation(uuid),
  public.utiliser_code(text), public.creer_invitation(), public.utiliser_invitation(text),
  public.soumettre_justificatif(text),
  public.rechercher_trajets(double precision, double precision, double precision, double precision, date, time),
  public.demander_reservation(uuid, text), public.repondre_reservation(uuid, boolean),
  public.annuler_reservation(uuid),
  public.creer_code(text, integer, date, uuid), public.stats_etablissement(uuid),
  public.admin_definir_statut(uuid, text), public.admin_definir_role(uuid, text, uuid),
  public.supprimer_mon_compte()
  to authenticated;

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
