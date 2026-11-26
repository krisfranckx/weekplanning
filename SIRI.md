# Todo's toevoegen met Siri

Zeg **"Hé Siri, ik heb een nieuwe todo"**. Siri vraagt dan:

1. **Wat moet er gebeuren?** Bijvoorbeeld "Turnzak wassen".
2. **Voor wie?** Kies een naam (of "Niemand").
3. **Tegen wanneer?** Bijvoorbeeld "vrijdag" of "12 december".

De todo staat meteen in de gedeelde planning, op elk toestel. Omdat Siri ook via CarPlay werkt, kan dit handsfree in de auto. De app zelf verschijnt niet in CarPlay: Apple laat daar alleen App Store-apps uit bepaalde categorieën toe.

## Eén keer instellen (per persoon, op de eigen iPhone)

### 1. Supabase bijwerken (één keer, door wie Supabase beheert)

Open Supabase > **SQL Editor** > **New query**, plak de volledige inhoud van [`supabase/opzet.sql`](supabase/opzet.sql) en klik op **Run**. Het script mag je gerust opnieuw uitvoeren; je e-mailadressen blijven staan. Pas wel onderaan de twee voorbeeldadressen aan of verwijder die regels.

Dit voegt twee dingen toe:

- een tabel `siri_sleutels` met per persoon een geheime sleutel;
- een functie `todo_via_siri` die **alleen todo's kan toevoegen**, en alleen met een geldige sleutel van iemand die nog in de tabel `toegelaten` staat.

### 2. Je Siri-sleutel ophalen

Open de app, ga naar **Gezin** > **Todo's via Siri** en tik op **Siri-opdracht instellen**. Je ziet drie waarden met een knop **Kopieer**:

- **Adres**: `https://<jouw-project>.supabase.co/rest/v1/rpc/todo_via_siri`
- **apikey**: de publieke Supabase-sleutel die de app al gebruikt
- **Siri-sleutel**: je persoonlijke, geheime sleutel

Deel de Siri-sleutel met niemand. Maak je later een nieuwe, dan werkt de oude niet meer. Haal je iemand uit `toegelaten`, dan werkt diens Siri-sleutel ook niet meer.

### 3. De opdracht maken in de app Opdrachten

Open **Opdrachten** (Shortcuts) en tik op **+**. Voeg deze acties toe, in deze volgorde. De Engelse naam staat erbij voor als je iPhone in het Engels staat.

1. **Vraag om invoer** (Ask for Input)
   - Type: *Tekst*
   - Vraag: *Wat moet er gebeuren?*
2. **Lijst** (List)
   - Items: de namen uit de app (bv. *Kris*, *Eva*, *Pablo*, *Polly*, *Louis*) en *Niemand*
3. **Kies uit lijst** (Choose from List)
   - Vraag: *Voor wie?*
4. **Vraag om invoer** (Ask for Input)
   - Type: *Datum*
   - Vraag: *Tegen wanneer?*
5. **Wijzig datumnotatie** (Format Date), mag je ook weglaten
   - Datum: *Gevraagde invoer* (van stap 4)
   - Notatie: *ISO 8601*, zonder tijd
   - Laat je deze stap weg, gebruik dan in stap 6 bij `deadline` rechtstreeks de *Gevraagde invoer* van stap 4. De app begrijpt ook "26 nov. 2026 om 14:00".
6. **Haal inhoud op van URL** (Get Contents of URL)
   - URL: het **Adres**
   - Methode: *POST*
   - Headers: `apikey` = de **apikey**
   - Verzoek (Request Body): *JSON*, met vier velden van het type *Tekst*:
     - `sleutel` = de **Siri-sleutel**
     - `titel` = *Gevraagde invoer* (van stap 1)
     - `wie` = *Gekozen onderdeel* (van stap 3)
     - `deadline` = *Opgemaakte datum* (van stap 5)
7. **Toon resultaat** (Show Result)
   - Inhoud: *Inhoud van URL*

Noem de opdracht exact **Ik heb een nieuwe todo**. Die naam is de zin die je tegen Siri zegt.

### 4. Proberen

Zeg "Hé Siri, ik heb een nieuwe todo". Siri antwoordt bijvoorbeeld *"Oké, todo toegevoegd: Turnzak wassen voor Polly, tegen 05/12."* De todo verschijnt meteen in de app onder **Todo's**, en op de dag van de deadline ook in **Vandaag** en **Week**.

## Problemen

- **De todo heet een datum** (bv. "26 nov. 2026"): in stap 6 staat bij `titel` de invoer van stap 4 (de datum) in plaats van die van stap 1. Tik op het veld, verwijder de variabele en kies opnieuw *Gevraagde invoer* van **Wat moet er gebeuren?**. Opdrachten noemt beide invoeren hetzelfde, dus kijk goed welke je kiest.
- **Geen deadline**: bij `deadline` staat niets, of iets wat geen datum is.
- **Deel je opdracht niet via een iCloud-link.** Je Siri-sleutel zit erin. Deed je dat toch, maak dan in de app een nieuwe sleutel en plak die in stap 6.

- **"De Siri-sleutel klopt niet"**: maak in de app een nieuwe sleutel en plak die in stap 6.
- **Een foutmelding over een functie of "schema cache"**: stap 1 is nog niet gebeurd.
- **De naam wordt niet herkend**: de naam in de lijst (stap 2) moet hetzelfde zijn als in de app onder Gezin, of er het begin van zijn ("Poll" werkt voor Polly). Hoofdletters maken niet uit.
