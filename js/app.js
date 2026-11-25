/* Weekplanning: schermen en bediening. De rekenlogica zit in logica.js. */
(function () {
  'use strict';

  const L = window.Logica;
  const OPSLAG_SLEUTEL = 'weekplanning.v1';
  const APP_VERSIE = '5 (25 nov 2026)';

  // ---------- Toestand ----------

  const staat = {
    data: laad(),
    scherm: 'dag',
    datum: vandaag(),
    weekStart: L.maandagVan(vandaag()),
    weekModus: 'deze' // 'deze' of 'standaard'
  };

  function vandaag() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function laad() {
    try {
      const ruw = localStorage.getItem(OPSLAG_SLEUTEL);
      if (ruw) return L.normaliseer(JSON.parse(ruw));
    } catch (fout) {
      console.warn('Kon planning niet laden', fout);
    }
    return L.standaardData();
  }

  function bewaar(boodschap, zonderDelen) {
    try {
      L.ruimOudeAanpassingenOp(staat.data, vandaag(), 60);
      localStorage.setItem(OPSLAG_SLEUTEL, JSON.stringify(staat.data));
      if (boodschap) meld(boodschap);
    } catch (fout) {
      meld('Opslaan lukte niet op dit toestel');
      console.warn(fout);
    }
    if (!zonderDelen && window.Sync) window.Sync.gewijzigd();
  }

  /** Nieuwe planning van Supabase (partner of eerste koppeling). */
  let wachtOpTekenen = false;
  function nieuweGedeeldeData(data, bron) {
    staat.data = L.normaliseer(data);
    bewaar(bron === 'partner' ? 'Planning bijgewerkt door je partner' : 'Gedeelde planning geladen', true);
    if (blad.open) wachtOpTekenen = true; // niet storen tijdens het bewerken
    else if (!document.activeElement || !inhoud.contains(document.activeElement) || staat.scherm === 'dag') teken();
    else wachtOpTekenen = true;
  }

  function tekenDeelstatus(st) {
    const knop = $('#deelstatus');
    if (!knop) return;
    knop.hidden = st.soort === 'uit';
    knop.textContent = ({ ok: '● ', bezig: '◌ ', offline: '○ ', fout: '⚠ ', afgemeld: '○ ' }[st.soort] || '') + st.tekst;
    knop.dataset.soort = st.soort;
    if (staat.scherm === 'gezin' && !inhoud.contains(document.activeElement)) teken();
  }

  // ---------- Hulpjes ----------

  const $ = sel => document.querySelector(sel);
  const inhoud = $('#inhoud');
  const blad = $('#blad');
  const bladForm = $('#blad-form');

  function e(tekst) {
    return String(tekst == null ? '' : tekst)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function persoon(id, leegTekst) {
    const lid = L.lid(staat.data, id);
    if (!lid) return '<span class="persoon leeg">' + e(leegTekst || 'Nog niemand') + '</span>';
    return '<span class="persoon" style="--kleur:' + e(lid.kleur) + '"><i></i>' + e(lid.naam) + '</span>';
  }

  function personen(ids) {
    const lijst = (ids || []).map(id => L.lid(staat.data, id)).filter(Boolean);
    if (!lijst.length) return '';
    return lijst.map(l => '<span class="persoon klein" style="--kleur:' + e(l.kleur) + '"><i></i>' + e(l.naam) + '</span>').join('');
  }

  function weekdagNaam(datum) {
    return L.DAGEN[L.weekdagIndex(datum)];
  }

  let meldTimer;
  function meld(tekst) {
    const m = $('#melding');
    m.textContent = tekst;
    m.hidden = false;
    clearTimeout(meldTimer);
    meldTimer = setTimeout(() => { m.hidden = true; }, 2200);
  }

  function relatieveDag(datum) {
    const verschil = Math.round((datum - vandaag()) / 864e5);
    if (verschil === 0) return 'Vandaag';
    if (verschil === 1) return 'Morgen';
    if (verschil === -1) return 'Gisteren';
    const naam = weekdagNaam(datum);
    return naam.charAt(0).toUpperCase() + naam.slice(1);
  }

  // ---------- Kop en navigatie ----------

  function tekenKop() {
    const titel = $('#titel');
    const sub = $('#subtitel');
    const pijlen = [$('#vorige'), $('#volgende')];
    if (staat.scherm === 'dag') {
      titel.textContent = relatieveDag(staat.datum);
      sub.textContent = L.datumLang(staat.datum);
      pijlen.forEach(p => { p.hidden = false; });
    } else if (staat.scherm === 'week') {
      if (staat.weekModus === 'standaard') {
        titel.textContent = 'Standaardweek';
        sub.textContent = 'Zo ziet een gewone week eruit';
        pijlen.forEach(p => { p.hidden = true; });
      } else {
        const eind = L.plusDagen(staat.weekStart, 6);
        titel.textContent = 'Week ' + L.weekNummer(staat.weekStart);
        sub.textContent = staat.weekStart.getDate() + ' ' + L.MAANDEN[staat.weekStart.getMonth()].slice(0, 3) +
          ' – ' + eind.getDate() + ' ' + L.MAANDEN[eind.getMonth()].slice(0, 3);
        pijlen.forEach(p => { p.hidden = false; });
      }
    } else {
      titel.textContent = 'Gezin';
      sub.textContent = 'Wie doet er mee?';
      pijlen.forEach(p => { p.hidden = true; });
    }
    document.querySelectorAll('.tabs button').forEach(b => {
      b.classList.toggle('actief', b.dataset.scherm === staat.scherm);
    });
  }

  function verschuif(richting) {
    if (staat.scherm === 'dag') staat.datum = L.plusDagen(staat.datum, richting);
    else if (staat.scherm === 'week') staat.weekStart = L.plusDagen(staat.weekStart, 7 * richting);
    teken();
  }

  function teken() {
    tekenKop();
    if (staat.scherm === 'dag') tekenDag();
    else if (staat.scherm === 'week') tekenWeek();
    else tekenGezin();
  }

  // ---------- Dagoverzicht ----------

  function badge(aangepast) {
    return aangepast ? '<span class="badge" title="Wijkt af van de standaardweek">alleen vandaag</span>' : '';
  }

  function tekenDag() {
    const plan = L.dagPlan(staat.data, staat.datum);
    const isVandaag = L.zelfdeDag(staat.datum, vandaag());
    let html = '';

    if (!isVandaag) {
      html += '<button class="naar-vandaag" data-actie="naar-vandaag">↩ Terug naar vandaag</button>';
    }

    if (plan.school) {
      html +=
        '<div class="rij-twee">' +
        kaart('brengen', '🎒', 'Naar school brengen', persoon(plan.brengen.wie), plan.brengen.tijd, plan.aangepast.brengen) +
        kaart('halen', '🏫', 'Ophalen van school', persoon(plan.halen.wie), plan.halen.tijd, plan.aangepast.halen) +
        '</div>';
    } else {
      html +=
        '<button class="kaart geen-school" data-actie="bewerk" data-veld="school">' +
        '<span class="icoon">🌤️</span><span><strong>Geen school</strong>' +
        '<small>' + (plan.aangepast.school ? 'Alleen vandaag. ' : '') + 'Tik om te wijzigen</small></span></button>';
    }

    // Activiteiten
    html += '<section class="kaart lijst"><div class="kaart-kop"><span class="icoon">📅</span><h2>Activiteiten</h2>' +
      '<button class="plus" data-actie="nieuwe-activiteit" aria-label="Activiteit toevoegen">＋</button></div>';
    if (!plan.activiteiten.length) {
      html += '<p class="leeg-tekst">Niets gepland. Tik op ＋ om iets toe te voegen.</p>';
    } else {
      html += '<ul class="activiteiten">' + plan.activiteiten.map(a =>
        '<li><button data-actie="bewerk-activiteit" data-id="' + e(a.id) + '">' +
        '<span class="tijd">' + e(a.tijd || '–') + '</span>' +
        '<span class="act-tekst"><strong>' + e(a.titel) + '</strong>' +
        (a.eenmalig ? ' <span class="badge">eenmalig</span>' : '') +
        '<span class="act-wie">' + personen(a.wie) + '</span></span></button></li>'
      ).join('') + '</ul>';
    }
    if (plan.overgeslagen.length) {
      html += '<ul class="overgeslagen">' + plan.overgeslagen.map(a =>
        '<li><s>' + e(a.tijd) + ' ' + e(a.titel) + '</s> <button class="link" data-actie="herstel-activiteit" data-id="' +
        e(a.id) + '">terugzetten</button></li>').join('') + '</ul>';
    }
    html += '</section>';

    // Avondeten
    html += '<button class="kaart eten" data-actie="bewerk" data-veld="eten">' +
      '<div class="kaart-kop"><span class="icoon">🍝</span><h2>Avondeten</h2>' + badge(plan.aangepast.eten) + '</div>' +
      '<p class="groot">' + (plan.eten.wat ? e(plan.eten.wat) : '<span class="leeg-tekst">Nog niet beslist</span>') + '</p>' +
      (plan.eten.kok ? '<p class="klein-grijs">Kookt: ' + persoon(plan.eten.kok) + '</p>' : '') +
      '</button>';

    if (plan.school) {
      html += '<button class="link midden" data-actie="bewerk" data-veld="school">Geen school vandaag? (vakantie, vrije dag)</button>';
    }

    inhoud.innerHTML = html;
  }

  function kaart(veld, icoon, label, wieHtml, tijd, aangepast) {
    return '<button class="kaart taak" data-actie="bewerk" data-veld="' + veld + '">' +
      '<div class="kaart-kop"><span class="icoon">' + icoon + '</span><h2>' + label + '</h2></div>' +
      '<div class="taak-wie">' + wieHtml + '</div>' +
      '<div class="taak-onder"><span class="tijd">' + e(tijd || '') + '</span>' + badge(aangepast) + '</div>' +
      '</button>';
  }

  // ---------- Weekoverzicht ----------

  function tekenWeek() {
    let html = '<div class="schakelaar" role="tablist">' +
      '<button data-actie="weekmodus" data-modus="deze" class="' + (staat.weekModus === 'deze' ? 'actief' : '') + '">Deze week</button>' +
      '<button data-actie="weekmodus" data-modus="standaard" class="' + (staat.weekModus === 'standaard' ? 'actief' : '') + '">Standaardweek aanpassen</button>' +
      '</div>';
    html += staat.weekModus === 'standaard' ? standaardWeekHtml() : dezeWeekHtml();
    inhoud.innerHTML = html;
  }

  function dezeWeekHtml() {
    let html = '<ul class="weeklijst">';
    for (let i = 0; i < 7; i++) {
      const datum = L.plusDagen(staat.weekStart, i);
      const plan = L.dagPlan(staat.data, datum);
      const isVandaag = L.zelfdeDag(datum, vandaag());
      const aangepast = Object.keys(plan.aangepast).length > 0 || plan.overgeslagen.length > 0 ||
        plan.activiteiten.some(a => a.eenmalig);
      html += '<li><button class="weekdag' + (isVandaag ? ' vandaag' : '') + '" data-actie="open-dag" data-datum="' + L.datumSleutel(datum) + '">' +
        '<span class="wd-datum"><strong>' + L.DAGEN_KORT[i] + '</strong>' + datum.getDate() + '</span>' +
        '<span class="wd-info">';
      if (plan.school) {
        html += '<span class="wd-regel">🎒 ' + persoon(plan.brengen.wie, '?') + ' 🏫 ' + persoon(plan.halen.wie, '?') + '</span>';
      } else {
        html += '<span class="wd-regel klein-grijs">Geen school</span>';
      }
      if (plan.activiteiten.length) {
        html += '<span class="wd-regel klein-grijs">📅 ' + plan.activiteiten.map(a => e(a.titel)).join(', ') + '</span>';
      }
      html += '<span class="wd-regel klein-grijs">🍝 ' + (plan.eten.wat ? e(plan.eten.wat) : '–') + '</span>';
      html += '</span>' + (aangepast ? '<span class="stip" title="Aangepast"></span>' : '') + '</button></li>';
    }
    html += '</ul><p class="uitleg">Tik op een dag om hem te bekijken of aan te passen. Een stip betekent dat die dag afwijkt van de standaardweek.</p>';
    return html;
  }

  function persoonKeuze(naam, gekozen, leegTekst) {
    return '<select name="' + naam + '">' +
      '<option value="">' + e(leegTekst || '–') + '</option>' +
      staat.data.leden.map(l => '<option value="' + e(l.id) + '"' + (l.id === gekozen ? ' selected' : '') + '>' + e(l.naam) + '</option>').join('') +
      '</select>';
  }

  function standaardWeekHtml() {
    let html = '<p class="uitleg">Wijzigingen hier gelden voor elke week. Wil je één dag anders? Pas die dag aan in het dagoverzicht.</p>';
    html += '<div class="standaardweek">';
    for (let i = 0; i < 7; i++) {
      const dag = staat.data.week[i];
      html += '<section class="kaart sw-dag" data-weekdag="' + i + '">' +
        '<div class="kaart-kop"><h2>' + L.DAGEN[i] + '</h2>' +
        '<label class="vinkje"><input type="checkbox" name="school"' + (dag.school ? ' checked' : '') + '> school</label></div>';
      if (dag.school) {
        html += '<div class="sw-raster">' +
          '<label>🎒 Brengen' + persoonKeuze('brengen.wie', dag.brengen.wie) + '</label>' +
          '<label>om<input type="time" name="brengen.tijd" value="' + e(dag.brengen.tijd) + '"></label>' +
          '<label>🏫 Halen' + persoonKeuze('halen.wie', dag.halen.wie) + '</label>' +
          '<label>om<input type="time" name="halen.tijd" value="' + e(dag.halen.tijd) + '"></label>' +
          '</div>';
      }
      html += '<div class="sw-raster">' +
        '<label class="breed">🍝 Avondeten<input type="text" name="eten.wat" list="gerechten-lijst" placeholder="Kies of typ een gerecht" value="' + e(dag.eten.wat) + '"></label>' +
        '<label>Kookt' + persoonKeuze('eten.kok', dag.eten.kok) + '</label>' +
        '</div>';
      html += '<div class="sw-acts">' + dag.activiteiten.map(a =>
        '<button class="chip" data-actie="bewerk-vaste-activiteit" data-weekdag="' + i + '" data-id="' + e(a.id) + '">' +
        e(a.tijd) + ' ' + e(a.titel) + '</button>').join('') +
        '<button class="chip plus-chip" data-actie="nieuwe-vaste-activiteit" data-weekdag="' + i + '">＋ vaste activiteit</button></div>';
      html += '</section>';
    }
    html += '</div>';
    html += '<datalist id="gerechten-lijst">' + L.gerechtenLijst(staat.data).map(g => '<option value="' + e(g) + '">').join('') + '</datalist>';
    return html;
  }

  /** Een datum in de getoonde week voor een weekdag (nodig om in de standaardweek te bewerken). */
  function datumVoorWeekdag(weekdag) {
    return L.plusDagen(L.maandagVan(vandaag()), weekdag);
  }

  function standaardWeekWijziging(doel) {
    const sectie = doel.closest('[data-weekdag]');
    if (!sectie) return;
    const i = Number(sectie.dataset.weekdag);
    const dag = staat.data.week[i];
    const [veld, sub] = doel.name.split('.');
    if (veld === 'school') {
      dag.school = doel.checked;
      bewaar('Opgeslagen voor elke ' + L.DAGEN[i]);
      tekenWeek();
      return;
    }
    let waarde = doel.value;
    if (sub === 'wie' || sub === 'kok') waarde = waarde || null;
    if (sub === 'wat') waarde = waarde.trim();
    dag[veld][sub] = waarde;
    const nieuw = sub === 'wat' && L.voegGerechtToe(staat.data, waarde);
    bewaar('Opgeslagen voor elke ' + L.DAGEN[i] + (nieuw ? '. ' + waarde + ' staat nu in de gerechtenlijst' : ''));
    if (nieuw) {
      const lijst = inhoud.querySelector('#gerechten-lijst');
      if (lijst) lijst.innerHTML = L.gerechtenLijst(staat.data).map(g => '<option value="' + e(g) + '">').join('');
    }
  }

  // ---------- Gezin ----------

  function tekenGezin() {
    let html = '<section class="kaart"><div class="kaart-kop"><span class="icoon">👪</span><h2>Gezinsleden</h2></div>' +
      '<ul class="leden">' + staat.data.leden.map(l =>
        '<li data-lid="' + e(l.id) + '">' +
        '<input type="color" name="kleur" value="' + e(l.kleur) + '" aria-label="Kleur">' +
        '<input type="text" name="naam" value="' + e(l.naam) + '" aria-label="Naam">' +
        '<select name="rol" aria-label="Rol">' +
        ['ouder', 'kind', 'andere'].map(r => '<option value="' + r + '"' + (l.rol === r ? ' selected' : '') + '>' + r + '</option>').join('') +
        '</select>' +
        '<button class="wis" data-actie="wis-lid" data-id="' + e(l.id) + '" aria-label="Verwijder ' + e(l.naam) + '">🗑</button>' +
        '</li>').join('') + '</ul>' +
      '<button class="knop secundair" data-actie="nieuw-lid">＋ Persoon toevoegen</button>' +
      '<p class="uitleg">Voeg ook grootouders, de oppas of de naschoolse opvang toe als zij soms brengen of halen.</p></section>';

    html += '<section class="kaart"><div class="kaart-kop"><span class="icoon">🍽️</span><h2>Gerechten</h2></div>' +
      '<p class="uitleg">Hieruit kies je bij het avondeten. Een nieuw gerecht dat je daar typt, komt er vanzelf bij.</p>' +
      '<div class="chips gerechtenbeheer">' + L.gerechtenLijst(staat.data).map(g =>
        '<span class="chip">' + e(g) + '<button class="chip-wis" data-actie="wis-gerecht" data-gerecht="' + e(g) +
        '" aria-label="' + e(g) + ' verwijderen">×</button></span>').join('') + '</div>' +
      '<form id="gerecht-toevoegen" class="rij-toevoegen"><input type="text" name="gerecht" placeholder="Nieuw gerecht" autocomplete="off" aria-label="Nieuw gerecht">' +
      '<button class="knop secundair" type="submit">Toevoegen</button></form></section>';

    html += deelKaartHtml();

    html += '<section class="kaart"><div class="kaart-kop"><span class="icoon">💾</span><h2>Gegevens</h2></div>' +
      '<p class="uitleg">De planning staat altijd ook op dit toestel, zodat ze offline werkt. Een reservekopie maken of zonder Supabase overzetten: exporteer hier en importeer daar.</p>' +
      '<div class="knoppen">' +
      '<button class="knop secundair" data-actie="exporteer">Exporteren</button>' +
      '<label class="knop secundair">Importeren<input type="file" id="importeer" accept="application/json,.json" hidden></label>' +
      '</div>' +
      '<button class="link gevaar" data-actie="alles-wissen">Alles wissen en opnieuw beginnen</button>' +
      '</section>' +
      '<p class="uitleg midden-tekst">Versie ' + APP_VERSIE + '</p>';
    inhoud.innerHTML = html;
  }

  const STAPPENPLAN = 'https://github.com/krisfranckx/weekplanning/blob/main/DELEN.md';

  function deelKaartHtml() {
    const S = window.Sync;
    const st = S.status();
    let html = '<section class="kaart deelkaart"><div class="kaart-kop"><span class="icoon">🔗</span><h2>Samen delen</h2></div>';
    if (!S.config()) {
      html += '<p class="uitleg">Deel de planning live met je partner via een gratis Supabase-project. ' +
        'Volg eerst het <a href="' + STAPPENPLAN + '" target="_blank" rel="noopener">stappenplan</a>, vul dan hieronder de twee gegevens in. ' +
        'Kreeg je een koppel-link van je partner? Open die gewoon, dan staat dit al ingevuld.</p>' +
        '<form id="deel-config" class="deel-form">' +
        '<label class="veld">Project-URL<input type="url" name="url" required placeholder="https://xxxx.supabase.co" autocomplete="off"></label>' +
        '<label class="veld">Publieke sleutel (anon / publishable)<input type="text" name="sleutel" required autocomplete="off" spellcheck="false"></label>' +
        '<button class="knop" type="submit">Verder</button></form>';
    } else if (!S.gebruiker()) {
      html += '<p class="uitleg">Log in met je eigen e-mailadres. Eerste keer? Kies <strong>Account aanmaken</strong>. ' +
        'Staat er al een gedeelde planning, dan neemt dit toestel die over.</p>' +
        (st.soort === 'fout' || st.soort === 'offline' ? '<p class="foutmelding">' + e(st.tekst) + '</p>' : '') +
        '<form id="deel-login" class="deel-form">' +
        '<label class="veld">E-mailadres<input type="email" name="email" required autocomplete="username"></label>' +
        '<label class="veld">Wachtwoord<input type="password" name="wachtwoord" required minlength="6" autocomplete="current-password"></label>' +
        '<div class="knoppen"><button class="knop" type="submit" value="in">Inloggen</button>' +
        '<button class="knop secundair" type="submit" value="nieuw">Account aanmaken</button></div></form>' +
        '<button class="link" data-actie="deel-stop">Andere Supabase-gegevens invullen</button>';
    } else {
      html += '<p>Ingelogd als <strong>' + e(S.gebruiker().email) + '</strong></p>' +
        '<p class="deel-status" data-soort="' + e(st.soort) + '">' + e(st.tekst) + '</p>' +
        '<div class="knoppen"><button class="knop secundair" data-actie="deel-link">Link voor partner kopiëren</button></div>' +
        '<p class="uitleg">Stuur die link naar je partner. Wie hem opent, krijgt de Supabase-gegevens automatisch ingevuld en logt daarna in met het eigen e-mailadres.</p>' +
        '<button class="link" data-actie="deel-uit">Uitloggen</button> · ' +
        '<button class="link gevaar" data-actie="deel-stop">Delen stoppen op dit toestel</button>';
    }
    return html + '</section>';
  }

  async function deelFormulier(form, knopWaarde) {
    const S = window.Sync;
    const f = new FormData(form);
    const knoppen = form.querySelectorAll('button');
    knoppen.forEach(k => { k.disabled = true; });
    try {
      if (form.id === 'deel-config') {
        S.zetConfig(f.get('url'), f.get('sleutel'));
        meld('Opgeslagen. Log nu in.');
      } else if (knopWaarde === 'nieuw') {
        const uitkomst = await S.registreren(f.get('email'), f.get('wachtwoord'));
        meld(uitkomst === 'bevestigen' ? 'Kijk in je mailbox en bevestig je e-mailadres, log dan in' : 'Account gemaakt en ingelogd');
      } else {
        await S.inloggen(f.get('email'), f.get('wachtwoord'));
        meld('Ingelogd');
      }
    } catch (fout) {
      meld(fout.message || 'Er ging iets mis');
    }
    teken();
  }

  async function kopieerKoppelLink() {
    const link = window.Sync.koppelLink();
    try {
      if (navigator.share) { await navigator.share({ title: 'Weekplanning', text: 'Onze weekplanning', url: link }); return; }
      await navigator.clipboard.writeText(link);
      meld('Link gekopieerd');
    } catch (fout) {
      if (fout && fout.name === 'AbortError') return;
      prompt('Kopieer deze link:', link);
    }
  }

  function gezinWijziging(doel) {
    const rij = doel.closest('[data-lid]');
    if (!rij) return;
    const lid = L.lid(staat.data, rij.dataset.lid);
    if (!lid) return;
    if (doel.name === 'naam') lid.naam = doel.value.trim() || lid.naam;
    else lid[doel.name] = doel.value;
    bewaar('Opgeslagen');
  }

  function exporteer() {
    const blob = new Blob([JSON.stringify(staat.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'weekplanning-' + L.datumSleutel(vandaag()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importeer(bestand) {
    const lezer = new FileReader();
    lezer.onload = () => {
      try {
        const data = JSON.parse(lezer.result);
        if (!data || !Array.isArray(data.week)) throw new Error('geen weekplanning');
        if (!confirm('De huidige planning op dit toestel wordt vervangen. Doorgaan?')) return;
        staat.data = L.normaliseer(data);
        bewaar('Planning geïmporteerd');
        teken();
      } catch (fout) {
        meld('Dit bestand is geen geldige weekplanning');
      }
    };
    lezer.readAsText(bestand);
  }

  // ---------- Bewerkblad (onderaan het scherm) ----------

  let bladActie = null;

  function openBlad(html, opOpslaan) {
    bladForm.innerHTML = html;
    bladActie = opOpslaan;
    blad.showModal();
    const eerste = bladForm.querySelector('input[type=text]');
    if (eerste && !eerste.value) eerste.focus();
  }

  function sluitBlad() {
    blad.close();
    bladActie = null;
    if (wachtOpTekenen) { wachtOpTekenen = false; teken(); }
  }

  function bereikKeuze(datum, standaard, tekstWeek) {
    const naam = weekdagNaam(datum);
    return '<fieldset class="bereik"><legend>Geldt voor</legend>' +
      '<label><input type="radio" name="bereik" value="dag"' + (standaard === 'dag' ? ' checked' : '') + '> Alleen ' + L.datumKort(datum) + '</label>' +
      '<label><input type="radio" name="bereik" value="week"' + (standaard === 'week' ? ' checked' : '') + '> ' + (tekstWeek || 'Elke ' + naam) + '</label>' +
      '</fieldset>';
  }

  function persoonChips(naam, gekozen, meervoud, metNiemand) {
    const type = meervoud ? 'checkbox' : 'radio';
    const lijst = meervoud ? (gekozen || []) : [gekozen];
    let html = '<div class="chips">';
    if (metNiemand) {
      html += '<label class="chip-keuze"><input type="radio" name="' + naam + '" value=""' + (!gekozen ? ' checked' : '') + '><span>Niemand</span></label>';
    }
    html += staat.data.leden.map(l =>
      '<label class="chip-keuze" style="--kleur:' + e(l.kleur) + '"><input type="' + type + '" name="' + naam + '" value="' + e(l.id) + '"' +
      (lijst.includes(l.id) ? ' checked' : '') + '><span><i></i>' + e(l.naam) + '</span></label>').join('');
    return html + '</div>';
  }

  /** Gerechten als tikbare knoppen; `zoek` filtert, het gekozen gerecht wordt gemarkeerd. */
  function gerechtChips(zoek) {
    const lijst = L.gerechtenLijst(staat.data, zoek);
    const gekozen = (zoek || '').trim().toLowerCase();
    if (!lijst.length) {
      return '<p class="uitleg">Nieuw gerecht. Het komt in de lijst als je opslaat.</p>';
    }
    return lijst.map(g => '<button type="button" class="chip gerecht' + (g.toLowerCase() === gekozen ? ' gekozen' : '') +
      '" data-gerecht="' + e(g) + '">' + e(g) + '</button>').join('');
  }

  function bladKnoppen(extra) {
    return '<div class="blad-knoppen">' + (extra || '') +
      '<button type="button" class="knop secundair" data-blad="annuleer">Annuleren</button>' +
      '<button type="submit" class="knop" value="ok">Opslaan</button></div>';
  }

  function bewerkVeld(veld) {
    const datum = staat.datum;
    const plan = L.dagPlan(staat.data, datum);
    const aangepast = !!plan.aangepast[veld];
    const herstel = aangepast ? '<button type="button" class="link" data-blad="herstel">Terug naar standaardweek</button>' : '';
    let html;

    if (veld === 'brengen' || veld === 'halen') {
      const titel = veld === 'brengen' ? '🎒 Wie brengt naar school?' : '🏫 Wie haalt op van school?';
      html = '<h2>' + titel + '</h2>' +
        persoonChips('wie', plan[veld].wie, false, true) +
        '<label class="veld">Tijd<input type="time" name="tijd" value="' + e(plan[veld].tijd) + '"></label>';
    } else if (veld === 'eten') {
      html = '<h2>🍝 Avondeten</h2>' +
        '<label class="veld">Wat eten we?<input type="text" name="wat" value="' + e(plan.eten.wat) + '" placeholder="Kies hieronder of typ een nieuw gerecht" autocomplete="off"></label>' +
        '<div class="gerecht-keuze" id="gerecht-keuze">' + gerechtChips('') + '</div>' +
        '<p class="veld-label">Wie kookt?</p>' + persoonChips('kok', plan.eten.kok, false, true);
    } else if (veld === 'school') {
      html = '<h2>📚 School</h2>' +
        '<div class="chips">' +
        '<label class="chip-keuze"><input type="radio" name="school" value="ja"' + (plan.school ? ' checked' : '') + '><span>Er is school</span></label>' +
        '<label class="chip-keuze"><input type="radio" name="school" value="nee"' + (!plan.school ? ' checked' : '') + '><span>Geen school</span></label>' +
        '</div>';
    }
    html += bereikKeuze(datum, 'dag') + herstel + bladKnoppen();

    openBlad(html, (form, knop) => {
      if (knop === 'herstel') {
        L.herstelVeld(staat.data, datum, veld);
        bewaar('Terug zoals in de standaardweek');
        return;
      }
      const f = new FormData(form);
      let waarde;
      if (veld === 'brengen' || veld === 'halen') waarde = { wie: f.get('wie') || null, tijd: f.get('tijd') || '' };
      else if (veld === 'eten') waarde = { wat: (f.get('wat') || '').trim(), kok: f.get('kok') || null };
      else waarde = f.get('school') === 'ja';
      const bereik = f.get('bereik');
      L.zetVeld(staat.data, datum, veld, waarde, bereik);
      const nieuwGerecht = veld === 'eten' && L.voegGerechtToe(staat.data, waarde.wat);
      bewaar((bereik === 'week' ? 'Opgeslagen voor elke ' + weekdagNaam(datum) : 'Opgeslagen voor ' + L.datumKort(datum)) +
        (nieuwGerecht ? '. ' + waarde.wat + ' staat nu in de gerechtenlijst' : ''));
    });
  }

  /**
   * Activiteit bewerken. `vastOnly` = bewerken vanuit de standaardweek (altijd "elke week").
   */
  function bewerkActiviteit(datum, activiteit, vastOnly) {
    const nieuw = !activiteit;
    const act = activiteit || { titel: '', tijd: '', wie: [] };
    const isVast = !nieuw && !act.eenmalig;
    let html = '<h2>📅 ' + (nieuw ? 'Nieuwe activiteit' : 'Activiteit') + '</h2>' +
      '<label class="veld">Wat?<input type="text" name="titel" required value="' + e(act.titel) + '" placeholder="bv. Zwemles, verjaardagsfeest" autocomplete="off"></label>' +
      '<label class="veld">Hoe laat?<input type="time" name="tijd" value="' + e(act.tijd) + '"></label>' +
      '<p class="veld-label">Wie?</p>' + persoonChips('wie', act.wie, true, false);
    if (vastOnly) {
      html += '<p class="uitleg">Deze activiteit komt elke ' + weekdagNaam(datum) + ' terug.</p>';
    } else {
      html += bereikKeuze(datum, isVast ? 'week' : 'dag');
    }
    let extra = '';
    if (!nieuw) {
      extra = isVast && !vastOnly
        ? '<button type="button" class="link gevaar" data-blad="sla-over">Niet op ' + L.datumKort(datum) + '</button>' +
          '<button type="button" class="link gevaar" data-blad="wis">Elke week verwijderen</button>'
        : '<button type="button" class="link gevaar" data-blad="wis">Verwijderen</button>';
    }
    html += bladKnoppen(extra);

    openBlad(html, (form, knop) => {
      if (knop === 'sla-over') {
        L.verwijderActiviteit(staat.data, datum, act.id, 'dag');
        bewaar('Overgeslagen op ' + L.datumKort(datum));
        return;
      }
      if (knop === 'wis') {
        L.verwijderActiviteit(staat.data, datum, act.id, 'week');
        bewaar('Verwijderd');
        return;
      }
      const f = new FormData(form);
      const titel = (f.get('titel') || '').trim();
      if (!titel) return false;
      const bereik = vastOnly ? 'week' : f.get('bereik');
      L.bewaarActiviteit(staat.data, datum, { id: act.id, titel: titel, tijd: f.get('tijd'), wie: f.getAll('wie') }, bereik);
      bewaar(bereik === 'week' ? 'Opgeslagen voor elke ' + weekdagNaam(datum) : 'Opgeslagen voor ' + L.datumKort(datum));
    });
  }

  bladForm.addEventListener('submit', ev => {
    ev.preventDefault();
    if (bladActie && bladActie(bladForm, 'ok') === false) return;
    sluitBlad();
    teken();
  });

  bladForm.addEventListener('input', ev => {
    if (ev.target.name !== 'wat') return;
    const doos = bladForm.querySelector('#gerecht-keuze');
    if (doos) doos.innerHTML = gerechtChips(ev.target.value);
  });

  bladForm.addEventListener('click', ev => {
    const gerecht = ev.target.closest('[data-gerecht]');
    if (gerecht) {
      const veld = bladForm.querySelector('input[name=wat]');
      veld.value = gerecht.dataset.gerecht;
      bladForm.querySelector('#gerecht-keuze').innerHTML = gerechtChips(veld.value);
      return;
    }
    const knop = ev.target.closest('[data-blad]');
    if (!knop) return;
    const soort = knop.dataset.blad;
    if (soort === 'annuleer') { sluitBlad(); return; }
    if (bladActie) bladActie(bladForm, soort);
    sluitBlad();
    teken();
  });

  // Tik naast het blad om te sluiten
  blad.addEventListener('click', ev => {
    if (ev.target === blad) sluitBlad();
  });

  // ---------- Klikken en wijzigingen ----------

  document.querySelector('.tabs').addEventListener('click', ev => {
    const knop = ev.target.closest('[data-scherm]');
    if (!knop) return;
    staat.scherm = knop.dataset.scherm;
    if (staat.scherm === 'dag' && knop.classList.contains('actief')) staat.datum = vandaag();
    teken();
    window.scrollTo(0, 0);
  });

  blad.addEventListener('close', () => {
    if (wachtOpTekenen) { wachtOpTekenen = false; teken(); }
  });
  inhoud.addEventListener('focusout', () => {
    setTimeout(() => {
      if (wachtOpTekenen && !blad.open && !inhoud.contains(document.activeElement)) { wachtOpTekenen = false; teken(); }
    }, 0);
  });
  $('#deelstatus').addEventListener('click', () => { staat.scherm = 'gezin'; teken(); });

  $('#vorige').addEventListener('click', () => verschuif(-1));
  $('#volgende').addEventListener('click', () => verschuif(1));

  inhoud.addEventListener('click', ev => {
    const knop = ev.target.closest('[data-actie]');
    if (!knop) return;
    const actie = knop.dataset.actie;
    const d = staat.data;

    switch (actie) {
      case 'naar-vandaag':
        staat.datum = vandaag();
        teken();
        break;
      case 'bewerk':
        bewerkVeld(knop.dataset.veld);
        break;
      case 'nieuwe-activiteit':
        bewerkActiviteit(staat.datum, null, false);
        break;
      case 'bewerk-activiteit': {
        const act = L.dagPlan(d, staat.datum).activiteiten.find(a => a.id === knop.dataset.id);
        if (act) bewerkActiviteit(staat.datum, act, false);
        break;
      }
      case 'herstel-activiteit':
        L.herstelActiviteit(d, staat.datum, knop.dataset.id);
        bewaar('Teruggezet');
        teken();
        break;
      case 'weekmodus':
        staat.weekModus = knop.dataset.modus;
        teken();
        break;
      case 'open-dag':
        staat.datum = L.vanSleutel(knop.dataset.datum);
        staat.scherm = 'dag';
        teken();
        window.scrollTo(0, 0);
        break;
      case 'nieuwe-vaste-activiteit':
        bewerkActiviteit(datumVoorWeekdag(Number(knop.dataset.weekdag)), null, true);
        break;
      case 'bewerk-vaste-activiteit': {
        const i = Number(knop.dataset.weekdag);
        const act = d.week[i].activiteiten.find(a => a.id === knop.dataset.id);
        if (act) bewerkActiviteit(datumVoorWeekdag(i), Object.assign({ eenmalig: false }, act), true);
        break;
      }
      case 'nieuw-lid':
        d.leden.push({ id: L.maakId(), naam: 'Nieuwe persoon', rol: 'andere', kleur: L.volgendeKleur(d) });
        bewaar('Persoon toegevoegd');
        teken();
        {
          const velden = inhoud.querySelectorAll('.leden input[name=naam]');
          const laatste = velden[velden.length - 1];
          if (laatste) { laatste.focus(); laatste.select(); }
        }
        break;
      case 'wis-lid': {
        const lid = L.lid(d, knop.dataset.id);
        if (lid && confirm(lid.naam + ' verwijderen? Waar ' + lid.naam + ' ingepland stond, wordt dat leeg.')) {
          L.verwijderLid(d, lid.id);
          bewaar('Verwijderd');
          teken();
        }
        break;
      }
      case 'exporteer':
        exporteer();
        break;
      case 'wis-gerecht':
        L.verwijderGerecht(d, knop.dataset.gerecht);
        bewaar(knop.dataset.gerecht + ' verwijderd uit de lijst');
        teken();
        break;
      case 'deel-link':
        kopieerKoppelLink();
        break;
      case 'deel-uit':
        window.Sync.uitloggen().then(teken);
        break;
      case 'deel-stop':
        if (!window.Sync.gebruiker() || confirm('Delen stoppen op dit toestel? De planning blijft hier staan, maar wordt niet meer gedeeld.')) {
          window.Sync.wisConfig().then(teken);
        }
        break;
      case 'alles-wissen':
        if (confirm('Alles wissen? De planning op dit toestel gaat verloren.')) {
          staat.data = L.standaardData();
          bewaar('Opnieuw begonnen');
          teken();
        }
        break;
    }
  });

  inhoud.addEventListener('submit', ev => {
    ev.preventDefault();
    if (ev.target.id === 'gerecht-toevoegen') {
      const naam = (new FormData(ev.target).get('gerecht') || '').trim();
      if (naam) {
        bewaar(L.voegGerechtToe(staat.data, naam) ? naam + ' toegevoegd' : naam + ' staat al in de lijst');
        teken();
        const veld = inhoud.querySelector('#gerecht-toevoegen input');
        if (veld) veld.focus();
      }
      return;
    }
    const knop = ev.submitter;
    deelFormulier(ev.target, knop ? knop.value : '');
  });

  inhoud.addEventListener('change', ev => {
    const doel = ev.target;
    if (doel.id === 'importeer') {
      if (doel.files && doel.files[0]) importeer(doel.files[0]);
      doel.value = '';
      return;
    }
    if (staat.scherm === 'week' && staat.weekModus === 'standaard') standaardWeekWijziging(doel);
    else if (staat.scherm === 'gezin') gezinWijziging(doel);
  });

  // Vegen naar links/rechts om van dag of week te wisselen
  let vegenStart = null;
  inhoud.addEventListener('touchstart', ev => {
    const t = ev.touches[0];
    vegenStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  inhoud.addEventListener('touchend', ev => {
    if (!vegenStart || staat.scherm === 'gezin' || (staat.scherm === 'week' && staat.weekModus === 'standaard')) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - vegenStart.x;
    const dy = t.clientY - vegenStart.y;
    vegenStart = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) verschuif(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Bij terugkomen naar de app: als we op "vandaag" stonden en het is intussen een nieuwe dag, mee opschuiven.
  let laatstGetekendeVandaag = L.datumSleutel(vandaag());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const nu = L.datumSleutel(vandaag());
    if (nu !== laatstGetekendeVandaag) {
      if (L.datumSleutel(staat.datum) === laatstGetekendeVandaag) staat.datum = vandaag();
      laatstGetekendeVandaag = nu;
      teken();
    }
  });

  // Offline werken en "zet op beginscherm"
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }

  // Persoonlijke link met namen: #gezin=ouders:A,B;kinderen:C,D
  const gezinUitLink = L.leesGezinLink(location.hash);
  if (gezinUitLink) {
    Object.keys(gezinUitLink).forEach(rol => L.zetNamen(staat.data, rol, gezinUitLink[rol]));
    const rest = location.hash.slice(1).split('&').filter(d => d && !d.startsWith('gezin=')).join('&');
    history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
    bewaar('Namen ingesteld');
  }

  if (window.Sync) {
    const gekoppeld = window.Sync.leesKoppelLink();
    window.Sync.start({
      haalData: () => staat.data,
      opNieuweData: nieuweGedeeldeData,
      opStatus: tekenDeelstatus
    });
    if (gekoppeld) {
      staat.scherm = 'gezin';
      meld('Supabase-gegevens ingevuld. Log nu in met je eigen e-mailadres.');
    }
  }

  teken();
})();
