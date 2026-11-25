# Meldingen instellen

De app kan elke ochtend een melding sturen met **wie brengt, wie ophaalt en wie kookt**, en
**de avond vóór de deadline van een todo** een herinnering. Elke persoon zet dat op de eigen
gsm aan, met eigen tijden.

Daarvoor moet Supabase de meldingen versturen (je gsm kan dat niet zelf als de app dicht is).
Dat stel je **één keer** in, in drie stappen. Reken op een kwartiertje.

## 1. Database bijwerken

1. Open je project op [supabase.com](https://supabase.com/dashboard) > **SQL Editor** > **New query**.
2. Plak de volledige inhoud van [`supabase/opzet.sql`](supabase/opzet.sql) en klik **Run**.
   (Je e-mailadressen onderaan deel 6 staan er al in, dus dat deel mag je laten zoals het is
   of aanpassen zoals de vorige keer.)

Dit maakt de tabellen voor meldingen aan en zet een taak klaar die om de 5 minuten kijkt of
er iets te sturen is.

Krijg je een fout over `pg_cron` of `pg_net`? Zet die dan aan bij **Database > Extensions**
(zoek op `pg_cron` en `pg_net`) en voer het script opnieuw uit.

## 2. De functie "meldingen" toevoegen

1. Ga naar **Edge Functions** > **Deploy a new function** > **Via Editor**.
2. Geef als naam exact: `meldingen`
3. Wis de voorbeeldcode en plak de inhoud van
   [`supabase/functions/meldingen/index.ts`](https://raw.githubusercontent.com/krisfranckx/weekplanning/main/supabase/functions/meldingen/index.ts).
4. Klik **Deploy function**.
5. Open de functie, ga naar **Details** (of **Settings**) en zet **Verify JWT** /
   **Enforce JWT verification** **uit**. Klik **Save**.
   De functie controleert zelf wie haar aanroept: de 5-minuten-taak met een geheime code die
   alleen in je database staat, en de app met je login.

Je hoeft geen sleutels te maken of in te vullen: de app maakt de eerste keer zelf de sleutels
voor de meldingen aan en bewaart ze in Supabase.

## 3. Meldingen aanzetten op je gsm

Op iPhone werkt dit alleen in de app op je **beginscherm** (iOS 16.4 of nieuwer).

1. Open de Weekplanning-app vanaf je beginscherm, tab **Gezin** > **Meldingen**.
2. Kies bij **Ik ben** je naam. Dan krijg je herinneringen voor jouw todo's en voor todo's
   zonder persoon (de todo's van je partner niet).
3. Kies welke meldingen je wil en hoe laat. Standaard: ochtendmelding om 7:00, todo's om 19:00.
4. Tik **Meldingen aanzetten** en kies **Sta toe**.
5. Tik **Testmelding sturen**. Binnen enkele seconden krijg je de planning van vandaag.

Je partner doet stap 3 op de eigen gsm. Een tijd wijzigen kan altijd; dat wordt meteen bewaard.

## Goed om te weten

- De meldingen komen hoogstens 5 minuten na het gekozen uur. Elke melding komt maximaal één
  keer per dag. Lag Supabase meer dan 3 uur plat, dan wordt een gemiste melding overgeslagen.
- De ochtendmelding komt standaard alleen op schooldagen (dus niet in het weekend of in de
  schoolvakantie). Wil je ze elke dag, vink dan **ook op dagen zonder school** aan.
- Geen todo's met deadline morgen? Dan krijg je ook geen herinnering.
- De functie leest de rekenregels van de app (`js/logica.js`) van de website op het moment dat
  je ze in Supabase zet. Verandert er later iets aan die regels (bv. nieuwe schoolvakanties),
  plak de functie dan opnieuw en klik **Deploy**.
- Gratis Supabase-projecten worden gepauzeerd na een week zonder gebruik. Zolang jullie de app
  gebruiken, gebeurt dat niet.

## Werkt het niet?

- **"De functie meldingen staat nog niet in Supabase"**: stap 2 ontbreekt, of de naam is niet
  exact `meldingen`.
- **"Supabase weigert: zet de JWT-controle uit"**: stap 2, punt 5.
- **"Voer eerst het bijgewerkte supabase/opzet.sql opnieuw uit"**: stap 1.
- **Testmelding werkt, maar 's ochtends komt er niets**: kijk in Supabase bij
  **Integrations > Cron** (of **Database > Cron Jobs**) of de taak `weekplanning-meldingen`
  draait, en bij **Edge Functions > meldingen > Logs** of er fouten staan.
