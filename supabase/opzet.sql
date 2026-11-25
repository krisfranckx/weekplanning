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
