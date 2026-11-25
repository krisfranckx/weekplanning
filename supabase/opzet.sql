-- Weekplanning: tabellen en beveiliging voor live delen.
-- Plak dit in Supabase > SQL Editor > New query, pas de twee e-mailadressen onderaan aan en klik op Run.
-- Je mag dit script gerust opnieuw uitvoeren.

-- 1. Wie mag de planning zien en wijzigen
create table if not exists public.toegelaten (
  email text primary key
);
alter table public.toegelaten enable row level security;
-- Geen policies: deze lijst is alleen via de SQL Editor aan te passen, niet vanuit de app.

-- 2. De planning zelf (één rij voor het hele gezin)
create table if not exists public.planning (
  id integer primary key default 1 check (id = 1),
  data jsonb not null,
  bijgewerkt timestamptz not null default now(),
  apparaat text,
  bijgewerkt_door text
);
alter table public.planning enable row level security;

-- 3. Hulpfunctie: staat de ingelogde gebruiker in de lijst?
create or replace function public.is_toegelaten()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.toegelaten
    where lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

-- 4. Alleen toegelaten gebruikers mogen lezen en schrijven
drop policy if exists "gezin leest" on public.planning;
drop policy if exists "gezin maakt aan" on public.planning;
drop policy if exists "gezin wijzigt" on public.planning;

create policy "gezin leest" on public.planning
  for select to authenticated using (public.is_toegelaten());
create policy "gezin maakt aan" on public.planning
  for insert to authenticated with check (public.is_toegelaten());
create policy "gezin wijzigt" on public.planning
  for update to authenticated using (public.is_toegelaten()) with check (public.is_toegelaten());

-- 4b. Rechten voor ingelogde gebruikers.
-- Nieuwere Supabase-projecten geven die niet meer automatisch; zonder dit krijg je "Geen toegang".
-- De policies hierboven bepalen daarna wie welke rij mag zien.
grant usage on schema public to authenticated;
grant select, insert, update on public.planning to authenticated;
revoke all on public.planning from anon;
revoke all on public.toegelaten from anon, authenticated;
grant execute on function public.is_toegelaten() to authenticated;

-- 5. Live updates aanzetten voor de planning
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'planning'
  ) then
    alter publication supabase_realtime add table public.planning;
  end if;
end $$;

-- 6. PAS DIT AAN: de e-mailadressen van wie mag meedoen (kleine letters)
insert into public.toegelaten (email) values
  ('jouw.adres@voorbeeld.be'),
  ('adres.partner@voorbeeld.be')
on conflict do nothing;

-- Spaties en hoofdletters in de lijst gelijkzetten
update public.toegelaten set email = lower(trim(email)) where email <> lower(trim(email));

-- 7. Todo's toevoegen via Siri ("Hé Siri, ik heb een nieuwe todo")
-- Elke toegelaten gebruiker kan in de app (Gezin > Siri) een eigen geheime Siri-sleutel aanmaken.
-- De Siri-opdracht stuurt die sleutel mee. Een sleutel werkt alleen zolang het e-mailadres
-- nog in "toegelaten" staat, en kan enkel todo's toevoegen (niets lezen of wijzigen).
create extension if not exists pgcrypto;

create table if not exists public.siri_sleutels (
  email text primary key,
  sleutel text not null unique,
  gemaakt timestamptz not null default now()
);
alter table public.siri_sleutels enable row level security;
revoke all on public.siri_sleutels from anon, authenticated;

-- Nieuwe sleutel voor de ingelogde gebruiker (een oude sleutel werkt daarna niet meer).
create or replace function public.maak_siri_sleutel()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  mijn_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  nieuwe text := encode(gen_random_bytes(18), 'hex');
begin
  if not public.is_toegelaten() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  insert into public.siri_sleutels (email, sleutel) values (mijn_email, nieuwe)
  on conflict (email) do update set sleutel = excluded.sleutel, gemaakt = now();
  return nieuwe;
end;
$$;

-- Todo toevoegen met een Siri-sleutel. wie = naam zoals in de app (of leeg), deadline = JJJJ-MM-DD (of leeg).
create or replace function public.todo_via_siri(sleutel text, titel text, wie text default null, deadline text default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  van text;
  schoon text := regexp_replace(trim(coalesce(titel, '')), '\s+', ' ', 'g');
  datum text := nullif(trim(coalesce(deadline, '')), '');
  lid_id text;
  lid_naam text;
  todo jsonb;
begin
  select s.email into van from public.siri_sleutels s
  where s.sleutel = todo_via_siri.sleutel
    and exists (select 1 from public.toegelaten t where lower(trim(t.email)) = s.email);
  if van is null then
    return 'Dat lukte niet: de Siri-sleutel klopt niet. Maak in de app een nieuwe aan.';
  end if;
  if schoon = '' then
    return 'Ik heb geen todo gehoord.';
  end if;
  if datum is not null then
    datum := left(datum, 10);
    if datum !~ '^\d{4}-\d{2}-\d{2}$' then datum := null; end if;
  end if;

  select l ->> 'id', l ->> 'naam' into lid_id, lid_naam
  from public.planning p, jsonb_array_elements(p.data -> 'leden') l
  where p.id = 1 and lower(trim(l ->> 'naam')) = lower(trim(coalesce(wie, '')))
  limit 1;

  todo := jsonb_build_object(
    'id', 'siri-' || encode(gen_random_bytes(6), 'hex'),
    'titel', upper(left(schoon, 1)) || substr(schoon, 2),
    'deadline', datum,
    'wie', lid_id,
    'klaar', false
  );

  update public.planning
  set data = jsonb_set(data, '{todos}', coalesce(data -> 'todos', '[]'::jsonb) || jsonb_build_array(todo)),
      bijgewerkt = now(),
      apparaat = 'siri',
      bijgewerkt_door = van
  where id = 1;
  if not found then
    return 'Dat lukte niet: er is nog geen gedeelde planning.';
  end if;

  return 'Oké, todo toegevoegd: ' || (todo ->> 'titel') ||
    case when lid_id is not null then ' voor ' || lid_naam else '' end || '.';
end;
$$;

revoke all on function public.maak_siri_sleutel() from public, anon;
grant execute on function public.maak_siri_sleutel() to authenticated;
revoke all on function public.todo_via_siri(text, text, text, text) from public;
grant execute on function public.todo_via_siri(text, text, text, text) to anon, authenticated;

-- 8. Agenda's uit WeekCal / iCloud / Google inlezen (alleen lezen)
-- Eén of meer agenda-links (ICS/webcal) voor het hele gezin. Supabase haalt de agenda's op,
-- omdat een browser iCloud of Google meestal niet rechtstreeks mag lezen. De links zelf zijn
-- alleen via de functies hieronder te zien of te wijzigen, en alleen door toegelaten gebruikers.
create extension if not exists http with schema extensions;

create table if not exists public.agenda_links (
  id integer generated always as identity primary key,
  url text not null unique,
  gemaakt timestamptz not null default now(),
  gemaakt_door text
);
alter table public.agenda_links enable row level security;
revoke all on public.agenda_links from anon, authenticated;

-- Overzetten uit versie 14 (toen kon er maar één agenda gekoppeld worden).
do $$
begin
  if to_regclass('public.agenda_link') is not null then
    insert into public.agenda_links (url, gemaakt, gemaakt_door)
    select url, gewijzigd, gewijzigd_door from public.agenda_link
    on conflict (url) do nothing;
    drop table public.agenda_link;
  end if;
end $$;
drop function if exists public.zet_agenda_link(text);

-- Agenda toevoegen. webcal:// wordt https://. Geeft de naam van de server terug.
create or replace function public.voeg_agenda_toe(url text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  schoon text := regexp_replace(trim(coalesce(url, '')), '^webcals?://', 'https://', 'i');
begin
  if not public.is_toegelaten() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if schoon !~* '^https://[^/\s]+\.[^/\s]+/\S*$' then
    raise exception 'Dat lijkt geen agenda-link: hij moet beginnen met webcal:// of https://' using errcode = '22023';
  end if;
  if (select count(*) from public.agenda_links) >= 5 then
    raise exception 'Er zijn al 5 agenda''s gekoppeld. Ontkoppel er eerst een.' using errcode = '22023';
  end if;
  insert into public.agenda_links (url, gemaakt_door)
  values (schoon, lower(trim(coalesce(auth.jwt() ->> 'email', ''))))
  on conflict on constraint agenda_links_url_key do nothing;
  return substring(schoon from '^https://([^/]+)');
end;
$$;

-- Agenda ontkoppelen (nr zoals agenda_ophalen het teruggeeft).
create or replace function public.verwijder_agenda(nr integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_toegelaten() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  delete from public.agenda_links where id = nr;
end;
$$;

-- Alle agenda's ophalen. Geeft { ingesteld, agendas: [{ nr, bron, ics } of { nr, bron, fout }] }.
create or replace function public.agenda_ophalen()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  rij record;
  antwoord extensions.http_response;
  bron text;
  lijst jsonb := '[]'::jsonb;
begin
  if not public.is_toegelaten() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  for rij in select a.id, a.url from public.agenda_links a order by a.id loop
    bron := substring(rij.url from '^https://([^/]+)');
    begin
      antwoord := extensions.http_get(rij.url);
      if antwoord.status <> 200 then
        lijst := lijst || jsonb_build_object('nr', rij.id, 'bron', bron,
          'fout', 'De agenda gaf foutcode ' || antwoord.status || '. Klopt de link nog, en staat de agenda nog gedeeld?');
      elsif position('BEGIN:VCALENDAR' in coalesce(antwoord.content, '')) = 0 then
        lijst := lijst || jsonb_build_object('nr', rij.id, 'bron', bron, 'fout', 'Op die link staat geen agenda (ICS).');
      else
        lijst := lijst || jsonb_build_object('nr', rij.id, 'bron', bron, 'ics', antwoord.content);
      end if;
    exception when others then
      lijst := lijst || jsonb_build_object('nr', rij.id, 'bron', bron, 'fout', 'De agenda was niet bereikbaar: ' || sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ingesteld', jsonb_array_length(lijst) > 0, 'agendas', lijst);
end;
$$;

revoke all on function public.voeg_agenda_toe(text) from public, anon;
grant execute on function public.voeg_agenda_toe(text) to authenticated;
revoke all on function public.verwijder_agenda(integer) from public, anon;
grant execute on function public.verwijder_agenda(integer) to authenticated;
revoke all on function public.agenda_ophalen() from public, anon;
grant execute on function public.agenda_ophalen() to authenticated;

-- 9. Pushmeldingen: ochtendmelding en todo-herinnering
-- Elk toestel schrijft zich apart in (Gezin > Meldingen in de app), met eigen tijden.
-- De Edge Function "meldingen" stuurt de meldingen (zie MELDINGEN.md); Supabase roept ze
-- om de 5 minuten aan. De sleutels en inschrijvingen zijn alleen via de functies hieronder
-- of door de Edge Function zelf te lezen.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Sleutels voor Web Push (VAPID). De app maakt ze de eerste keer aan.
create table if not exists public.push_sleutels (
  id integer primary key default 1 check (id = 1),
  publiek text not null,
  prive jsonb not null,
  geheim text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  project_url text,
  apikey text
);
alter table public.push_sleutels enable row level security;

create table if not exists public.push_abonnementen (
  endpoint text primary key,
  email text not null,
  p256dh text not null,
  auth text not null,
  lid_id text,
  ochtend boolean not null default true,
  ochtend_tijd text not null default '07:00',
  zonder_school boolean not null default false,
  todos boolean not null default true,
  todo_tijd text not null default '19:00',
  laatst_ochtend text,
  laatst_todo text,
  bijgewerkt timestamptz not null default now()
);
alter table public.push_abonnementen enable row level security;

revoke all on public.push_sleutels, public.push_abonnementen from anon, authenticated;
grant all on public.push_sleutels, public.push_abonnementen to service_role;
grant select on public.planning to service_role;

-- Publieke sleutel voor de app. Bestaat er nog geen, dan bewaart dit de meegegeven sleutels.
-- De app geeft ook de project-URL en publieke apikey mee, zodat de 5-minuten-taak de Edge Function kan vinden.
create or replace function public.push_sleutel(nieuw_publiek text default null, nieuw_prive jsonb default null,
  project_url text default null, apikey text default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  uit text;
begin
  if not public.is_toegelaten() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if nieuw_publiek is not null and nieuw_prive is not null then
    insert into public.push_sleutels (id, publiek, prive) values (1, nieuw_publiek, nieuw_prive)
    on conflict (id) do nothing;
  end if;
  if project_url ~* '^https://' then
    update public.push_sleutels set project_url = rtrim(push_sleutel.project_url, '/'),
      apikey = coalesce(push_sleutel.apikey, push_sleutels.apikey) where id = 1;
  end if;
  select publiek into uit from public.push_sleutels where id = 1;
  return uit;
end;
$$;

-- Dit toestel inschrijven of de instellingen ervan bewaren.
create or replace function public.bewaar_push(abonnement jsonb, instellingen jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  mijn_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  tijd_ochtend text := coalesce(nullif(instellingen ->> 'ochtendTijd', ''), '07:00');
  tijd_todo text := coalesce(nullif(instellingen ->> 'todoTijd', ''), '19:00');
begin
  if not public.is_toegelaten() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if coalesce(abonnement ->> 'endpoint', '') !~* '^https://' then
    raise exception 'Ongeldige inschrijving' using errcode = '22023';
  end if;
  if tijd_ochtend !~ '^\d{2}:\d{2}$' then tijd_ochtend := '07:00'; end if;
  if tijd_todo !~ '^\d{2}:\d{2}$' then tijd_todo := '19:00'; end if;
  insert into public.push_abonnementen as a (endpoint, email, p256dh, auth, lid_id, ochtend, ochtend_tijd,
    zonder_school, todos, todo_tijd)
  values (
    abonnement ->> 'endpoint', mijn_email,
    abonnement -> 'keys' ->> 'p256dh', abonnement -> 'keys' ->> 'auth',
    nullif(instellingen ->> 'lid', ''),
    coalesce((instellingen ->> 'ochtend')::boolean, true), tijd_ochtend,
    coalesce((instellingen ->> 'zonderSchool')::boolean, false),
    coalesce((instellingen ->> 'todos')::boolean, true), tijd_todo)
  on conflict (endpoint) do update set
    email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth, lid_id = excluded.lid_id,
    ochtend = excluded.ochtend, zonder_school = excluded.zonder_school, todos = excluded.todos,
    -- Later tijdstip gekozen dan vandaag al gestuurd? Dan mag het vandaag nog eens.
    laatst_ochtend = case when excluded.ochtend_tijd <> a.ochtend_tijd then null else a.laatst_ochtend end,
    laatst_todo = case when excluded.todo_tijd <> a.todo_tijd then null else a.laatst_todo end,
    ochtend_tijd = excluded.ochtend_tijd, todo_tijd = excluded.todo_tijd,
    bijgewerkt = now();
end;
$$;

-- Dit toestel uitschrijven.
create or replace function public.wis_push(endpoint text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_toegelaten() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  delete from public.push_abonnementen a where a.endpoint = wis_push.endpoint;
end;
$$;

-- Om de 5 minuten: de Edge Function "meldingen" laten kijken of er iets te sturen is.
create or replace function public.push_tik()
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  s record;
begin
  select * into s from public.push_sleutels where id = 1;
  if s.project_url is null or not exists (select 1 from public.push_abonnementen) then
    return;
  end if;
  perform net.http_post(
    url := s.project_url || '/functions/v1/meldingen',
    body := jsonb_build_object('soort', 'tik', 'geheim', s.geheim),
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', coalesce(s.apikey, ''),
      'Authorization', 'Bearer ' || coalesce(s.apikey, ''))
  );
end;
$$;

revoke all on function public.push_sleutel(text, jsonb, text, text) from public, anon;
grant execute on function public.push_sleutel(text, jsonb, text, text) to authenticated;
revoke all on function public.bewaar_push(jsonb, jsonb) from public, anon;
grant execute on function public.bewaar_push(jsonb, jsonb) to authenticated;
revoke all on function public.wis_push(text) from public, anon;
grant execute on function public.wis_push(text) to authenticated;
revoke all on function public.push_tik() from public, anon, authenticated;

select cron.schedule('weekplanning-meldingen', '*/5 * * * *', 'select public.push_tik()');
