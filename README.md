# Weekplanning

Een eenvoudige gezinsplanner voor op de gsm. Het hoofdscherm toont **vandaag**:
wie brengt de kinderen naar school, wie haalt ze op, welke activiteiten er zijn en wat we eten.

## Zo werkt het

- **Vandaag**: tik op een kaart (brengen, ophalen, avondeten) om ze aan te passen. Kies daarna
  *Alleen vandaag* of *Elke woensdag* (of welke dag het ook is). Met ‹ › of door te vegen ga je naar
  een andere dag.
- **Week**: *Deze week* toont de zeven dagen in één oogopslag. Een oranje stip betekent dat die dag
  afwijkt van de standaardweek. *Standaardweek aanpassen* is de snelste manier om de vaste planning
  in te vullen: per weekdag kies je wie brengt en haalt, wat er gegeten wordt en vaste activiteiten
  (zwemles, muziekschool…).
- **Todo's**: taken met een deadline en een persoon, die je kan afvinken. Ze staan gegroepeerd
  (te laat, vandaag, deze week, later) en je kan filteren per persoon. Op de dag van de deadline
  verschijnen ze ook in *Vandaag* en *Week*, onder de activiteiten. Open todo's die te laat zijn,
  blijven op *Vandaag* staan tot ze afgevinkt zijn.
- **Gezin**: namen, kleuren en extra personen (grootouders, oppas, opvang). Hier kan je ook
  exporteren en importeren.

### Namen instellen met een link

Open de app met namen in het adres, dan worden ze meteen ingevuld (en niet in de code bewaard):

```
https://krisfranckx.github.io/weekplanning/#gezin=ouders:Ann,Bert;kinderen:Cas,Dirk
```

Bestaande ouders en kinderen krijgen de nieuwe namen en houden hun plaats in de planning.

## Starten

Er is geen build-stap nodig: het is gewone HTML, CSS en JavaScript.

```bash
python3 -m http.server 8080   # of: npm start
```

Open daarna <http://localhost:8080>. Op de gsm kan je de pagina via *Zet op beginscherm* als app
installeren; ze werkt dan ook offline.

`index.html` rechtstreeks openen (dubbelklikken) werkt ook, maar dan zonder offline-modus.

## Testen

```bash
npm test
```

De tests (Node, ingebouwde testrunner) controleren de planningslogica in `js/logica.js`.

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | De pagina |
| `css/stijl.css` | Opmaak (licht en donker thema) |
| `js/logica.js` | Datums, standaardweek en aanpassingen per dag (zonder schermcode, testbaar) |
| `js/app.js` | Schermen en bediening |
| `js/sync.js` | Live delen via Supabase (inloggen, versturen, live updates, offline wachtrij) |
| `supabase/opzet.sql` | Tabellen en beveiliging voor Supabase |
| `sw.js`, `manifest.webmanifest`, `icoon.svg` | Installeren op het beginscherm en offline werken |

## Live delen met je partner

Optioneel, via een gratis Supabase-project. Volg het stappenplan in [DELEN.md](DELEN.md).
Zonder Supabase werkt de app gewoon lokaal op één toestel.

## Todo's toevoegen met Siri

"Hé Siri, ik heb een nieuwe todo": zie [SIRI.md](SIRI.md). Werkt ook via CarPlay.

## Online zetten

De app kan op GitHub Pages: *Settings* > *Pages* > *Deploy from a branch*, map `/ (root)`.
Het adres wordt dan `https://krisfranckx.github.io/weekplanning/`.

## Hoe de planning bewaard wordt

Alles staat in de browser van het toestel (`localStorage`), en met Supabase ook als één
JSON-document in de tabel `planning`:

- een **standaardweek** (maandag tot zondag),
- **aanpassingen per datum** die de standaardweek voor die ene dag overschrijven,
- eenmalige activiteiten en overgeslagen vaste activiteiten per datum,
- de **todo's** (titel, deadline, persoon, afgevinkt of niet).

Aanpassingen ouder dan 60 dagen worden automatisch opgeruimd.
