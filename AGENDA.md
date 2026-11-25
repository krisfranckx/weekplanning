# Afspraken uit WeekCal in de weekplanning

Afspraken die je in WeekCal (of de app Agenda) in een gekoppelde agenda zet, verschijnen in de
weekplanning bij de **activiteiten**, met een klein agenda-icoon. Dat werkt in één richting:
wijzigen of verwijderen doe je in WeekCal, niet in de app.

WeekCal bewaart zijn afspraken niet zelf, maar in de agenda's van je iPhone (iCloud, Google, …).
De app leest één van die agenda's via een deel-link.

## Eén keer instellen

### 1. Supabase bijwerken (door wie Supabase beheert)

Open Supabase > **SQL Editor** > **New query**, plak de volledige inhoud van
[`supabase/opzet.sql`](supabase/opzet.sql) en klik op **Run**. Het script mag je gerust opnieuw
uitvoeren; pas wel onderaan de twee voorbeeldadressen aan of verwijder die regels.

Dit zet de Supabase-extensie `http` aan en voegt twee functies toe. Supabase haalt de agenda op
in plaats van je browser, want iCloud en Google laten een website die niet rechtstreeks lezen.

### 2. Een agenda kiezen

Neem bij voorkeur een **aparte agenda** voor het gezin, bv. een iCloud-agenda *Gezin*. Zo komen
je werkafspraken niet in de gezinsplanning. Een nieuwe agenda maak je in de app **Agenda** >
**Agenda's** > **Voeg agenda toe** (kies *iCloud*). In WeekCal zet je afspraken voor het gezin
dan in die agenda.

### 3. De link kopiëren (iPhone, iCloud)

1. Open de app **Agenda** en tik onderaan op **Agenda's**.
2. Tik op **ⓘ** naast de agenda (bv. *Gezin*).
3. Zet **Openbare agenda** aan en tik op **Deel link…** > **Kopieer**.

De link begint met `webcal://`. Iedereen die de link heeft, kan de agenda lezen (niet wijzigen),
dus deel hem niet verder. Zet je *Openbare agenda* later uit, dan werkt de link niet meer.

**Google Agenda?** Ga op een computer naar Google Agenda > **Instellingen** > kies de agenda >
**Geheim adres in iCal-indeling** en kopieer dat adres.

### 4. De link in de app plakken

Open de weekplanning, ga naar **Gezin** > **Agenda's (WeekCal)**, plak de link en tik op
**Koppelen**. Je moet daarvoor ingelogd zijn bij *Samen delen*. De link geldt voor het hele
gezin: je partner hoeft niets in te stellen.

Nog een agenda erbij (bv. die van Eva)? Tik op **Agenda toevoegen** en plak de tweede link.
Je kan tot vijf agenda's koppelen; ze werken allemaal op dezelfde manier.

## Goed om te weten

- De app haalt de agenda op als je ze opent, en daarna hoogstens om het kwartier. iCloud werkt
  een openbare agenda zelf ook maar om de paar minuten bij, dus een nieuwe afspraak kan even
  op zich laten wachten. Met **Nu vernieuwen** haal je ze meteen op.
- **Voor wie?** Tik in de app op een afspraak en kies de personen. Bij een herhalende afspraak
  kies je *Elke keer* of *Alleen* die ene dag. Die keuze wordt gedeeld, dus Eva ziet ze ook.
  Kies je niets, dan herkent de app een gezinslid waarvan de naam als los woord in de titel staat
  (bv. *Voetbal Pablo*).
- Afspraken van de voorbije twee weken tot een half jaar vooruit worden getoond. Herhalende
  afspraken (wekelijks, om de twee weken, maandelijks, …) en hele-dag-afspraken werken ook.
- De afspraken staan op elk toestel apart in het geheugen, zodat je ze ook offline ziet.
- Ontkoppelen kan per agenda bij **Gezin** > **Agenda's (WeekCal)** > **Ontkoppelen**.
