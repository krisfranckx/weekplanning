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
