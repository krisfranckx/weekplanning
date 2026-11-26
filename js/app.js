/* Weekplanning: schermen en bediening. De rekenlogica zit in logica.js. */
(function () {
  'use strict';

  const L = window.Logica;
  const OPSLAG_SLEUTEL = 'weekplanning.v1';
  const APP_VERSIE = '26 (26 nov 2026)';
  const AGENDA_SLEUTEL = 'weekplanning.agenda';
  const AGENDA_INTERVAL = 15 * 60 * 1000; // agenda hoogstens om de 15 minuten opnieuw ophalen

  // ---------- Toestand ----------

  const staat = {
    data: laad(),
    scherm: 'dag',
    datum: vandaag(),
    weekStart: L.maandagVan(vandaag()),
    weekModus: 'deze', // 'deze' of 'standaard'
    todoFilter: '', // lid-id of '' voor iedereen
    siri: null, // { bezig } | { gegevens } | { fout } voor de Siri-uitleg
    agenda: leesAgenda(), // afspraken uit de gekoppelde agenda (WeekCal), alleen lezen
    agendaBezig: false
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
  // ---------- Nieuw sinds je vorige bezoek ----------

  const NIEUW_SLEUTEL = 'weekplanning.nieuw';

  function leesNieuw() {
    try {
      const lijst = JSON.parse(localStorage.getItem(NIEUW_SLEUTEL)) || [];
      const grens = L.datumSleutel(vandaag());
      return lijst.filter(x => x.datum >= grens);
    } catch (e) { return []; }
  }

  function zetNieuw(lijst) {
    try { localStorage.setItem(NIEUW_SLEUTEL, JSON.stringify(lijst)); } catch (e) { /* geen opslag */ }
    zetBadge(lijst.length);
  }

  /** Getal op het app-icoon (waar het toestel dat toelaat). */
  function zetBadge(aantal) {
    try {
      if (aantal > 0 && navigator.setAppBadge) navigator.setAppBadge(aantal).catch(() => {});
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    } catch (e) { /* niet ondersteund */ }
  }

  function nieuwKaartHtml() {
    const lijst = leesNieuw();
    if (!lijst.length) return '';
    return '<section class="kaart nieuw-kaart"><div class="kaart-kop"><span class="icoon waarschuwing">' + ic('bel') + '</span>' +
      '<h2>Gewijzigd sinds je vorige bezoek</h2></div><ul class="nieuw-lijst">' +
      lijst.map(x => '<li><button data-actie="open-dag" data-datum="' + e(x.datum) + '">' +
        '<span class="nieuw-datum">' + e(L.datumKort(L.vanSleutel(x.datum))) + '</span> ' + e(x.tekst) + '</button></li>').join('') +
      '</ul><button class="knop secundair" data-actie="nieuw-gezien">Gezien</button></section>';
  }

  function nieuweGedeeldeData(data, bron, meta) {
    const oud = staat.data;
    staat.data = L.normaliseer(data);
    let aantalNieuw = 0;
    if (bron !== 'eerste') {
      const verschil = L.verschillen(oud, staat.data, vandaag(), 14)
        .map(x => Object.assign(x, { door: meta && meta.door || null }));
      aantalNieuw = verschil.length;
      if (aantalNieuw) zetNieuw(L.voegWijzigingenToe(leesNieuw(), verschil));
    }
    bewaar(bron === 'eerste' ? 'Gedeelde planning geladen'
      : aantalNieuw ? 'Je partner heeft de planning gewijzigd' : null, true);
    if (blad.open) wachtOpTekenen = true; // niet storen tijdens het bewerken
    else if (!document.activeElement || !inhoud.contains(document.activeElement) || staat.scherm === 'dag') teken();
    else wachtOpTekenen = true;
  }

  function tekenDeelstatus(st) {
    const knop = $('#deelstatus');
    if (!knop) return;
    knop.hidden = st.soort === 'uit';
    knop.textContent = st.tekst;
    knop.dataset.soort = st.soort;
    if (st.soort === 'ok') vernieuwAgenda(false);
    if (staat.scherm === 'gezin' && !inhoud.contains(document.activeElement)) teken();
  }

  // ---------- Agenda (WeekCal, iCloud, Google) ----------
  // De afspraken worden via Supabase opgehaald en per toestel bewaard. Ze zitten niet in de
  // gedeelde planning: elk toestel haalt ze zelf op, en wijzigen gebeurt in de agenda.

  function leesAgenda() {
    try { return JSON.parse(localStorage.getItem(AGENDA_SLEUTEL)) || {}; } catch (err) { return {}; }
  }

  function bewaarAgenda(a) {
    staat.agenda = a;
    try { localStorage.setItem(AGENDA_SLEUTEL, JSON.stringify(a)); } catch (err) { /* vol of niet beschikbaar */ }
  }

  async function vernieuwAgenda(dwing) {
    const S = window.Sync;
    if (!S || !S.gebruiker() || staat.agendaBezig || !window.Agenda) return;
    const a = staat.agenda || {};
    // Opslag van vóór versie 15 (één agenda, zonder uid per afspraak): meteen opnieuw ophalen.
    if (!dwing && a.versie === 3 && a.geprobeerd && Date.now() - a.geprobeerd < AGENDA_INTERVAL) return;
    staat.agendaBezig = true;
    if (dwing && staat.scherm === 'gezin') teken();
    try {
      const r = await S.rpc('agenda_ophalen');
      const v = vandaag();
      const vorige = a.versie === 3 ? (a.agendas || []) : [];
      // Per agenda: nieuwe afspraken, of bij een fout de vorige (zodat ze niet even verdwijnen).
      const agendas = ((r && r.agendas) || []).map(x => {
        const oud = vorige.find(o => o.nr === x.nr);
        if (x.fout) return { nr: x.nr, bron: x.bron, fout: x.fout, opgehaald: oud && oud.opgehaald, dagen: (oud && oud.dagen) || {} };
        return { nr: x.nr, bron: x.bron, opgehaald: Date.now(),
          dagen: window.Agenda.perDag(window.Agenda.leesIcs(x.ics), L.plusDagen(v, -14), L.plusDagen(v, 180)) };
      });
      bewaarAgenda({ versie: 3, geprobeerd: Date.now(), ingesteld: agendas.length > 0, agendas: agendas });
      if (dwing) meld(agendas.some(x => x.fout) ? 'Niet alle agenda\'s lukten' : 'Agenda bijgewerkt');
    } catch (fout) {
      bewaarAgenda(Object.assign({}, a, { geprobeerd: Date.now(), fout: (fout && fout.message) || String(fout) }));
      if (dwing) meld(staat.agenda.fout);
    } finally {
      staat.agendaBezig = false;
    }
    if (!blad.open && !inhoud.contains(document.activeElement)) teken();
  }

  /**
   * Afspraken uit de agenda voor één dag. Wie erbij hoort: wat in de app gekozen werd
   * (voor deze keer of voor elke keer), anders de gezinsleden die in de titel staan.
   */
  function agendaVoorDag(datum) {
    const a = staat.agenda;
    if (!a || !a.ingesteld || !Array.isArray(a.agendas)) return [];
    const sleutel = L.datumSleutel(datum);
    const lijst = [];
    const afvalNrs = afval().agendas; // afvalkalenders worden todo's, geen activiteiten
    a.agendas.filter(ag => !afvalNrs.includes(String(ag.nr))).forEach(ag => (ag.dagen[sleutel] || []).forEach(x => lijst.push(Object.assign({}, x, { id: ag.nr + '-' + x.id }))));
    return lijst.map(x => {
      const gekozen = x.uid ? L.agendaWieVoor(staat.data, x.uid, sleutel) : null;
      const tekst = x.uid ? L.agendaTekstVoor(staat.data, x.uid, sleutel) : {};
      return Object.assign({}, x, {
        uitAgenda: true,
        origTitel: x.titel,
        origTijd: x.tijd,
        titel: tekst.titel || x.titel,
        tijd: tekst.tijd || x.tijd,
        heleDag: x.heleDag && !tekst.tijd,
        tekstGewijzigd: !!(tekst.titel || tekst.tijd),
        gekozen: !!gekozen,
        wie: (gekozen || window.Agenda.ledenInTitel(x.titel, staat.data.leden)).filter(id => L.lid(staat.data, id))
      });
    });
  }

  /**
   * Een afspraak uit de agenda aanpassen: titel, tijd en wie. Dat wordt in de gedeelde planning
   * bewaard, niet teruggeschreven naar de agenda zelf.
   */
  function bewerkAgendaWie(datum, item) {
    const sleutel = L.datumSleutel(datum);
    const perDag = item.uid ? L.agendaWieVoor(staat.data, item.uid, sleutel) : null;
    const dagApart = !!(staat.data.agendaWie || {})[item.uid + '|' + sleutel] ||
      !!(staat.data.agendaTekst || {})[item.uid + '|' + sleutel];
    let html = '<h2>' + ic('kalender') + 'Afspraak uit je agenda</h2>' +
      '<label class="veld">Wat?<input type="text" name="titel" required value="' + e(item.titel) + '" autocomplete="off"></label>' +
      '<label class="veld">Hoe laat?<input type="time" name="tijd" value="' + e(item.tijd) + '"></label>' +
      '<p class="veld-label">Wie?</p>' + persoonChips('wie', item.wie, true, false);
    if (item.herhaalt) {
      html += '<fieldset class="bereik"><legend>Geldt voor</legend>' +
        '<label><input type="radio" name="bereik" value="reeks"' + (dagApart ? '' : ' checked') + '> Elke keer</label>' +
        '<label><input type="radio" name="bereik" value="dag"' + (dagApart ? ' checked' : '') + '> Alleen ' + L.datumKort(datum) + '</label>' +
        '</fieldset>';
    }
    html += '<p class="uitleg">' + (item.plaats ? e(item.plaats) + '. ' : '') +
      'Wat je hier wijzigt, geldt in de weekplanning; in WeekCal blijft de afspraak zoals ze was.' +
      (!item.gekozen && item.wie.length ? ' De persoon is herkend aan de naam in de titel.' : '') + '</p>';
    const extra = perDag || item.tekstGewijzigd ? '<button type="button" class="link" data-blad="automatisch">Terug zoals in de agenda</button>' : '';
    html += bladKnoppen(extra);
    openBlad(html, (form, knop) => {
      const bereik = item.herhaalt ? new FormData(form).get('bereik') : 'reeks';
      if (knop === 'automatisch') {
        L.wisAgendaWie(staat.data, item.uid, sleutel, bereik);
        bewaar('Teruggezet');
        return;
      }
      const f = new FormData(form);
      const titel = (f.get('titel') || '').trim();
      if (!titel) return false;
      const tijd = f.get('tijd') || '';
      L.zetAgendaTekst(staat.data, item.uid, sleutel, {
        titel: titel !== item.origTitel ? titel : '',
        tijd: tijd && tijd !== item.origTijd ? tijd : ''
      }, bereik);
      // Personen alleen bewaren als er iets veranderd is aan wat de app zelf herkende.
      const wie = f.getAll('wie');
      if (item.gekozen || wie.join(',') !== item.wie.join(',')) L.zetAgendaWie(staat.data, item.uid, sleutel, wie, bereik);
      bewaar(bereik === 'dag' ? 'Opgeslagen voor ' + L.datumKort(datum) : item.herhaalt ? 'Opgeslagen voor elke keer' : 'Opgeslagen');
    });
  }

  /** Eigen activiteiten en afspraken uit de agenda samen, op tijd (hele dag eerst). */
  function activiteitenMetAgenda(plan, datum) {
    const volgorde = x => (x.heleDag ? '00:00' : '') + (x.tijd || '99:99');
    return plan.activiteiten.concat(agendaVoorDag(datum)).sort((x, y) => volgorde(x).localeCompare(volgorde(y)));
  }

  // ---------- Afvalophaling ----------
  // De todo's worden berekend uit het schema (Gezin > Afvalophaling) en uit agenda's die
  // als afvalkalender aangevinkt zijn. Alleen vinkjes en verschuivingen worden bewaard.

  const A = window.Afval;

  function afval() {
    staat.data.afval = A.normaliseer(staat.data.afval);
    return staat.data.afval;
  }

  /** Ophalingen uit agenda's die als afvalkalender aangevinkt zijn. */
  function afvalUitAgenda() {
    const a = staat.agenda;
    const nrs = afval().agendas;
    if (!nrs.length || !a || !a.ingesteld || !Array.isArray(a.agendas)) return [];
    const uit = [];
    a.agendas.filter(ag => nrs.includes(String(ag.nr))).forEach(ag => Object.keys(ag.dagen || {}).forEach(datum =>
      ag.dagen[datum].forEach(x => uit.push({ uid: ag.nr + '-' + (x.uid || x.id), titel: x.titel, datum: datum }))));
    return uit;
  }

  /** De planning met de afval-todo's (deadline tussen van en tot) erbij, alleen om te tonen. */
  function metAfval(van, tot) {
    const extra = A.todos(afval(), L.datumSleutel(van), L.datumSleutel(tot), afvalUitAgenda());
    return Object.assign({}, staat.data, { todos: (staat.data.todos || []).concat(extra) });
  }

  function bewerkAfvalTodo(t) {
    const uitAgenda = t.afval.sleutel.indexOf('ag:') === 0;
    let html = '<h2>' + ic('vuilbak') + e(t.titel) + '</h2>' +
      '<p class="uitleg">Ophaling op ' + e(L.datumLang(L.vanSleutel(t.afval.ophaling))) + '. Deze todo komt ' +
      (uitAgenda ? 'uit je afvalkalender.' : 'uit het ophaalschema bij Gezin.') + ' Verschoven door een feestdag? Kies hier een andere dag om het buiten te zetten.</p>' +
      '<label class="veld">Buitenzetten op<input type="date" name="deadline" required value="' + e(t.deadline) + '"></label>' +
      '<label class="vinkje todo-klaar"><input type="checkbox" name="klaar"' + (t.klaar ? ' checked' : '') + '> Afgevinkt</label>';
    html += bladKnoppen((t.afval.verzet ? '<button type="button" class="link" data-blad="terug">Terug zoals gepland</button>' : '') +
      '<button type="button" class="link gevaar" data-blad="geen">Deze keer geen ophaling</button>');
    openBlad(html, (form, knop) => {
      const a = afval();
      if (knop === 'geen') { A.verzet(a, t.id, ''); bewaar('Deze ophaling overgeslagen'); return; }
      if (knop === 'terug') { A.verzet(a, t.id, null); bewaar('Teruggezet'); return; }
      const f = new FormData(form);
      const datum = f.get('deadline');
      if (!datum) return false;
      A.verzet(a, t.id, datum);
      A.zetKlaar(a, t.id, f.get('klaar') === 'on');
      bewaar('Opgeslagen');
    });
  }

  function bewerkAfvalSoort(soort) {
    const nieuw = !soort;
    const s = soort || { naam: '', vanaf: '', elke: 2, wie: null };
    const vanaf = soort ? A.volgende(soort, L.datumSleutel(vandaag())) : '';
    let html = '<h2>' + ic('vuilbak') + (nieuw ? 'Afvalsoort toevoegen' : e(s.naam)) + '</h2>' +
      '<label class="veld">Welk afval?<input type="text" name="naam" required list="afval-voorbeelden" value="' + e(s.naam) +
      '" placeholder="bv. PMD, Restafval, Papier en karton" autocomplete="off"></label>' +
      '<datalist id="afval-voorbeelden">' + A.VOORBEELDEN.map(x => '<option value="' + e(x) + '">').join('') + '</datalist>' +
      '<label class="veld">Eerstvolgende ophaling<input type="date" name="vanaf" required value="' + e(vanaf) + '"></label>' +
      '<label class="veld">Hoe vaak?<select name="elke">' + [1, 2, 3, 4, 8].map(n => '<option value="' + n + '"' + (s.elke === n ? ' selected' : '') + '>' +
        (n === 1 ? 'Elke week' : 'Om de ' + n + ' weken') + '</option>').join('') + '</select></label>' +
      '<p class="veld-label">Wie zet het buiten?</p>' + persoonChips('wie', s.wie, false, true) +
      '<p class="uitleg">De datums vind je in de Recycle!-app. De avond ervoor verschijnt een todo.</p>';
    html += bladKnoppen(nieuw ? '' : '<button type="button" class="link gevaar" data-blad="wis">Verwijderen</button>');
    openBlad(html, (form, knop) => {
      const a = afval();
      if (knop === 'wis') { A.verwijderSoort(a, s.id); bewaar(s.naam + ' verwijderd'); teken(); return; }
      const f = new FormData(form);
      const bewaard = A.bewaarSoort(a, { id: s.id, naam: f.get('naam'), vanaf: f.get('vanaf'), elke: f.get('elke'), wie: f.get('wie') || null });
      if (!bewaard) return false;
      bewaar(bewaard.naam + ' ' + A.ritmeTekst(bewaard));
      teken();
    });
  }

  function afvalKaartHtml() {
    const a = afval();
    const v = L.datumSleutel(vandaag());
    let html = '<section class="kaart afval-kaart"><div class="kaart-kop"><span class="icoon">' + ic('vuilbak') + '</span><h2>Afvalophaling</h2></div>';
    if (a.soorten.length) {
      html += '<ul class="afval-lijst">' + a.soorten.map(s => {
        const volgende = A.volgende(s, v);
        return '<li><button data-actie="afval-soort" data-id="' + e(s.id) + '"><strong>' + e(s.naam) + '</strong>' +
          '<span class="klein-grijs">' + e(A.ritmeTekst(s)) + (volgende ? ' · volgende: ' + e(L.datumKort(L.vanSleutel(volgende))) : '') +
          '</span></button></li>';
      }).join('') + '</ul>';
    }
    html += '<button class="knop secundair" data-actie="afval-soort">' + ic('plus') + 'Afvalsoort toevoegen</button>';
    const ag = window.Sync && window.Sync.gebruiker() && staat.agenda && staat.agenda.ingesteld && Array.isArray(staat.agenda.agendas)
      ? staat.agenda.agendas : [];
    if (ag.length) {
      html += '<p class="veld-label">Afvalkalender uit een gekoppelde agenda</p>' + ag.map((x, i) =>
        '<label class="vinkje"><input type="checkbox" data-instelling="afval-agenda" data-nr="' + e(x.nr) + '"' +
        (a.agendas.includes(String(x.nr)) ? ' checked' : '') + '> Agenda ' + (i + 1) + ' · ' + e(x.bron || '') + '</label>').join('');
    }
    html += '<p class="uitleg">De avond voor elke ophaling verschijnt een todo, bv. "PMD buitenzetten". De ophaaldagen vind je in de Recycle!-app. ' +
      'Verschuift een ophaling door een feestdag? Tik op de todo en kies een andere dag.' +
      (window.Sync && window.Sync.gebruiker()
        ? ' Heeft je gemeente een ophaalkalender als agenda-link (iCal)? Koppel die bij Agenda\'s en vink hem hier aan: dan komen de ophalingen er vanzelf in, ook verschuivingen.'
        : '') + '</p>';
    return html + '</section>';
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

  const ic = (naam, klasse) => window.Icoon(naam, klasse);
  const initiaal = naam => e(String(naam || '?').trim().charAt(0).toUpperCase());

  function persoon(id, leegTekst) {
    const lid = L.lid(staat.data, id);
    if (!lid) return '<span class="persoon leeg">' + e(leegTekst || 'Nog niemand') + '</span>';
    return '<span class="persoon" style="--kleur:' + e(lid.kleur) + '"><i>' + initiaal(lid.naam) + '</i>' + e(lid.naam) + '</span>';
  }

  function personen(ids) {
    const lijst = (ids || []).map(id => L.lid(staat.data, id)).filter(Boolean);
    if (!lijst.length) return '';
    return lijst.map(l => '<span class="persoon klein" style="--kleur:' + e(l.kleur) + '"><i>' + initiaal(l.naam) + '</i>' + e(l.naam) + '</span>').join('');
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
      const vak = staat.data.vakanties !== false && L.vakantieOp(staat.datum);
      sub.textContent = L.datumLang(staat.datum) + (vak ? ' · ' + vak : '');
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
    } else if (staat.scherm === 'todo') {
      const open = (staat.data.todos || []).filter(t => !t.klaar).length;
      titel.textContent = "Todo's";
      sub.textContent = open === 0 ? 'Alles gedaan' : open === 1 ? '1 nog te doen' : open + ' nog te doen';
      pijlen.forEach(p => { p.hidden = true; });
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
    else if (staat.scherm === 'week' && staat.weekModus !== 'standaard') staat.weekStart = L.plusDagen(staat.weekStart, 7 * richting);
    teken();
  }

  function teken() {
    tekenKop();
    if (staat.scherm === 'dag') tekenDag();
    else if (staat.scherm === 'week') tekenWeek();
    else if (staat.scherm === 'todo') tekenTodos();
    else tekenGezin();
  }

  // ---------- Dagoverzicht ----------

  function tekenDag() {
    const plan = L.dagPlan(staat.data, staat.datum);
    const isVandaag = L.zelfdeDag(staat.datum, vandaag());
    let html = '';

    if (!isVandaag) {
      html += '<button class="naar-vandaag" data-actie="naar-vandaag">' + ic('terugdraaien') + 'Terug naar vandaag</button>';
    }
    // Achterstallige todo's (alleen vandaag) helemaal bovenaan
    const todos = L.todosVoorDag(metAfval(staat.datum, staat.datum), staat.datum, vandaag());
    const telaat = todos.filter(t => t.telaat);
    if (telaat.length) {
      html += '<section class="kaart lijst dag-todos todo-telaat"><ul class="todos">' + telaat.map(t => todoRij(t, false)).join('') + '</ul></section>';
    }
    // Thuis of op kantoor: niet in het weekend
    if (L.weekdagIndex(staat.datum) < 5) html += werkBalkHtml(plan);
    html += nieuwKaartHtml();

    if (plan.school) {
      html += '<section class="kaart school-kaart">' +
        schoolRij('brengen', ic('rugzak'), 'Brengen', plan.brengen) +
        schoolRij('halen', ic('school'), 'Ophalen', plan.halen) +
        '</section>';
    }

    // Activiteiten (zonder kop; de + staat rechtsboven in de kaart)
    html += '<section class="kaart lijst acts-kaart">' +
      '<button class="plus hoek" data-actie="nieuwe-activiteit" aria-label="Activiteit toevoegen">' + ic('plus') + '</button>';
    const acts = activiteitenMetAgenda(plan, staat.datum);
    if (!acts.length) {
      html += '<p class="leeg-tekst">Niets gepland. Tik op + om iets toe te voegen.</p>';
    } else {
      html += '<ul class="activiteiten">' + acts.map(a => a.uitAgenda
        ? '<li class="uit-agenda"><button data-actie="agenda-item" data-id="' + e(a.id) + '">' +
          '<span class="tijd">' + (a.heleDag ? '<span class="hele-dag">hele dag</span>' : e(a.tijd)) + '</span>' +
          '<span class="act-tekst"><strong>' + e(a.titel) + '</strong>' + personen(a.wie) +
          '<span class="agenda-label" title="Uit je agenda">' + ic('kalender', 'mini') + (a.plaats ? e(a.plaats) : '') + '</span></span></button></li>'
        : '<li><button data-actie="bewerk-activiteit" data-id="' + e(a.id) + '">' +
          '<span class="tijd">' + e(a.tijd || '–') + '</span>' +
          '<span class="act-tekst"><strong>' + e(a.titel) + '</strong>' + personen(a.wie) + '</span></button></li>'
      ).join('') + '</ul>';
    }
    if (plan.overgeslagen.length) {
      html += '<ul class="overgeslagen">' + plan.overgeslagen.map(a =>
        '<li><s>' + e(a.tijd) + ' ' + e(a.titel) + '</s> <button class="link" data-actie="herstel-activiteit" data-id="' +
        e(a.id) + '">terugzetten</button></li>').join('') + '</ul>';
    }
    html += '</section>';

    // Todo's: alleen als er voor deze dag zijn (toevoegen gaat via het tabblad Todo's)
    const opTijd = todos.filter(t => !t.telaat);
    if (opTijd.length) {
      html += '<section class="kaart lijst dag-todos"><ul class="todos">' + opTijd.map(t => todoRij(t, false)).join('') + '</ul></section>';
    }

    // Avondeten
    // Wie kookt: kleur van de persoon als achtergrond, zoals bij brengen en ophalen
    const kok = L.lid(staat.data, plan.eten.kok);
    html += '<button class="kaart eten' + (kok ? ' getint' : '') + '" data-actie="bewerk" data-veld="eten"' +
      (kok ? ' style="--kleur:' + e(kok.kleur) + '" title="Kookt: ' + e(kok.naam) + '"' : '') +
      ' aria-label="Avondeten: ' + e(plan.eten.wat || 'nog niet beslist') + (kok ? ', kookt: ' + e(kok.naam) : '') + '">' +
      '<div class="kaart-kop"><span class="icoon">' + ic('bestek') + '</span><h2>Avondeten</h2></div>' +
      '<p class="groot">' + (plan.eten.wat ? e(plan.eten.wat) : '<span class="leeg-tekst">Nog niet beslist</span>') + '</p>' +
      '</button>';

    html += plan.school
      ? '<button class="link midden" data-actie="bewerk" data-veld="school">Geen school vandaag? (vakantie, vrije dag)</button>'
      : plan.aangepast.school || plan.vakantie ? '<button class="link midden" data-actie="bewerk" data-veld="school">Toch school op deze dag?</button>' : '';

    inhoud.innerHTML = html;
  }

  const WERK_TEKST = { thuis: 'Thuis', kantoor: 'Op kantoor', vrij: 'Vrij' };
  const WERK_ICOON = { thuis: 'huis', kantoor: 'kantoor', vrij: 'zon' };

  function ouders() {
    return staat.data.leden.filter(l => l.rol === 'ouder');
  }

  /** Bovenaan: waar werkt elke ouder vandaag? */
  function werkBalkHtml(plan) {
    const lijst = ouders();
    if (!lijst.length) return '';
    return '<div class="werkbalk" style="--aantal:' + lijst.length + '">' + lijst.map(l => {
      const w = plan.werk[l.id];
      return '<button class="kaart werk getint' + (w ? ' werk-' + w : ' werk-leeg') + '" data-actie="bewerk-werk" data-id="' + e(l.id) +
        '" style="--kleur:' + e(l.kleur) + '" aria-label="' + e(l.naam) + ': ' + e(w ? WERK_TEKST[w] : 'niet ingevuld') + '" title="' + e(l.naam) + '">' +
        '<span class="werk-plek">' + (w ? ic(WERK_ICOON[w]) + WERK_TEKST[w] : 'Niet ingevuld') + '</span>' +
        '</button>';
    }).join('') + '</div>';
  }

  /** Brengen of ophalen als één compacte regel. */
  function schoolRij(veld, icoon, label, deel) {
    const lid = L.lid(staat.data, deel.wie);
    return '<button class="school-rij' + (lid ? ' getint' : ' leeg') + '" data-actie="bewerk" data-veld="' + veld + '"' +
      (lid ? ' style="--kleur:' + e(lid.kleur) + '" title="' + e(lid.naam) + '"' : '') +
      ' aria-label="' + label + (deel.tijd ? ' om ' + e(deel.tijd) : '') + ': ' + (lid ? e(lid.naam) : 'nog niemand') + '">' +
      '<span class="school-ic">' + icoon + '</span>' +
      '<span class="school-label">' + label + '</span>' +
      '<span class="school-tijd">' + e(deel.tijd || '') + '</span>' +
      (lid ? '' : '<span class="school-wie">Nog niemand</span>') +
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
      html += '<li><button class="weekdag' + (isVandaag ? ' vandaag' : '') + '" data-actie="open-dag" data-datum="' + L.datumSleutel(datum) + '">' +
        '<span class="wd-datum"><strong>' + L.DAGEN_KORT[i] + '</strong>' + datum.getDate() + '</span>' +
        '<span class="wd-info">';
      if (plan.vakantie) html += '<span class="wd-regel klein-grijs">' + ic('zon', 'mini') + e(plan.vakantie) + '</span>';
      if (plan.school) {
        html += '<span class="wd-regel">' + ic('rugzak', 'mini') + persoon(plan.brengen.wie, '?') + ic('school', 'mini') + persoon(plan.halen.wie, '?') + '</span>';
      }
      const acts = activiteitenMetAgenda(plan, datum);
      if (acts.length) {
        html += '<span class="wd-regel klein-grijs">' + ic('activiteit', 'mini') + acts.map(a => e(a.titel)).join(', ') + '</span>';
      }
      const todos = L.todosVoorDag(metAfval(datum, datum), datum, null);
      if (todos.length) {
        html += '<span class="wd-regel klein-grijs">' + ic('vinkje', 'mini') + todos.map(t => e(t.titel)).join(', ') + '</span>';
      }
      html += '<span class="wd-regel klein-grijs">' + ic('bestek', 'mini') + (plan.eten.wat ? e(plan.eten.wat) : '–') + '</span>';
      html += '</span></button></li>';
    }
    html += '</ul><p class="uitleg">Tik op een dag om hem te bekijken of aan te passen.</p>';
    return html;
  }

  // ---------- Todo's ----------

  function deadlineTekst(sleutel) {
    if (!sleutel) return '';
    const datum = L.vanSleutel(sleutel);
    const verschil = Math.round((datum - vandaag()) / 864e5);
    if (verschil === 0) return 'vandaag';
    if (verschil === 1) return 'morgen';
    if (verschil === -1) return 'gisteren';
    return L.datumKort(datum);
  }

  /** Eén todo: vinkje om af te vinken, tekst om te bewerken. */
  function todoRij(t, metDatum) {
    const telaat = !t.klaar && t.deadline && t.deadline < L.datumSleutel(vandaag());
    const lid = L.lid(staat.data, t.wie);
    const meta = [];
    if (lid) meta.push('<span class="persoon klein" style="--kleur:' + e(lid.kleur) + '"><i>' + initiaal(lid.naam) + '</i>' + e(lid.naam) + '</span>');
    if (t.deadline && (metDatum || telaat)) {
      meta.push('<span class="todo-datum' + (telaat ? ' telaat' : '') + '">' + ic('klok', 'mini') + e(deadlineTekst(t.deadline)) + '</span>');
    }
    if (telaat) meta.push('<span class="badge gevaar">te laat</span>');
    return '<li class="todo' + (t.klaar ? ' klaar' : '') + '">' +
      '<label class="todo-vink"><input type="checkbox" data-todo="' + e(t.id) + '"' + (t.klaar ? ' checked' : '') +
      ' aria-label="' + e(t.titel) + ' afvinken"><span class="vak">' + ic('vink') + '</span></label>' +
      '<button class="todo-tekst" data-actie="bewerk-todo" data-id="' + e(t.id) + '">' +
      '<span class="todo-titel">' + e(t.titel) + '</span>' +
      (meta.length ? '<span class="todo-meta">' + meta.join('') + '</span>' : '') +
      '</button></li>';
  }

  function tekenTodos() {
    const d = staat.data;
    if (staat.todoFilter && !L.lid(d, staat.todoFilter)) staat.todoFilter = '';
    const filter = staat.todoFilter;
    // Afval-todo's: alleen de komende week en niet afgevinkt (die verdwijnen vanzelf).
    const alle = metAfval(vandaag(), L.plusDagen(vandaag(), 7)).todos.filter(t => !(t.afval && t.klaar));
    const gefilterd = Object.assign({}, d, { todos: alle.filter(t => !filter || t.wie === filter) });
    const g = L.todoGroepen(gefilterd, vandaag());

    let html = '<button class="knop breed-knop" data-actie="nieuwe-todo">' + ic('plus') + 'Todo toevoegen</button>';
    html += '<div class="filter" role="group" aria-label="Toon todo\'s van">' +
      '<button data-actie="todo-filter" data-wie="" class="chip' + (!filter ? ' gekozen' : '') + '">Iedereen</button>' +
      d.leden.map(l => '<button data-actie="todo-filter" data-wie="' + e(l.id) + '" class="chip' + (filter === l.id ? ' gekozen' : '') +
        '" style="--kleur:' + e(l.kleur) + '"><span class="persoon klein"><i>' + initiaal(l.naam) + '</i>' + e(l.naam) + '</span></button>').join('') +
      '</div>';

    const groep = (titel, lijst, klasse) => lijst.length
      ? '<section class="kaart lijst' + (klasse ? ' ' + klasse : '') + '"><div class="kaart-kop"><h2>' + titel +
        ' <span class="aantal">' + lijst.length + '</span></h2></div><ul class="todos">' +
        lijst.map(t => todoRij(t, true)).join('') + '</ul></section>'
      : '';
    html += groep('Te laat', g.telaat, 'todo-telaat') + groep('Vandaag', g.vandaag) + groep('Nog deze week', g.week) +
      groep('Later', g.later) + groep('Zonder deadline', g.geenDatum);

    const open = g.telaat.length + g.vandaag.length + g.week.length + g.later.length + g.geenDatum.length;
    if (!open) {
      html += '<div class="kaart leeg-kaart"><span class="icoon">' + ic('vinkje') + '</span><p>' +
        (g.klaar.length ? 'Alles is afgevinkt. Goed bezig!' : 'Nog geen todo\'s. Voeg er een toe met een deadline en wie het doet.') + '</p></div>';
    }
    if (g.klaar.length) {
      html += '<details class="kaart lijst afgevinkt"><summary>Afgevinkt <span class="aantal">' + g.klaar.length + '</span></summary>' +
        '<ul class="todos">' + g.klaar.map(t => todoRij(t, true)).join('') + '</ul>' +
        '<button class="link gevaar" data-actie="wis-afgevinkt">Afgevinkte todo\'s verwijderen</button></details>';
    }
    inhoud.innerHTML = html;
  }

  function bewerkTodo(todo, deadline) {
    const nieuw = !todo;
    const t = todo || { titel: '', deadline: deadline || L.datumSleutel(vandaag()), wie: (staat.scherm === 'todo' && staat.todoFilter) || null };
    let html = '<h2>' + ic('vinkje') + (nieuw ? 'Nieuwe todo' : 'Todo') + '</h2>' +
      '<label class="veld">Wat moet er gebeuren?<input type="text" name="titel" required value="' + e(t.titel) +
      '" placeholder="bv. Turnzak wassen, formulier invullen" autocomplete="off"></label>' +
      '<label class="veld">Deadline<input type="date" name="deadline" value="' + e(t.deadline || '') + '"></label>' +
      '<p class="veld-label">Wie?</p>' + persoonChips('wie', t.wie, false, true);
    if (!nieuw) {
      html += '<label class="vinkje todo-klaar"><input type="checkbox" name="klaar"' + (t.klaar ? ' checked' : '') + '> Afgevinkt</label>';
    }
    html += bladKnoppen(nieuw ? '' : '<button type="button" class="link gevaar" data-blad="wis">Verwijderen</button>');

    openBlad(html, (form, knop) => {
      if (knop === 'wis') {
        L.verwijderTodo(staat.data, t.id);
        bewaar('Todo verwijderd');
        return;
      }
      const f = new FormData(form);
      const titel = (f.get('titel') || '').trim();
      if (!titel) return false;
      L.bewaarTodo(staat.data, {
        id: t.id, titel: titel, deadline: f.get('deadline') || null, wie: f.get('wie') || null,
        klaar: nieuw ? false : f.get('klaar') === 'on'
      });
      bewaar(nieuw ? 'Todo toegevoegd' : 'Todo opgeslagen');
    });
  }

  function vinkTodo(id, klaar) {
    if (A.isAfvalId(id)) {
      const a = afval();
      A.zetKlaar(a, id, klaar);
      A.ruimOp(a, L.datumSleutel(vandaag()));
      bewaar(klaar ? 'Afgevinkt' : 'Weer open');
      setTimeout(teken, klaar ? 350 : 0);
      return;
    }
    const t = L.zetTodoKlaar(staat.data, id, klaar);
    if (!t) return;
    bewaar(klaar ? 'Afgevinkt: ' + t.titel : 'Weer open: ' + t.titel);
    // even laten zien dat het vinkje gezet is, dan pas hertekenen
    setTimeout(teken, klaar ? 350 : 0);
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
          '<label>Brengen' + persoonKeuze('brengen.wie', dag.brengen.wie) + '</label>' +
          '<label>om<input type="time" name="brengen.tijd" value="' + e(dag.brengen.tijd) + '"></label>' +
          '<label>Ophalen' + persoonKeuze('halen.wie', dag.halen.wie) + '</label>' +
          '<label>om<input type="time" name="halen.tijd" value="' + e(dag.halen.tijd) + '"></label>' +
          '</div>';
      }
      if (ouders().length) {
        html += '<div class="sw-raster">' + ouders().map(l =>
          '<label>' + e(l.naam) + ' werkt<select name="werk.' + e(l.id) + '">' +
          '<option value="">–</option>' +
          L.WERKPLEKKEN.map(w => '<option value="' + w + '"' + (dag.werk[l.id] === w ? ' selected' : '') + '>' + WERK_TEKST[w] + '</option>').join('') +
          '</select></label>').join('') + '</div>';
      }
      html += '<div class="sw-raster">' +
        '<button type="button" class="eten-knop breed" data-actie="bewerk-std-eten" data-weekdag="' + i + '">' +
        '<span class="klein-grijs">' + ic('bestek', 'mini') + 'Avondeten</span>' +
        '<span class="eten-wat">' + (dag.eten.wat ? e(dag.eten.wat) : '<span class="leeg-tekst">Kies een gerecht</span>') + '</span>' +
        (dag.eten.kok ? '<span class="klein-grijs">Kookt: ' + persoon(dag.eten.kok) + '</span>' : '') +
        '</button>' +
        '</div>';
      html += '<div class="sw-acts">' + dag.activiteiten.map(a =>
        '<button class="chip" data-actie="bewerk-vaste-activiteit" data-weekdag="' + i + '" data-id="' + e(a.id) + '">' +
        e(a.tijd) + ' ' + e(a.titel) + (a.tot ? ' <span class="klein-grijs">t/m ' + e(L.datumKort(L.vanSleutel(a.tot))) + '</span>' : '') +
        '</button>').join('') +
        '<button class="chip plus-chip" data-actie="nieuwe-vaste-activiteit" data-weekdag="' + i + '">' + ic('plus', 'mini') + 'Vaste activiteit</button></div>';
      html += '</section>';
    }
    html += '</div>';
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
    if (veld === 'werk') {
      L.zetWerk(staat.data, datumVoorWeekdag(i), sub, doel.value, 'week');
      bewaar('Opgeslagen voor elke ' + L.DAGEN[i]);
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
    let html = '<section class="kaart"><div class="kaart-kop"><span class="icoon">' + ic('gezin') + '</span><h2>Gezinsleden</h2></div>' +
      '<ul class="leden">' + staat.data.leden.map(l =>
        '<li data-lid="' + e(l.id) + '">' +
        '<input type="color" name="kleur" value="' + e(l.kleur) + '" aria-label="Kleur">' +
        '<input type="text" name="naam" value="' + e(l.naam) + '" aria-label="Naam">' +
        '<select name="rol" aria-label="Rol">' +
        ['ouder', 'kind', 'andere'].map(r => '<option value="' + r + '"' + (l.rol === r ? ' selected' : '') + '>' + r + '</option>').join('') +
        '</select>' +
        '<button class="wis" data-actie="wis-lid" data-id="' + e(l.id) + '" aria-label="Verwijder ' + e(l.naam) + '">' + ic('vuilbak') + '</button>' +
        '</li>').join('') + '</ul>' +
      '<button class="knop secundair" data-actie="nieuw-lid">' + ic('plus') + 'Persoon toevoegen</button>' +
      '<p class="uitleg">Voeg ook grootouders, de oppas of de naschoolse opvang toe als zij soms brengen of halen.</p></section>';

    html += '<section class="kaart"><div class="kaart-kop"><span class="icoon">' + ic('bestek') + '</span><h2>Gerechten</h2></div>' +
      '<p class="uitleg">Hieruit kies je bij het avondeten. Een nieuw gerecht dat je daar typt, komt er vanzelf bij.</p>' +
      '<div class="chips gerechtenbeheer">' + L.gerechtenLijst(staat.data).map(g =>
        '<span class="chip">' + e(g) + '<button class="chip-wis" data-actie="wis-gerecht" data-gerecht="' + e(g) +
        '" aria-label="' + e(g) + ' verwijderen">×</button></span>').join('') + '</div>' +
      '<form id="gerecht-toevoegen" class="rij-toevoegen"><input type="text" name="gerecht" placeholder="Nieuw gerecht" autocomplete="off" aria-label="Nieuw gerecht">' +
      '<button class="knop secundair" type="submit">Toevoegen</button></form></section>';

    html += '<section class="kaart"><div class="kaart-kop"><span class="icoon">' + ic('zon') + '</span><h2>Schoolvakanties</h2></div>' +
      '<label class="vinkje"><input type="checkbox" name="vakanties" data-instelling="vakanties"' + (staat.data.vakanties !== false ? ' checked' : '') + '> ' +
      'Vlaamse schoolvakanties en vrije dagen automatisch</label>' +
      '<p class="uitleg">Op die dagen valt brengen en ophalen vanzelf weg. Een pedagogische studiedag of andere vrije dag van jullie school zet je zelf via "Geen school vandaag?" onderaan de dag.</p></section>';

    html += afvalKaartHtml();

    html += deelKaartHtml();
    if (window.Sync && window.Sync.gebruiker()) html += meldingKaartHtml() + agendaKaartHtml() + siriKaartHtml();

    html += '<section class="kaart"><div class="kaart-kop"><span class="icoon">' + ic('opslag') + '</span><h2>Gegevens</h2></div>' +
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
    let html = '<section class="kaart deelkaart"><div class="kaart-kop"><span class="icoon">' + ic('link') + '</span><h2>Samen delen</h2></div>';
    if (!S.config()) {
      html += '<p class="uitleg">Deel de planning live met je partner via een gratis Supabase-project. ' +
        'Volg eerst het <a href="' + STAPPENPLAN + '" target="_blank" rel="noopener">stappenplan</a>, vul dan hieronder de twee gegevens in. ' +
        'Kreeg je een koppel-link? Open die, of plak hem hieronder (nodig in de app op je beginscherm).</p>' +
        '<form id="deel-plak" class="deel-form">' +
        '<label class="veld">Koppel-link plakken<input type="text" name="link" required placeholder="https://…#koppel=…" autocomplete="off" spellcheck="false"></label>' +
        '<button class="knop" type="submit">Koppelen</button></form>' +
        '<details class="handmatig"><summary>Of vul de Supabase-gegevens zelf in</summary>' +
        '<form id="deel-config" class="deel-form">' +
        '<label class="veld">Project-URL<input type="url" name="url" required placeholder="https://xxxx.supabase.co" autocomplete="off"></label>' +
        '<label class="veld">Publieke sleutel (anon / publishable)<input type="text" name="sleutel" required autocomplete="off" spellcheck="false"></label>' +
        '<button class="knop" type="submit">Verder</button></form></details>';
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
        '<p class="uitleg">Stuur die link naar je partner, of plak hem in de app op je beginscherm (die heeft op iPhone een eigen geheugen). Daarna log je in met je eigen e-mailadres.</p>' +
        (('setAppBadge' in navigator) && window.Notification && Notification.permission === 'default'
          ? '<p class="uitleg">Wil je een getal op het app-icoon als er iets gewijzigd is? Dat moet je toestel eerst toelaten.</p>' +
            '<div class="knoppen"><button class="knop secundair" data-actie="badge-toestaan">Teller op app-icoon toestaan</button></div>'
          : '') +
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
      if (form.id === 'deel-plak') {
        if (!S.koppelVanTekst(f.get('link'))) throw new Error('Dat is geen geldige koppel-link');
        meld('Gekoppeld. Log nu in met je eigen e-mailadres.');
      } else if (form.id === 'deel-config') {
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

  const AGENDA_UITLEG = 'https://github.com/krisfranckx/weekplanning/blob/main/AGENDA.md';

  function tijdstip(ms) {
    if (!ms) return 'nog niet';
    const d = new Date(ms);
    const uur = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return L.zelfdeDag(d, vandaag()) ? 'vandaag om ' + uur : L.datumKort(d) + ' om ' + uur;
  }

  function agendaKaartHtml() {
    const a = staat.agenda || {};
    const agendas = a.ingesteld && Array.isArray(a.agendas) ? a.agendas : [];
    let html = '<section class="kaart agenda-kaart"><div class="kaart-kop"><span class="icoon">' + ic('kalender') + '</span><h2>Agenda\'s (WeekCal)</h2></div>';
    const fout = a.fout ? '<p class="foutmelding">' + e(a.fout) + '</p>' : '';
    if (agendas.length) {
      html += '<ul class="agenda-lijst">' + agendas.map((ag, i) =>
        '<li><span class="agenda-naam">' + ic('kalender', 'mini') + '<span><strong>Agenda ' + (i + 1) + '</strong> · ' + e(ag.bron || '') +
        '<span class="klein-grijs">Laatst opgehaald: ' + e(tijdstip(ag.opgehaald)) + '</span>' +
        (ag.fout ? '<span class="foutmelding">' + e(ag.fout) + '</span>' : '') + '</span></span>' +
        '<button class="link gevaar" data-actie="agenda-ontkoppel" data-nr="' + e(ag.nr) + '">Ontkoppelen</button></li>').join('') + '</ul>' + fout +
        '<p class="uitleg">De afspraken staan bij de activiteiten, met een agenda-icoon. Tik op een afspraak om te kiezen voor wie ze is, ' +
        'voor die ene keer of voor elke keer. Staat een naam uit het gezin in de titel (bv. "Voetbal Pablo"), dan kiest de app die vanzelf. ' +
        'Ook titel en uur kan je daar aanpassen, alleen in de weekplanning. De app haalt de agenda\'s om het kwartier op.</p>';
      if (!staat.agendaWijzig) {
        return html + '<div class="knoppen"><button class="knop secundair" data-actie="agenda-vernieuw"' + (staat.agendaBezig ? ' disabled' : '') + '>' +
          (staat.agendaBezig ? 'Even geduld…' : 'Nu vernieuwen') + '</button>' +
          (agendas.length < 5 ? '<button class="knop secundair" data-actie="agenda-wijzig">' + ic('plus') + 'Agenda toevoegen</button>' : '') +
          '</div></section>';
      }
    } else {
      html += '<p class="uitleg">Laat afspraken uit WeekCal hier verschijnen als activiteit. Deel daarvoor een agenda ' +
        '(bv. een aparte agenda <em>Gezin</em>) met een link, en plak die link hieronder. Dat doe je één keer: ' +
        'de link geldt voor het hele gezin. Daarna kan je er nog agenda\'s bij zetten.</p>' + fout;
    }
    html += '<form id="agenda-link" class="deel-form">' +
      '<label class="veld">' + (agendas.length ? 'Link van de extra agenda' : 'Agenda-link') +
      '<input type="text" name="url" required placeholder="webcal://… of https://….ics" autocomplete="off" spellcheck="false" inputmode="url"></label>' +
      '<div class="knoppen"><button class="knop" type="submit">Koppelen</button>' +
      (staat.agendaWijzig ? '<button class="knop secundair" type="button" data-actie="agenda-annuleer">Annuleren</button>' : '') + '</div></form>' +
      '<details class="handmatig"><summary>Zo vind je de link (iPhone / iCloud)</summary>' +
      '<ol class="siri-stappen">' +
      '<li>Open de app <strong>Agenda</strong> op je iPhone en tik onderaan op <strong>Agenda\'s</strong>.</li>' +
      '<li>Tik op <strong>ⓘ</strong> naast de agenda die je wil tonen (een iCloud-agenda, bv. <em>Gezin</em>).</li>' +
      '<li>Zet <strong>Openbare agenda</strong> aan en tik op <strong>Deel link…</strong> > <strong>Kopieer</strong>.</li>' +
      '<li>Plak de link hierboven en tik op <strong>Koppelen</strong>.</li>' +
      '</ol>' +
      '<p class="uitleg">WeekCal toont dezelfde agenda\'s als de app Agenda, dus alles wat je in WeekCal in die agenda zet, komt hier ook. ' +
      'Iedereen met de link kan de agenda lezen: deel hem niet verder. Google Agenda? Gebruik het <em>geheime adres in iCal-indeling</em>. ' +
      'Meer uitleg in <a href="' + AGENDA_UITLEG + '" target="_blank" rel="noopener">AGENDA.md</a>.</p></details>';
    return html + '</section>';
  }

  async function koppelAgenda(form) {
    const knoppen = form.querySelectorAll('button');
    knoppen.forEach(k => { k.disabled = true; });
    try {
      await window.Sync.rpc('voeg_agenda_toe', { url: new FormData(form).get('url') });
      staat.agendaWijzig = false;
      await vernieuwAgenda(true);
    } catch (fout) {
      meld((fout && fout.message) || 'Er ging iets mis');
      knoppen.forEach(k => { k.disabled = false; });
    }
  }

  async function ontkoppelAgenda(nr) {
    try {
      await window.Sync.rpc('verwijder_agenda', { nr: Number(nr) });
      const a = staat.agenda || {};
      const rest = (a.agendas || []).filter(x => String(x.nr) !== String(nr));
      bewaarAgenda(Object.assign({}, a, { agendas: rest, ingesteld: rest.length > 0 }));
      meld('Agenda ontkoppeld');
    } catch (fout) {
      meld((fout && fout.message) || 'Er ging iets mis');
    }
    teken();
  }

  // ---------- Pushmeldingen (ochtendmelding en todo-herinnering) ----------

  const MELDING_SLEUTEL = 'weekplanning.meldingen';
  const MELDINGEN_UITLEG = 'https://github.com/krisfranckx/weekplanning/blob/main/MELDINGEN.md';
  const MELDING_STANDAARD = { aan: false, lid: '', ochtend: true, ochtendTijd: '07:00', zonderSchool: false, todos: true, todoTijd: '19:00' };

  function meldingInstellingen() {
    try { return Object.assign({}, MELDING_STANDAARD, JSON.parse(localStorage.getItem(MELDING_SLEUTEL)) || {}); } catch (e) { return Object.assign({}, MELDING_STANDAARD); }
  }
  function zetMeldingInstellingen(w) {
    const nieuw = Object.assign(meldingInstellingen(), w);
    try { localStorage.setItem(MELDING_SLEUTEL, JSON.stringify(nieuw)); } catch (e) { /* geen opslag */ }
    return nieuw;
  }

  const pushKan = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function meldingKaartHtml() {
    const m = meldingInstellingen();
    const st = staat.melding || {};
    let html = '<section class="kaart meldingen"><div class="kaart-kop"><span class="icoon">' + ic('bel') + '</span><h2>Meldingen</h2></div>';
    if (!pushKan()) {
      html += '<p class="uitleg">' + (isIos()
        ? 'Op iPhone werken meldingen alleen in de app op je beginscherm (iOS 16.4 of nieuwer). Tik in Safari op <strong>Deel</strong> en dan <strong>Zet op beginscherm</strong>, open de app van daaruit en kom hier terug.'
        : 'Deze browser kan geen pushmeldingen ontvangen.') + '</p>';
      return html + '</section>';
    }
    const gekozenLid = L.lid(staat.data, m.lid) ? m.lid : '';
    html += '<p class="uitleg">Meldingen gelden voor dit toestel. Je partner zet ze op de eigen gsm apart aan, met eigen tijden.</p>' +
      '<label class="veld">Ik ben' + persoonKeuze('lid', gekozenLid, 'Kies wie je bent').replace('<select ', '<select data-melding="lid" ') + '</label>' +
      '<label class="vinkje"><input type="checkbox" data-melding="ochtend"' + (m.ochtend ? ' checked' : '') + '> Ochtendmelding: wie brengt, ophaalt en kookt</label>' +
      '<div class="melding-sub"><label>om <input type="time" data-melding="ochtendTijd" value="' + e(m.ochtendTijd) + '"></label>' +
      '<label class="vinkje"><input type="checkbox" data-melding="zonderSchool"' + (m.zonderSchool ? ' checked' : '') + '> ook op dagen zonder school</label></div>' +
      '<label class="vinkje"><input type="checkbox" data-melding="todos"' + (m.todos ? ' checked' : '') + '> Herinnering de avond vóór de deadline van een todo</label>' +
      '<div class="melding-sub"><label>om <input type="time" data-melding="todoTijd" value="' + e(m.todoTijd) + '"></label>' +
      '<span class="klein-grijs">' + (gekozenLid ? 'jouw todo\'s en die van niemand in het bijzonder' : 'alle todo\'s') + '</span></div>' +
      (st.fout ? '<p class="foutmelding">' + e(st.fout) + '</p>' : '');
    if (m.aan && Notification.permission === 'granted') {
      html += '<p class="deel-status" data-soort="ok">Meldingen staan aan op dit toestel</p>' +
        '<div class="knoppen"><button class="knop secundair" data-actie="melding-test"' + (st.bezig ? ' disabled' : '') + '>' + (st.bezig ? 'Even geduld…' : 'Testmelding sturen') + '</button></div>' +
        '<button class="link gevaar" data-actie="melding-uit">Meldingen uitzetten op dit toestel</button>';
    } else if (Notification.permission === 'denied') {
      html += '<p class="foutmelding">Meldingen zijn geblokkeerd voor deze app. Zet ze aan in de instellingen van je toestel (iPhone: Instellingen > Meldingen > Weekplanning).</p>';
    } else {
      html += '<div class="knoppen"><button class="knop" data-actie="melding-aan"' + (st.bezig ? ' disabled' : '') + '>' + ic('bel') + (st.bezig ? 'Even geduld…' : 'Meldingen aanzetten') + '</button></div>';
    }
    html += '<p class="uitleg">Eenmalig in Supabase instellen: zie <a href="' + MELDINGEN_UITLEG + '" target="_blank" rel="noopener">MELDINGEN.md</a>.</p>';
    return html + '</section>';
  }

  function vanB64url(tekst) {
    const s = atob(tekst.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((tekst.length + 3) % 4));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  function naarB64url(buffer) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Publieke VAPID-sleutel van het gezin; de eerste keer maakt dit toestel het sleutelpaar. */
  async function pushSleutel() {
    const c = window.Sync.config();
    const basis = { project_url: c.url, apikey: c.sleutel };
    let publiek = await window.Sync.rpc('push_sleutel', basis);
    if (publiek) return publiek;
    const paar = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const nieuw = naarB64url(await crypto.subtle.exportKey('raw', paar.publicKey));
    const prive = await crypto.subtle.exportKey('jwk', paar.privateKey);
    publiek = await window.Sync.rpc('push_sleutel', Object.assign({ nieuw_publiek: nieuw, nieuw_prive: prive }, basis));
    return publiek;
  }

  async function abonnement(maak) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!maak) return sub;
    const publiek = await pushSleutel();
    if (sub && sub.options && sub.options.applicationServerKey &&
        naarB64url(sub.options.applicationServerKey) !== publiek) {
      await sub.unsubscribe();
      sub = null;
    }
    return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vanB64url(publiek) });
  }

  async function bewaarMeldingen(sub) {
    const m = meldingInstellingen();
    await window.Sync.rpc('bewaar_push', {
      abonnement: sub.toJSON(),
      instellingen: { lid: L.lid(staat.data, m.lid) ? m.lid : '', ochtend: m.ochtend, ochtendTijd: m.ochtendTijd,
        zonderSchool: m.zonderSchool, todos: m.todos, todoTijd: m.todoTijd }
    });
  }

  async function meldingStap(werk, klaarTekst) {
    staat.melding = { bezig: true };
    teken();
    try {
      await werk();
      staat.melding = null;
      if (klaarTekst) meld(klaarTekst);
    } catch (fout) {
      staat.melding = { fout: (fout && fout.message) || String(fout) };
    }
    if (staat.scherm === 'gezin') teken();
  }

  function meldingenAan() {
    // Toestemming vragen moet meteen na de tik gebeuren (iPhone).
    const vraag = Notification.requestPermission();
    meldingStap(async () => {
      if (await vraag !== 'granted') throw new Error('Je toestel liet geen meldingen toe.');
      const sub = await abonnement(true);
      await bewaarMeldingen(sub);
      zetMeldingInstellingen({ aan: true });
    }, 'Meldingen staan aan');
  }

  function meldingenUit() {
    meldingStap(async () => {
      const sub = await abonnement(false);
      if (sub) {
        await window.Sync.rpc('wis_push', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      zetMeldingInstellingen({ aan: false });
    }, 'Meldingen staan uit');
  }

  function testMelding() {
    meldingStap(async () => {
      const sub = await abonnement(false);
      if (!sub) { zetMeldingInstellingen({ aan: false }); throw new Error('Dit toestel is niet ingeschreven. Zet de meldingen opnieuw aan.'); }
      await window.Sync.functie('meldingen', { soort: 'test', endpoint: sub.endpoint });
    }, 'Testmelding verstuurd');
  }

  function meldingWijziging(doel) {
    const veld = doel.dataset.melding;
    const m = zetMeldingInstellingen({ [veld]: doel.type === 'checkbox' ? doel.checked : doel.value });
    if (veld === 'lid') teken();
    if (!m.aan) return;
    abonnement(false)
      .then(sub => sub ? bewaarMeldingen(sub).then(() => meld('Opgeslagen')) : null)
      .catch(fout => { staat.melding = { fout: fout.message || String(fout) }; teken(); });
  }

  const SIRI_UITLEG = 'https://github.com/krisfranckx/weekplanning/blob/main/SIRI.md';

  function siriKaartHtml() {
    const st = staat.siri || {};
    let html = '<section class="kaart siri"><div class="kaart-kop"><span class="icoon">' + ic('micro') + '</span><h2>Todo\'s via Siri</h2></div>';
    if (!st.gegevens) {
      html += '<p class="uitleg">Zeg <strong>"Hé Siri, ik heb een nieuwe todo"</strong>. Siri vraagt dan wat er moet gebeuren, voor wie en tegen wanneer, ' +
        'en zet de todo meteen in de gedeelde planning. Dat werkt ook handsfree in de auto via CarPlay.</p>' +
        (st.fout ? '<p class="foutmelding">' + e(st.fout) + '</p>' : '') +
        '<div class="knoppen"><button class="knop secundair" data-actie="siri-start"' + (st.bezig ? ' disabled' : '') + '>' +
        ic('micro') + (st.bezig ? 'Even geduld…' : 'Siri-opdracht instellen') + '</button></div>';
      return html + '</section>';
    }
    const g = st.gegevens;
    const namen = staat.data.leden.map(l => l.naam).concat(['Niemand']);
    const waarde = (label, w, geheim) => '<div class="siri-waarde"><span class="klein-grijs">' + label + '</span>' +
      '<code>' + e(geheim ? w.slice(0, 6) + '…' + w.slice(-4) : w) + '</code>' +
      '<button class="knop secundair klein-knop" data-actie="kopieer" data-waarde="' + e(w) + '" data-label="' + e(label) + '">Kopieer</button></div>';
    html += '<p class="uitleg">Maak deze opdracht één keer in de app <strong>Opdrachten</strong> op je iPhone. ' +
      'Stap voor stap uitgelegd in <a href="' + SIRI_UITLEG + '" target="_blank" rel="noopener">SIRI.md</a>. ' +
      'Deze sleutel is persoonlijk en geheim: deel hem niet. Je partner maakt op de eigen gsm een eigen sleutel.</p>' +
      waarde('Adres', g.adres) + waarde('apikey', g.apikey, true) + waarde('Siri-sleutel', g.sleutel, true) +
      '<ol class="siri-stappen">' +
      '<li>Open <strong>Opdrachten</strong>, tik op <strong>+</strong> en noem de opdracht exact <strong>Ik heb een nieuwe todo</strong>. Die naam is wat je tegen Siri zegt.</li>' +
      '<li>Voeg <strong>Vraag om invoer</strong> toe: type <em>Tekst</em>, vraag <em>Wat moet er gebeuren?</em></li>' +
      '<li>Voeg <strong>Lijst</strong> toe met: ' + namen.map(n => '<em>' + e(n) + '</em>').join(', ') + '. ' +
      'Daaronder <strong>Kies uit lijst</strong> met als vraag <em>Voor wie?</em></li>' +
      '<li>Voeg nog eens <strong>Vraag om invoer</strong> toe: type <em>Datum</em>, vraag <em>Tegen wanneer?</em></li>' +
      '<li>Voeg <strong>Wijzig datumnotatie</strong> (Format Date) toe: notatie <em>ISO 8601</em>, tijd <em>uit</em>.</li>' +
      '<li>Voeg <strong>Haal inhoud op van URL</strong> toe. URL: het <em>Adres</em> hierboven. Methode <em>POST</em>. ' +
      'Header <em>apikey</em> = de <em>apikey</em> hierboven. Verzoek: <em>JSON</em> met vier tekstvelden: ' +
      '<em>sleutel</em> = de Siri-sleutel, <em>titel</em> = Gevraagde invoer (de eerste), <em>wie</em> = Gekozen onderdeel, ' +
      '<em>deadline</em> = Opgemaakte datum.</li>' +
      '<li>Voeg <strong>Toon resultaat</strong> toe met <em>Inhoud van URL</em>. Siri leest dan voor of het gelukt is.</li>' +
      '</ol>' +
      '<p class="uitleg">Klaar! Probeer: "Hé Siri, ik heb een nieuwe todo". Een nieuwe sleutel maken maakt de vorige ongeldig.</p>' +
      '<div class="knoppen"><button class="knop secundair" data-actie="siri-start">Nieuwe sleutel maken</button>' +
      '<button class="link" data-actie="siri-klaar">Verbergen</button></div>';
    return html + '</section>';
  }

  async function startSiri() {
    staat.siri = { bezig: true };
    teken();
    try {
      staat.siri = { gegevens: await window.Sync.siriGegevens() };
    } catch (fout) {
      staat.siri = { fout: (fout && fout.message) || String(fout) };
    }
    if (staat.scherm === 'gezin') teken();
  }

  async function kopieer(tekst, label) {
    try {
      await navigator.clipboard.writeText(tekst);
      meld(label + ' gekopieerd');
    } catch (fout) {
      prompt('Kopieer:', tekst);
    }
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
      (lijst.includes(l.id) ? ' checked' : '') + '><span><i>' + initiaal(l.naam) + '</i>' + e(l.naam) + '</span></label>').join('');
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

  /**
   * Een veld bewerken. Met `weekdag` (0-6) bewerk je de standaardweek: altijd "elke week".
   */
  function bewerkVeld(veld, weekdag) {
    const alleenWeek = typeof weekdag === 'number';
    const datum = alleenWeek ? datumVoorWeekdag(weekdag) : staat.datum;
    const plan = alleenWeek
      ? Object.assign(JSON.parse(JSON.stringify(staat.data.week[weekdag])), { aangepast: {} })
      : L.dagPlan(staat.data, datum);
    const aangepast = !!plan.aangepast[veld];
    const herstel = aangepast ? '<button type="button" class="link" data-blad="herstel">Terug naar standaardweek</button>' : '';
    let html;

    if (veld === 'brengen' || veld === 'halen') {
      const titel = veld === 'brengen' ? ic('rugzak') + 'Wie brengt naar school?' : ic('school') + 'Wie haalt op van school?';
      html = '<h2>' + titel + '</h2>' +
        persoonChips('wie', plan[veld].wie, false, true) +
        '<label class="veld">Tijd<input type="time" name="tijd" value="' + e(plan[veld].tijd) + '"></label>';
    } else if (veld === 'eten') {
      html = '<h2>' + ic('bestek') + 'Avondeten</h2>' +
        '<label class="veld">Wat eten we?<input type="text" name="wat" value="' + e(plan.eten.wat) + '" placeholder="Kies hieronder of typ een nieuw gerecht" autocomplete="off"></label>' +
        '<div class="gerecht-keuze" id="gerecht-keuze">' + gerechtChips('') + '</div>' +
        '<p class="veld-label">Wie kookt?</p>' + persoonChips('kok', plan.eten.kok, false, true);
    } else if (veld === 'school') {
      html = '<h2>' + ic('boek') + 'School</h2>' +
        '<div class="chips">' +
        '<label class="chip-keuze"><input type="radio" name="school" value="ja"' + (plan.school ? ' checked' : '') + '><span>Er is school</span></label>' +
        '<label class="chip-keuze"><input type="radio" name="school" value="nee"' + (!plan.school ? ' checked' : '') + '><span>Geen school</span></label>' +
        '</div>';
    }
    const vakantieDag = !alleenWeek && veld === 'school' && plan.vakantie;
    html += (alleenWeek
      ? '<input type="hidden" name="bereik" value="week"><p class="uitleg">Geldt voor elke ' + weekdagNaam(datum) + '.</p>'
      : vakantieDag
        ? '<input type="hidden" name="bereik" value="dag"><p class="uitleg">' + e(plan.vakantie) + ': normaal geen school. Dit geldt alleen voor ' + e(L.datumKort(datum)) + '.</p>'
        : bereikKeuze(datum, 'dag')) + (vakantieDag ? '' : herstel) + bladKnoppen();

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
      if (alleenWeek) staat.data.week[weekdag][veld] = waarde; // dagaanpassingen niet aanraken
      else L.zetVeld(staat.data, datum, veld, waarde, bereik);
      const nieuwGerecht = veld === 'eten' && L.voegGerechtToe(staat.data, waarde.wat);
      bewaar((bereik === 'week' ? 'Opgeslagen voor elke ' + weekdagNaam(datum) : 'Opgeslagen voor ' + L.datumKort(datum)) +
        (nieuwGerecht ? '. ' + waarde.wat + ' staat nu in de gerechtenlijst' : ''));
    });
  }

  function bewerkWerk(lidId) {
    const lid = L.lid(staat.data, lidId);
    if (!lid) return;
    const datum = staat.datum;
    const plan = L.dagPlan(staat.data, datum);
    const huidig = plan.werk[lidId] || '';
    const aangepast = (plan.aangepast.werk || []).includes(lidId);
    let html = '<h2>' + ic('huis') + 'Waar werkt ' + e(lid.naam) + '?</h2><div class="chips">' +
      L.WERKPLEKKEN.map(w => '<label class="chip-keuze"><input type="radio" name="werk" value="' + w + '"' + (huidig === w ? ' checked' : '') +
        '><span>' + ic(WERK_ICOON[w]) + WERK_TEKST[w] + '</span></label>').join('') +
      '<label class="chip-keuze"><input type="radio" name="werk" value=""' + (!huidig ? ' checked' : '') + '><span>Niet ingevuld</span></label>' +
      '</div>' + bereikKeuze(datum, 'dag') +
      (aangepast ? '<button type="button" class="link" data-blad="herstel">Terug naar standaardweek</button>' : '') +
      bladKnoppen();
    openBlad(html, (form, knop) => {
      if (knop === 'herstel') {
        L.herstelWerk(staat.data, datum, lidId);
        bewaar('Terug zoals in de standaardweek');
        return;
      }
      const f = new FormData(form);
      const bereik = f.get('bereik');
      L.zetWerk(staat.data, datum, lidId, f.get('werk'), bereik);
      bewaar(bereik === 'week' ? 'Opgeslagen voor elke ' + weekdagNaam(datum) : 'Opgeslagen voor ' + L.datumKort(datum));
    });
  }

  /**
   * Activiteit bewerken. `vastOnly` = bewerken vanuit de standaardweek (altijd "elke week").
   */
  function bewerkActiviteit(datum, activiteit, vastOnly) {
    const nieuw = !activiteit;
    const act = activiteit || { titel: '', tijd: '', wie: [] };
    const isVast = !nieuw && !act.eenmalig;
    let html = '<h2>' + ic('activiteit') + (nieuw ? 'Nieuwe activiteit' : 'Activiteit') + '</h2>' +
      '<label class="veld">Wat?<input type="text" name="titel" required value="' + e(act.titel) + '" placeholder="bv. Zwemles, verjaardagsfeest" autocomplete="off"></label>' +
      '<label class="veld">Hoe laat?<input type="time" name="tijd" value="' + e(act.tijd) + '"></label>' +
      '<p class="veld-label">Wie?</p>' + persoonChips('wie', act.wie, true, false);
    if (vastOnly) {
      html += '<p class="uitleg">Deze activiteit komt elke ' + weekdagNaam(datum) + ' terug.</p>';
    } else {
      html += bereikKeuze(datum, isVast ? 'week' : 'dag');
    }
    // Einddatum: alleen voor een activiteit die elke week terugkomt
    const toonTot = vastOnly || isVast;
    html += '<label class="veld tot-veld"' + (toonTot ? '' : ' hidden') + '>Tot en met (leeg = altijd)' +
      '<input type="date" name="tot" value="' + e(act.tot || '') + '" min="' + L.datumSleutel(datum) + '"></label>';
    let extra = '';
    if (!nieuw) {
      extra = isVast && !vastOnly
        ? '<span class="wis-vraag">Verwijderen:</span>' +
          '<button type="button" class="link gevaar" data-blad="sla-over">Alleen ' + L.datumKort(datum) + '</button>' +
          '<button type="button" class="link gevaar" data-blad="wis-volgende">Ook alle volgende</button>'
        : '<button type="button" class="link gevaar" data-blad="wis">Verwijderen</button>';
    }
    html += bladKnoppen(extra);

    openBlad(html, (form, knop) => {
      if (knop === 'sla-over') {
        L.verwijderActiviteit(staat.data, datum, act.id, 'dag');
        bewaar('Overgeslagen op ' + L.datumKort(datum));
        return;
      }
      if (knop === 'wis-volgende') {
        L.verwijderActiviteit(staat.data, datum, act.id, 'volgende');
        bewaar('Verwijderd vanaf ' + L.datumKort(datum));
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
      const tot = bereik === 'week' ? (f.get('tot') || '') : '';
      L.bewaarActiviteit(staat.data, datum, { id: act.id, titel: titel, tijd: f.get('tijd'), wie: f.getAll('wie'), tot: tot }, bereik);
      bewaar(bereik === 'week'
        ? 'Opgeslagen voor elke ' + weekdagNaam(datum) + (tot ? ' tot en met ' + L.datumKort(L.vanSleutel(tot)) : '')
        : 'Opgeslagen voor ' + L.datumKort(datum));
    });
  }

  bladForm.addEventListener('submit', ev => {
    ev.preventDefault();
    if (bladActie && bladActie(bladForm, 'ok') === false) return;
    sluitBlad();
    teken();
  });

  // Einddatum alleen tonen als de activiteit elke week terugkomt
  bladForm.addEventListener('change', ev => {
    if (ev.target.name !== 'bereik') return;
    const veld = bladForm.querySelector('.tot-veld');
    if (veld) veld.hidden = ev.target.value !== 'week';
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
      case 'bewerk-werk':
        bewerkWerk(knop.dataset.id);
        break;
      case 'bewerk-std-eten':
        bewerkVeld('eten', Number(knop.dataset.weekdag));
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
      case 'nieuwe-todo':
        bewerkTodo(null, knop.dataset.datum);
        break;
      case 'bewerk-todo': {
        if (A.isAfvalId(knop.dataset.id)) {
          const t = A.zoekTodo(afval(), knop.dataset.id, afvalUitAgenda());
          if (t) bewerkAfvalTodo(t);
          break;
        }
        const todo = (d.todos || []).find(t => t.id === knop.dataset.id);
        if (todo) bewerkTodo(todo);
        break;
      }
      case 'afval-soort':
        bewerkAfvalSoort(afval().soorten.find(s => s.id === knop.dataset.id) || null);
        break;
      case 'todo-filter':
        staat.todoFilter = knop.dataset.wie;
        teken();
        break;
      case 'wis-afgevinkt': {
        const aantal = (d.todos || []).filter(t => t.klaar).length;
        if (confirm(aantal + (aantal === 1 ? ' afgevinkte todo' : ' afgevinkte todo\'s') + ' verwijderen?')) {
          d.todos = d.todos.filter(t => !t.klaar);
          bewaar('Opgeruimd');
          teken();
        }
        break;
      }
      case 'melding-aan':
        meldingenAan();
        break;
      case 'melding-uit':
        meldingenUit();
        break;
      case 'melding-test':
        testMelding();
        break;
      case 'siri-start':
        startSiri();
        break;
      case 'agenda-item': {
        const item = agendaVoorDag(staat.datum).find(x => x.id === knop.dataset.id);
        if (item) bewerkAgendaWie(staat.datum, item);
        break;
      }
      case 'agenda-vernieuw':
        vernieuwAgenda(true);
        break;
      case 'agenda-wijzig':
        staat.agendaWijzig = true;
        teken();
        break;
      case 'agenda-annuleer':
        staat.agendaWijzig = false;
        teken();
        break;
      case 'agenda-ontkoppel':
        if (confirm('Deze agenda ontkoppelen? De afspraken eruit verdwijnen dan uit de app, voor het hele gezin.')) ontkoppelAgenda(knop.dataset.nr);
        break;
      case 'siri-klaar':
        staat.siri = null;
        teken();
        break;
      case 'kopieer':
        kopieer(knop.dataset.waarde, knop.dataset.label);
        break;
      case 'nieuw-gezien':
        zetNieuw([]);
        teken();
        break;
      case 'badge-toestaan':
        if (window.Notification) {
          Notification.requestPermission().then(() => { zetBadge(leesNieuw().length); teken(); });
        }
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
    if (ev.target.id === 'agenda-link') {
      koppelAgenda(ev.target);
      return;
    }
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
    if (doel.dataset && doel.dataset.todo) {
      vinkTodo(doel.dataset.todo, doel.checked);
      return;
    }
    if (doel.dataset && doel.dataset.melding) {
      meldingWijziging(doel);
      return;
    }
    if (doel.dataset && doel.dataset.instelling === 'vakanties') {
      staat.data.vakanties = doel.checked;
      bewaar(doel.checked ? 'Schoolvakanties staan aan' : 'Schoolvakanties staan uit');
      return;
    }
    if (doel.dataset && doel.dataset.instelling === 'afval-agenda') {
      A.zetAgenda(afval(), doel.dataset.nr, doel.checked);
      bewaar(doel.checked ? 'Afvalkalender: de ophalingen worden todo\'s' : 'Weer een gewone agenda');
      return;
    }
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
    if (!vegenStart || staat.scherm === 'gezin' || staat.scherm === 'todo' || (staat.scherm === 'week' && staat.weekModus === 'standaard')) return;
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
    vernieuwAgenda(false);
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

  zetBadge(leesNieuw().length);
  document.querySelectorAll('[data-icoon]').forEach(el => { el.innerHTML = ic(el.dataset.icoon); });
  teken();
})();
