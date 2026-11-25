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
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
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
