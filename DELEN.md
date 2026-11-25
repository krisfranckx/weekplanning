# Live delen met je partner (Supabase)

Met deze stappen zien jullie allebei dezelfde planning, en verschijnt een wijziging van de ene
meteen op de gsm van de andere. Je doet dit één keer, het duurt ongeveer 10 minuten en het is gratis.

> **Deel nooit je wachtwoorden of de geheime `service_role`-sleutel**, ook niet met Claude.
> De app heeft alleen de *publieke* sleutel nodig, en die vul je zelf in de app in.

## 1. Gratis Supabase-project maken

1. Ga naar <https://supabase.com> en klik op **Start your project**. Log in met je GitHub-account
   (of maak een account met e-mail).
2. Klik op **New project**.
   - *Name*: `weekplanning`
   - *Database password*: klik op **Generate a password**. Je hebt het verder niet nodig voor de app.
   - *Region*: kies **Central EU (Frankfurt)** of een andere regio in Europa.
   - Plan: **Free**.
3. Klik op **Create new project** en wacht een minuutje.

## 2. De tabellen aanmaken

1. Open in het menu links **SQL Editor** en klik op **New query**.
2. Open het bestand [`supabase/opzet.sql`](supabase/opzet.sql), kopieer alles en plak het in de editor.
3. Pas **onderaan** de twee e-mailadressen aan: dat van jou en dat van je partner. Alleen deze
   adressen krijgen toegang. Meer mensen? Voeg gewoon een regel toe.
4. Klik op **Run**. Je ziet *Success. No rows returned*.

Later iemand toevoegen kan met een nieuwe query:

```sql
insert into public.toegelaten (email) values ('nieuw.adres@voorbeeld.be');
```

## 3. Inloggen instellen

1. Open **Authentication** > **URL Configuration**.
2. Vul bij **Site URL** het adres van de app in: `https://krisfranckx.github.io/weekplanning/`
   en klik op **Save**. Zo werkt de bevestigingsmail die Supabase stuurt.
3. (Optioneel) Wil je geen bevestigingsmail? Zet dan bij **Authentication** > **Sign In / Providers**
   > **Email** de optie **Confirm email** uit. Dat mag hier, want alleen de adressen uit stap 2
   kunnen de planning zien.

## 4. De twee gegevens opzoeken

1. Klik bovenaan op **Connect** (of ga naar **Project Settings** > **API Keys** / **Data API**).
2. Noteer:
   - de **Project URL**, zoiets als `https://abcdefgh.supabase.co`
   - de **publieke sleutel**: de *Publishable key* (begint met `sb_publishable_`) of, bij oudere
     projecten, de *anon public* key.

Gebruik **niet** de *secret* of *service_role* sleutel.

## 5. Op je eigen gsm koppelen

1. Open de app, ga naar **Gezin** > **Samen delen**.
2. Vul de *Project-URL* en de *publieke sleutel* in en tik op **Verder**.
3. Tik op **Account aanmaken** met je e-mailadres (hetzelfde als in stap 2) en een wachtwoord.
   Kreeg je een bevestigingsmail? Klik op de link en log daarna in de app in.
4. Bovenaan staat nu **● Gedeeld**. Je planning staat in Supabase.

## 6. Je partner koppelen

1. Tik in **Gezin** > **Samen delen** op **Link voor partner kopiëren** en stuur die link door.
2. Je partner opent de link op hun gsm. De Supabase-gegevens zijn dan al ingevuld.
3. Je partner tikt op **Account aanmaken** met hun eigen e-mailadres (dat ook in stap 2 staat).
4. Klaar: de gsm van je partner neemt de gedeelde planning over.

Tip: tik in de browser op **Delen** > **Zet op beginscherm**, dan opent de app als een gewone app.

## Goed om te weten

- **Offline**: je kan altijd verder plannen. Wijzigingen gaan mee zodra er weer internet is
  (bovenaan staat dan *Offline*).
- **Tegelijk wijzigen**: hebben jullie allebei offline iets veranderd, dan wint de laatste die weer
  online komt. In de praktijk gebeurt dat zelden.
- **Gratis niveau**: Supabase pauzeert een gratis project na een week zonder gebruik. Gebruik je de
  app dagelijks, dan merk je daar niets van. Gepauzeerd? Log in op supabase.com en klik op **Restore**.
- **Problemen?** Zie de volgende sectie.

## "Geen toegang" of "Geen rechten op de tabel"

1. **Script opnieuw uitvoeren.** Open **SQL Editor**, plak de nieuwste versie van
   [`supabase/opzet.sql`](supabase/opzet.sql) (met jullie e-mailadressen onderaan) en klik op **Run**.
   Nieuwere Supabase-projecten geven ingelogde gebruikers niet meer automatisch rechten op een
   nieuwe tabel; het script regelt dat nu.
2. **Zelfde adres?** De app toont bij *Gezin > Samen delen* met welk adres je ingelogd bent. Vergelijk
   dat met **Authentication** > **Users** en met **Table Editor** > `toegelaten`. Een tikfout of een
   ander adres (bv. werk/privé) is de meest voorkomende oorzaak.
3. **Bevestigd?** Staat er bij **Authentication** > **Users** *Waiting for verification*, klik dan op
   de link in de bevestigingsmail (of zet *Confirm email* uit, zie stap 3 hierboven).
4. Sluit de app en open hem opnieuw.
