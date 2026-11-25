/*
 * Weekplanning: pushmeldingen (Supabase Edge Function "meldingen").
 *
 * - Elke 5 minuten roept Supabase deze functie aan (pg_cron, zie supabase/opzet.sql deel 9).
 *   Ze kijkt per toestel of het tijd is voor de ochtendmelding of de todo-herinnering
 *   en stuurt die via Web Push. Elke melding gaat hoogstens één keer per dag.
 * - De app kan ook een testmelding vragen (knop bij Gezin > Meldingen).
 *
 * Plak dit hele bestand (het bevat alles, ook een kopie van js/logica.js) in Supabase > Edge Functions > Deploy a new function > Via editor,
 * met als naam "meldingen". Uitleg: MELDINGEN.md.
 * Gewone JavaScript (geen TypeScript-types), zodat het ook in Node getest kan worden.
 */
// De rekenregels van de app (dagplan, schoolvakanties, teksten van de meldingen).
// ===== BEGIN js/logica.js (niet hier aanpassen: npm run bouw-meldingen) =====
/*
 * Logica van de weekplanning: datums, standaardweek en aanpassingen per dag.
 * Bevat geen DOM-code, zodat het ook in Node getest kan worden.
 */
(function (root) {
  'use strict';

  const DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
  const DAGEN_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
  const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
    'augustus', 'september', 'oktober', 'november', 'december'];
  const MAANDEN_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const KLEUREN = ['#e4572e', '#2e86ab', '#7a9e3a', '#a14ebf', '#f0a202', '#17a398', '#d35d8f', '#6c757d'];
  const VERSIE = 1;

  /* Velden die je per dag kan overschrijven. Activiteiten werken anders (zie onder). */
  const DAGVELDEN = ['school', 'brengen', 'halen', 'eten'];

  // ---------- Datums ----------

  /** 0 = maandag ... 6 = zondag */
  function weekdagIndex(datum) {
    return (datum.getDay() + 6) % 7;
  }

  function tweeCijfers(n) {
    return String(n).padStart(2, '0');
  }

  /** Lokale datum als 'JJJJ-MM-DD' (geen UTC, dus geen verschuiving rond middernacht). */
  function datumSleutel(datum) {
    return datum.getFullYear() + '-' + tweeCijfers(datum.getMonth() + 1) + '-' + tweeCijfers(datum.getDate());
  }

  function vanSleutel(sleutel) {
    const [j, m, d] = sleutel.split('-').map(Number);
    return new Date(j, m - 1, d);
  }

  function plusDagen(datum, n) {
    return new Date(datum.getFullYear(), datum.getMonth(), datum.getDate() + n);
  }

  function maandagVan(datum) {
    return plusDagen(datum, -weekdagIndex(datum));
  }

  function zelfdeDag(a, b) {
    return datumSleutel(a) === datumSleutel(b);
  }

  /** bv. "woensdag 25 november" */
  function datumLang(datum) {
    return DAGEN[weekdagIndex(datum)] + ' ' + datum.getDate() + ' ' + MAANDEN[datum.getMonth()];
  }

  /** bv. "wo 25 nov" */
  function datumKort(datum) {
    return DAGEN_KORT[weekdagIndex(datum)] + ' ' + datum.getDate() + ' ' + MAANDEN_KORT[datum.getMonth()];
  }

  /** ISO-weeknummer */
  function weekNummer(datum) {
    const d = plusDagen(datum, 3 - weekdagIndex(datum)); // donderdag van deze week
    const eersteDonderdag = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round((d - plusDagen(eersteDonderdag, 3 - weekdagIndex(eersteDonderdag))) / (7 * 864e5));
  }

  // ---------- Schoolvakanties en vrije dagen (Vlaanderen) ----------

  /*
   * Officiële data van vlaanderen.be (Schoolvakanties). [van, tot en met, naam].
   * Zomervakantie (1 juli t/m 31 augustus) wordt per jaar berekend.
   * Nieuwe schooljaren toevoegen zodra de overheid ze publiceert.
   */
  const VAKANTIES = [
    ['2025-10-27', '2025-11-02', 'Herfstvakantie'], ['2025-11-11', '2025-11-11', 'Wapenstilstand'],
    ['2025-12-22', '2026-01-04', 'Kerstvakantie'], ['2026-02-16', '2026-02-22', 'Krokusvakantie'],
    ['2026-04-06', '2026-04-19', 'Paasvakantie'], ['2026-05-01', '2026-05-01', 'Dag van de Arbeid'],
    ['2026-05-14', '2026-05-15', 'Hemelvaart'], ['2026-05-25', '2026-05-25', 'Pinkstermaandag'],

    ['2026-11-02', '2026-11-08', 'Herfstvakantie'], ['2026-11-11', '2026-11-11', 'Wapenstilstand'],
    ['2026-12-21', '2027-01-03', 'Kerstvakantie'], ['2027-02-08', '2027-02-14', 'Krokusvakantie'],
    ['2027-03-29', '2027-04-11', 'Paasvakantie'], ['2027-05-06', '2027-05-07', 'Hemelvaart'],
    ['2027-05-17', '2027-05-17', 'Pinkstermaandag'],

    ['2027-11-01', '2027-11-07', 'Herfstvakantie'], ['2027-11-11', '2027-11-11', 'Wapenstilstand'],
    ['2027-12-27', '2028-01-09', 'Kerstvakantie'], ['2028-02-28', '2028-03-05', 'Krokusvakantie'],
    ['2028-04-03', '2028-04-17', 'Paasvakantie'], ['2028-05-01', '2028-05-01', 'Dag van de Arbeid'],
    ['2028-05-25', '2028-05-26', 'Hemelvaart'], ['2028-06-05', '2028-06-05', 'Pinkstermaandag'],

    ['2028-10-30', '2028-11-05', 'Herfstvakantie'],
    ['2028-12-25', '2029-01-07', 'Kerstvakantie'], ['2029-02-12', '2029-02-18', 'Krokusvakantie'],
    ['2029-04-02', '2029-04-15', 'Paasvakantie'], ['2029-05-01', '2029-05-01', 'Dag van de Arbeid'],
    ['2029-05-10', '2029-05-11', 'Hemelvaart'], ['2029-05-21', '2029-05-21', 'Pinkstermaandag'],

    ['2029-10-29', '2029-11-04', 'Herfstvakantie'],
    ['2029-12-24', '2030-01-06', 'Kerstvakantie'], ['2030-03-04', '2030-03-10', 'Krokusvakantie'],
    ['2030-04-08', '2030-04-22', 'Paasvakantie'], ['2030-05-01', '2030-05-01', 'Dag van de Arbeid'],
    ['2030-05-30', '2030-05-31', 'Hemelvaart'], ['2030-06-10', '2030-06-10', 'Pinkstermaandag']
  ];

  /** Naam van de schoolvakantie of vrije dag op deze datum (Vlaanderen), of null. */
  function vakantieOp(datum) {
    const s = typeof datum === 'string' ? datum : datumSleutel(datum);
    const md = s.slice(5);
    if (md >= '07-01' && md <= '08-31') return 'Zomervakantie';
    const v = VAKANTIES.find(x => s >= x[0] && s <= x[1]);
    return v ? v[2] : null;
  }

  // ---------- Data ----------

  function maakId() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function leegDagpatroon(weekdag) {
    const schooldag = weekdag < 5;
    return {
      school: schooldag,
      brengen: { wie: null, tijd: '08:15' },
      // Woensdagnamiddag is er in Belgie geen school.
      halen: { wie: null, tijd: weekdag === 2 ? '12:05' : '15:30' },
      eten: { wat: '', kok: null },
      werk: {}, // per ouder: 'thuis' | 'kantoor' | 'vrij'
      activiteiten: []
    };
  }

  /** Een eerste lijst gerechten; zelf toegevoegde komen er automatisch bij. */
  const STANDAARD_GERECHTEN = [
    'Balletjes in tomatensaus', 'Croques', 'Frietjes met frikandel', 'Kip met appelmoes',
    'Lasagne', 'Pannenkoeken', 'Pasta pesto', 'Pizza', 'Soep met boterhammen',
    'Spaghetti bolognese', 'Stoemp met worst', 'Stoofvlees met frieten',
    'Vis met puree', "Vol-au-vent", 'Wraps', 'Restjesdag'
  ];

  /** Startdata van ons gezin. Namen pas je aan bij "Gezin". */
  const STANDAARD_LEDEN = [
    { id: 'ouder1', naam: 'Kris', rol: 'ouder', kleur: KLEUREN[0] },
    { id: 'ouder2', naam: 'Eva', rol: 'ouder', kleur: KLEUREN[1] },
    { id: 'kind1', naam: 'Pablo', rol: 'kind', kleur: KLEUREN[2] },
    { id: 'kind2', naam: 'Polly', rol: 'kind', kleur: KLEUREN[3] },
    { id: 'kind3', naam: 'Louis', rol: 'kind', kleur: KLEUREN[4] }
  ];
  /** Namen uit de allereerste versie, die we automatisch vervangen. */
  const OUDE_NAMEN = { ouder1: 'Ouder 1', ouder2: 'Ouder 2', kind1: 'Kind 1', kind2: 'Kind 2' };

  function standaardData() {
    const leden = kopie(STANDAARD_LEDEN);
    const week = [];
    for (let i = 0; i < 7; i++) {
      const dag = leegDagpatroon(i);
      if (dag.school) {
        // Om beurten, zodat het voorbeeld meteen iets toont.
        dag.brengen.wie = i % 2 === 0 ? 'ouder1' : 'ouder2';
        dag.halen.wie = i % 2 === 0 ? 'ouder2' : 'ouder1';
      }
      week.push(dag);
    }
    return { versie: VERSIE, leden: leden, week: week, aanpassingen: {}, gerechten: STANDAARD_GERECHTEN.slice(), todos: [], agendaWie: {}, agendaTekst: {}, vakanties: true };
  }

  /** Vult ontbrekende velden aan, zodat oudere of geïmporteerde data blijft werken. */
  function normaliseer(data) {
    const basis = standaardData();
    if (!data || typeof data !== 'object') return basis;
    const uit = {
      versie: VERSIE,
      leden: Array.isArray(data.leden) ? kopie(data.leden.filter(l => l && l.id)) : basis.leden,
      week: [],
      aanpassingen: data.aanpassingen && typeof data.aanpassingen === 'object' ? data.aanpassingen : {}
    };
    vervangOudeNamen(uit.leden);
    uit.gerechten = Array.isArray(data.gerechten)
      ? data.gerechten.filter(g => typeof g === 'string')
      : STANDAARD_GERECHTEN.slice();
    uit.todos = Array.isArray(data.todos)
      ? data.todos.filter(t => t && t.id && typeof t.titel === 'string').map(t => ({
        id: t.id, titel: t.titel, deadline: typeof t.deadline === 'string' ? t.deadline : null,
        wie: t.wie || null, klaar: !!t.klaar
      }))
      : [];
    uit.vakanties = data.vakanties !== false;
    uit.agendaWie = {};
    if (data.agendaWie && typeof data.agendaWie === 'object') {
      Object.keys(data.agendaWie).forEach(k => {
        if (Array.isArray(data.agendaWie[k])) uit.agendaWie[k] = data.agendaWie[k].filter(x => typeof x === 'string');
      });
    }
    uit.agendaTekst = {};
    if (data.agendaTekst && typeof data.agendaTekst === 'object') {
      Object.keys(data.agendaTekst).forEach(k => {
        const t = data.agendaTekst[k];
        if (!t || typeof t !== 'object') return;
        const w = {};
        if (typeof t.titel === 'string' && t.titel.trim()) w.titel = t.titel.trim();
        if (typeof t.tijd === 'string' && /^\d{2}:\d{2}$/.test(t.tijd)) w.tijd = t.tijd;
        if (Object.keys(w).length) uit.agendaTekst[k] = w;
      });
    }
    for (let i = 0; i < 7; i++) {
      const bron = (Array.isArray(data.week) && data.week[i]) || {};
      const leeg = leegDagpatroon(i);
      uit.week.push({
        school: typeof bron.school === 'boolean' ? bron.school : leeg.school,
        brengen: Object.assign(leeg.brengen, bron.brengen),
        halen: Object.assign(leeg.halen, bron.halen),
        eten: Object.assign(leeg.eten, bron.eten),
        werk: geldigWerk(bron.werk),
        activiteiten: Array.isArray(bron.activiteiten) ? bron.activiteiten : []
      });
    }
    // Gerechten die al in de planning staan, horen ook in de lijst.
    uit.week.forEach(d => voegGerechtToe(uit, d.eten.wat));
    Object.values(uit.aanpassingen).forEach(a => { if (a && a.eten) voegGerechtToe(uit, a.eten.wat); });
    return uit;
  }

  /**
   * Wie de app al gebruikte met "Ouder 1", "Kind 1"... krijgt de echte namen.
   * Zelf aangepaste namen blijven staan.
   */
  function vervangOudeNamen(leden) {
    // Elk lid dat nog zijn oude voorbeeldnaam heeft, krijgt de echte naam.
    let vervangen = 0;
    STANDAARD_LEDEN.forEach(std => {
      const l = leden.find(x => x.id === std.id);
      if (l && OUDE_NAMEN[std.id] && l.naam === OUDE_NAMEN[std.id]) {
        l.naam = std.naam;
        vervangen++;
      }
    });
    // Derde kind toevoegen als er nog maar de twee oude voorbeeldkinderen waren.
    const kinderen = leden.filter(l => l.rol === 'kind');
    if (vervangen > 0 && !leden.some(l => l.id === 'kind3') && kinderen.length === 2 &&
        kinderen.every(k => k.id === 'kind1' || k.id === 'kind2')) {
      const std = STANDAARD_LEDEN.find(x => x.id === 'kind3');
      const gebruikt = leden.map(l => l.kleur);
      leden.push(Object.assign(kopie(std), {
        kleur: gebruikt.includes(std.kleur) ? (KLEUREN.find(k => !gebruikt.includes(k)) || std.kleur) : std.kleur
      }));
    }
  }

  function kopie(waarde) {
    return waarde === undefined ? undefined : JSON.parse(JSON.stringify(waarde));
  }

  function sorteerOpTijd(lijst) {
    return lijst.slice().sort((a, b) => (a.tijd || '99:99').localeCompare(b.tijd || '99:99'));
  }

  /**
   * Het plan voor één datum: de standaardweek, met de aanpassingen voor die datum erover.
   * `aangepast` zegt welke velden afwijken van de standaardweek.
   */
  function dagPlan(data, datum) {
    const sleutel = datumSleutel(datum);
    const patroon = data.week[weekdagIndex(datum)];
    const aanp = data.aanpassingen[sleutel] || {};
    const plan = { datum: sleutel, aangepast: {} };

    DAGVELDEN.forEach(veld => {
      if (aanp[veld] !== undefined) {
        plan[veld] = kopie(aanp[veld]);
        plan.aangepast[veld] = true;
      } else {
        plan[veld] = kopie(patroon[veld]);
      }
    });
    // Schoolvakantie of vrije dag: geen school, tenzij je die dag zelf "toch school" zette.
    plan.vakantie = data.vakanties !== false ? vakantieOp(sleutel) : null;
    if (plan.vakantie && aanp.school === undefined) plan.school = false;

    const overslaan = aanp.overslaan || [];
    // Een vaste activiteit met een einddatum (tot en met) telt daarna niet meer mee.
    const lopend = patroon.activiteiten.filter(a => !a.tot || sleutel <= a.tot);
    const vast = lopend
      .filter(a => !overslaan.includes(a.id))
      .map(a => Object.assign(kopie(a), { eenmalig: false }));
    const extra = (aanp.extra || []).map(a => Object.assign(kopie(a), { eenmalig: true }));
    plan.activiteiten = sorteerOpTijd(vast.concat(extra));
    plan.overgeslagen = lopend.filter(a => overslaan.includes(a.id)).map(kopie);
    plan.werk = geldigWerk(Object.assign({}, patroon.werk, aanp.werk));
    plan.aangepast.werk = Object.keys(aanp.werk || {});
    if (!plan.aangepast.werk.length) delete plan.aangepast.werk;
    return plan;
  }

  function aanpassingVoor(data, sleutel) {
    if (!data.aanpassingen[sleutel]) data.aanpassingen[sleutel] = {};
    return data.aanpassingen[sleutel];
  }

  function ruimLegeAanpassingOp(data, sleutel) {
    const a = data.aanpassingen[sleutel];
    if (!a) return;
    if (a.overslaan && a.overslaan.length === 0) delete a.overslaan;
    if (a.extra && a.extra.length === 0) delete a.extra;
    if (a.werk && Object.keys(a.werk).length === 0) delete a.werk;
    if (Object.keys(a).length === 0) delete data.aanpassingen[sleutel];
  }

  /**
   * Zet een veld (school, brengen, halen, eten).
   * bereik 'dag'  = alleen deze datum
   * bereik 'week' = elke week op deze weekdag (en wis de aanpassing van deze datum)
   */
  function zetVeld(data, datum, veld, waarde, bereik) {
    if (!DAGVELDEN.includes(veld)) throw new Error('Onbekend veld: ' + veld);
    const sleutel = datumSleutel(datum);
    if (bereik === 'week') {
      data.week[weekdagIndex(datum)][veld] = kopie(waarde);
      if (data.aanpassingen[sleutel]) {
        delete data.aanpassingen[sleutel][veld];
        ruimLegeAanpassingOp(data, sleutel);
      }
    } else {
      aanpassingVoor(data, sleutel)[veld] = kopie(waarde);
    }
  }

  /** Zet een veld terug naar wat de standaardweek zegt. */
  function herstelVeld(data, datum, veld) {
    const sleutel = datumSleutel(datum);
    if (!data.aanpassingen[sleutel]) return;
    delete data.aanpassingen[sleutel][veld];
    ruimLegeAanpassingOp(data, sleutel);
  }

  /**
   * Activiteit toevoegen of wijzigen.
   * bereik 'week' = vaste activiteit, elke week op deze weekdag (optioneel tot en met activiteit.tot)
   * bereik 'dag'  = eenmalig op deze datum
   */
  function bewaarActiviteit(data, datum, activiteit, bereik) {
    const sleutel = datumSleutel(datum);
    const patroon = data.week[weekdagIndex(datum)];
    const act = {
      id: activiteit.id || maakId(),
      tijd: activiteit.tijd || '',
      titel: (activiteit.titel || '').trim(),
      wie: Array.isArray(activiteit.wie) ? activiteit.wie.slice() : []
    };
    if (bereik === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(activiteit.tot || '')) act.tot = activiteit.tot;
    const isVast = patroon.activiteiten.some(a => a.id === act.id);

    if (isVast && bereik === 'dag') {
      // Een vaste activiteit enkel voor deze datum wijzigen:
      // de vaste overslaan en een eenmalige kopie toevoegen.
      const a = aanpassingVoor(data, sleutel);
      if (!(a.overslaan || []).includes(act.id)) a.overslaan = (a.overslaan || []).concat([act.id]);
      act.id = maakId();
      a.extra = sorteerOpTijd((a.extra || []).concat([act]));
      return act;
    }

    // Anders de oude versie weghalen (ze kan van "eenmalig" naar "vast" verhuizen).
    patroon.activiteiten = patroon.activiteiten.filter(a => a.id !== act.id);
    const aanp = data.aanpassingen[sleutel];
    if (aanp && aanp.extra) aanp.extra = aanp.extra.filter(a => a.id !== act.id);

    if (bereik === 'week') {
      patroon.activiteiten.push(act);
      patroon.activiteiten = sorteerOpTijd(patroon.activiteiten);
    } else {
      const a = aanpassingVoor(data, sleutel);
      a.extra = sorteerOpTijd((a.extra || []).concat([act]));
    }
    ruimLegeAanpassingOp(data, sleutel);
    return act;
  }

  /**
   * Activiteit verwijderen.
   * Voor een vaste activiteit: bereik 'dag' slaat ze enkel deze datum over, 'volgende' stopt ze
   * vanaf deze datum (eerdere weken blijven staan), 'week' verwijdert ze helemaal.
   */
  function verwijderActiviteit(data, datum, id, bereik) {
    const sleutel = datumSleutel(datum);
    const patroon = data.week[weekdagIndex(datum)];
    const aanp = data.aanpassingen[sleutel];
    if (aanp && aanp.extra && aanp.extra.some(a => a.id === id)) {
      aanp.extra = aanp.extra.filter(a => a.id !== id);
    } else if (patroon.activiteiten.some(a => a.id === id)) {
      if (bereik === 'week') {
        patroon.activiteiten = patroon.activiteiten.filter(a => a.id !== id);
      } else if (bereik === 'volgende') {
        const act = patroon.activiteiten.find(a => a.id === id);
        act.tot = datumSleutel(plusDagen(datum, -1));
        // Overgeslagen of eenmalig verplaatste keren vanaf deze datum zijn niet meer nodig.
        Object.keys(data.aanpassingen).filter(k => k >= sleutel).forEach(k => {
          const a = data.aanpassingen[k];
          if (a.overslaan) a.overslaan = a.overslaan.filter(x => x !== id);
          ruimLegeAanpassingOp(data, k);
        });
      } else {
        const a = aanpassingVoor(data, sleutel);
        a.overslaan = (a.overslaan || []).concat([id]);
      }
    }
    ruimLegeAanpassingOp(data, sleutel);
  }

  /** Een overgeslagen vaste activiteit op deze datum terugzetten. */
  function herstelActiviteit(data, datum, id) {
    const sleutel = datumSleutel(datum);
    const aanp = data.aanpassingen[sleutel];
    if (!aanp || !aanp.overslaan) return;
    aanp.overslaan = aanp.overslaan.filter(x => x !== id);
    ruimLegeAanpassingOp(data, sleutel);
  }

  /** Aanpassingen ouder dan `dagen` dagen weggooien, zodat de opslag klein blijft. */
  function ruimOudeAanpassingenOp(data, vandaag, dagen) {
    const grens = datumSleutel(plusDagen(vandaag, -(dagen || 60)));
    Object.keys(data.aanpassingen).forEach(s => {
      if (s < grens) delete data.aanpassingen[s];
    });
    // Personen bij één keer van een agenda-afspraak (sleutel "uid|JJJJ-MM-DD")
    [data.agendaWie || {}, data.agendaTekst || {}].forEach(lijst => Object.keys(lijst).forEach(k => {
      const datum = k.split('|')[1];
      if (datum && datum < grens) delete lijst[k];
    }));
  }

  function lid(data, id) {
    return data.leden.find(l => l.id === id) || null;
  }

  /** Lid verwijderen en overal waar het gebruikt wordt leegmaken. */
  function verwijderLid(data, id) {
    data.leden = data.leden.filter(l => l.id !== id);
    const wis = dag => {
      if (dag.brengen && dag.brengen.wie === id) dag.brengen.wie = null;
      if (dag.halen && dag.halen.wie === id) dag.halen.wie = null;
      if (dag.eten && dag.eten.kok === id) dag.eten.kok = null;
      if (dag.werk) delete dag.werk[id];
      ['activiteiten', 'extra'].forEach(k => {
        (dag[k] || []).forEach(a => { a.wie = (a.wie || []).filter(x => x !== id); });
      });
    };
    data.week.forEach(wis);
    Object.values(data.aanpassingen).forEach(wis);
    Object.keys(data.aanpassingen).forEach(k => ruimLegeAanpassingOp(data, k));
    (data.todos || []).forEach(t => { if (t.wie === id) t.wie = null; });
    Object.keys(data.agendaWie || {}).forEach(k => { data.agendaWie[k] = data.agendaWie[k].filter(x => x !== id); });
  }

  /* ---------- Personen bij afspraken uit de agenda ---------- */
  // data.agendaWie: { uid: [lid-ids] } geldt voor elke keer van een (herhalende) afspraak,
  // { 'uid|JJJJ-MM-DD': [lid-ids] } alleen voor die ene keer. Een lege lijst = bewust niemand.

  /** Gekozen personen, of null als er niets gekozen is (dan herkent de app namen in de titel). */
  function agendaWieVoor(data, uid, datum) {
    const lijst = data.agendaWie || {};
    const dag = lijst[uid + '|' + datum];
    if (dag) return dag.slice();
    return lijst[uid] ? lijst[uid].slice() : null;
  }

  /** bereik 'reeks' = elke keer, 'dag' = alleen op deze datum. */
  function zetAgendaWie(data, uid, datum, wie, bereik) {
    if (!uid) return;
    data.agendaWie = data.agendaWie || {};
    const lijst = (wie || []).filter(Boolean);
    if (bereik === 'dag') {
      data.agendaWie[uid + '|' + datum] = lijst;
    } else {
      data.agendaWie[uid] = lijst;
      delete data.agendaWie[uid + '|' + datum];
    }
  }

  /**
   * Terug naar wat in de agenda staat (personen: namen in de titel; titel en tijd: uit de agenda),
   * voor deze keer of voor de hele reeks.
   */
  function wisAgendaWie(data, uid, datum, bereik) {
    [data.agendaWie, data.agendaTekst].forEach(lijst => {
      if (!lijst) return;
      delete lijst[uid + '|' + datum];
      if (bereik !== 'dag') {
        delete lijst[uid];
        Object.keys(lijst).forEach(k => { if (k.startsWith(uid + '|')) delete lijst[k]; });
      }
    });
  }

  /* data.agendaTekst: zelfde sleutels als agendaWie, met { titel?, tijd? } die in de app
     gewijzigd werden. Dat wordt niet teruggeschreven naar de agenda zelf. */

  /** Gewijzigde titel en tijd ({} als er niets gewijzigd is). Eén keer gaat voor op elke keer. */
  function agendaTekstVoor(data, uid, datum) {
    const lijst = data.agendaTekst || {};
    return Object.assign({}, lijst[uid], lijst[uid + '|' + datum]);
  }

  /** wijziging = { titel?, tijd? }: alleen wat afwijkt van de agenda. Leeg = niets gewijzigd. */
  function zetAgendaTekst(data, uid, datum, wijziging, bereik) {
    if (!uid) return;
    data.agendaTekst = data.agendaTekst || {};
    const w = {};
    if (wijziging && wijziging.titel) w.titel = String(wijziging.titel).trim();
    if (wijziging && wijziging.tijd) w.tijd = wijziging.tijd;
    const sleutel = bereik === 'dag' ? uid + '|' + datum : uid;
    if (Object.keys(w).length) data.agendaTekst[sleutel] = w;
    else delete data.agendaTekst[sleutel];
    if (bereik !== 'dag') delete data.agendaTekst[uid + '|' + datum];
  }

  /* ---------- Thuis of op kantoor ---------- */

  const WERKPLEKKEN = ['thuis', 'kantoor', 'vrij'];

  function geldigWerk(werk) {
    const uit = {};
    if (werk && typeof werk === 'object') {
      Object.keys(werk).forEach(id => { if (WERKPLEKKEN.includes(werk[id])) uit[id] = werk[id]; });
    }
    return uit;
  }

  /** Waar werkt `lidId` op `datum`? waarde '' of null = niet ingevuld. */
  function zetWerk(data, datum, lidId, waarde, bereik) {
    const sleutel = datumSleutel(datum);
    const geldig = WERKPLEKKEN.includes(waarde) ? waarde : null;
    if (bereik === 'week') {
      const w = data.week[weekdagIndex(datum)].werk;
      if (geldig) w[lidId] = geldig; else delete w[lidId];
      const a = data.aanpassingen[sleutel];
      if (a && a.werk) { delete a.werk[lidId]; ruimLegeAanpassingOp(data, sleutel); }
    } else {
      const a = aanpassingVoor(data, sleutel);
      a.werk = a.werk || {};
      if (geldig) a.werk[lidId] = geldig;
      else if ((data.week[weekdagIndex(datum)].werk || {})[lidId]) a.werk[lidId] = 'onbekend'; // standaard bewust leegmaken
      else delete a.werk[lidId];
      ruimLegeAanpassingOp(data, sleutel);
    }
  }

  function herstelWerk(data, datum, lidId) {
    const sleutel = datumSleutel(datum);
    const a = data.aanpassingen[sleutel];
    if (a && a.werk) { delete a.werk[lidId]; ruimLegeAanpassingOp(data, sleutel); }
  }

  /* ---------- Todo's ---------- */

  /** Todo toevoegen of aanpassen. Geeft de bewaarde todo terug. */
  function bewaarTodo(data, todo) {
    if (!Array.isArray(data.todos)) data.todos = [];
    const titel = String(todo.titel || '').replace(/\s+/g, ' ').trim();
    if (!titel) return null;
    const bestaand = todo.id && data.todos.find(t => t.id === todo.id);
    const nieuw = {
      id: bestaand ? bestaand.id : maakId(),
      titel: titel,
      deadline: todo.deadline || null,
      wie: todo.wie || null,
      klaar: bestaand ? !!(todo.klaar !== undefined ? todo.klaar : bestaand.klaar) : !!todo.klaar
    };
    if (bestaand) Object.assign(bestaand, nieuw);
    else data.todos.push(nieuw);
    return bestaand || nieuw;
  }

  function verwijderTodo(data, id) {
    data.todos = (data.todos || []).filter(t => t.id !== id);
  }

  function zetTodoKlaar(data, id, klaar) {
    const t = (data.todos || []).find(x => x.id === id);
    if (t) t.klaar = !!klaar;
    return t || null;
  }

  /** Volgorde: eerst op deadline (zonder deadline achteraan), dan op titel. */
  function sorteerTodos(lijst) {
    return lijst.slice().sort((a, b) =>
      (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.titel.localeCompare(b.titel, 'nl'));
  }

  /**
   * Todo's voor één dag: alles met die deadline. Op vandaag komen ook
   * open todo's waarvan de deadline al voorbij is (met telaat: true).
   */
  function todosVoorDag(data, datum, vandaag) {
    const s = datumSleutel(datum);
    const isVandaag = vandaag && datumSleutel(vandaag) === s;
    // Afgevinkte todo's niet in de dag- en weekweergave (wel in het tabblad Todo's, onder Afgevinkt).
    const uit = (data.todos || []).filter(t => !t.klaar &&
      (t.deadline === s || (isVandaag && t.deadline && t.deadline < s)));
    return sorteerTodos(uit).map(t => Object.assign({}, t, { telaat: t.deadline < s }));
  }

  /** Groepen voor het todo-scherm. */
  function todoGroepen(data, vandaag) {
    const s = datumSleutel(vandaag);
    const eindeWeek = datumSleutel(plusDagen(maandagVan(vandaag), 6));
    const g = { telaat: [], vandaag: [], week: [], later: [], geenDatum: [], klaar: [] };
    sorteerTodos(data.todos || []).forEach(t => {
      if (t.klaar) g.klaar.push(t);
      else if (!t.deadline) g.geenDatum.push(t);
      else if (t.deadline < s) g.telaat.push(t);
      else if (t.deadline === s) g.vandaag.push(t);
      else if (t.deadline <= eindeWeek) g.week.push(t);
      else g.later.push(t);
    });
    return g;
  }

  function volgendeKleur(data) {
    const gebruikt = data.leden.map(l => l.kleur);
    return KLEUREN.find(k => !gebruikt.includes(k)) || KLEUREN[data.leden.length % KLEUREN.length];
  }

  /**
   * Namen per rol instellen (bv. vanuit een persoonlijke link).
   * Bestaande leden met die rol houden hun id (en dus hun plaats in de planning);
   * ontbrekende worden toegevoegd, overtollige verwijderd.
   */
  function zetNamen(data, rol, namen) {
    namen = (namen || []).map(n => String(n).trim()).filter(Boolean);
    const bestaand = data.leden.filter(l => l.rol === rol);
    namen.forEach((naam, i) => {
      if (bestaand[i]) bestaand[i].naam = naam;
      else data.leden.push({ id: maakId(), naam: naam, rol: rol, kleur: volgendeKleur(data) });
    });
    bestaand.slice(namen.length).forEach(l => verwijderLid(data, l.id));
    // Volgorde: ouders, kinderen, anderen
    const orde = { ouder: 0, kind: 1 };
    data.leden.sort((a, b) => (orde[a.rol] ?? 2) - (orde[b.rol] ?? 2));
  }

  /** Leest '#gezin=ouders:Kris,Eva;kinderen:Pablo,Polly' (of een deel daarvan). */
  function leesGezinLink(hash) {
    const m = String(hash || '').match(/gezin=([^&]+)/);
    if (!m) return null;
    let tekst;
    try { tekst = decodeURIComponent(m[1]); } catch (e) { return null; }
    const uit = {};
    tekst.split(';').forEach(deel => {
      const [sleutel, lijst] = deel.split(':');
      const rol = { ouders: 'ouder', kinderen: 'kind' }[(sleutel || '').trim().toLowerCase()];
      if (rol && lijst) uit[rol] = lijst.split(',').map(n => n.trim()).filter(Boolean);
    });
    return Object.keys(uit).length ? uit : null;
  }

  // ---------- Gerechten ----------

  function zoekGerecht(data, naam) {
    const n = String(naam || '').trim().toLowerCase();
    return (data.gerechten || []).find(g => g.toLowerCase() === n) || null;
  }

  /** Voegt een gerecht toe (zonder dubbels, hoofdletters maken niet uit). Geeft true als het nieuw was. */
  function voegGerechtToe(data, naam) {
    naam = String(naam || '').trim().replace(/\s+/g, ' ');
    if (!naam || naam.length > 80) return false;
    if (!data.gerechten) data.gerechten = [];
    if (zoekGerecht(data, naam)) return false;
    data.gerechten.push(naam);
    data.gerechten.sort((a, b) => a.localeCompare(b, 'nl'));
    return true;
  }

  function verwijderGerecht(data, naam) {
    const n = String(naam || '').trim().toLowerCase();
    data.gerechten = (data.gerechten || []).filter(g => g.toLowerCase() !== n);
  }

  /** Gerechten gesorteerd, eventueel gefilterd op een zoekterm. */
  function gerechtenLijst(data, zoek) {
    const z = String(zoek || '').trim().toLowerCase();
    return (data.gerechten || []).slice()
      .sort((a, b) => a.localeCompare(b, 'nl'))
      .filter(g => !z || g.toLowerCase().includes(z));
  }

  // ---------- Wijzigingen tussen twee versies ----------

  /**
   * Wat is er veranderd tussen `oud` en `nieuw`, voor de komende `dagen` dagen vanaf `vanaf`?
   * Geeft een lijst { sleutel, datum, tekst } (sleutel = datum + onderdeel, om dubbels te vervangen).
   */
  function verschillen(oud, nieuw, vanaf, dagen) {
    const uit = [];
    const naam = id => { const l = lid(nieuw, id) || lid(oud, id); return l ? l.naam : 'niemand'; };
    for (let i = 0; i < (dagen || 14); i++) {
      const datum = plusDagen(vanaf, i);
      const a = dagPlan(oud, datum);
      const b = dagPlan(nieuw, datum);
      const s = datumSleutel(datum);
      const voeg = (deel, tekst) => uit.push({ sleutel: s + '|' + deel, datum: s, tekst: tekst });

      if (a.school !== b.school) voeg('school', b.school ? 'Toch school' : 'Geen school');
      if (b.school) {
        [['brengen', 'Brengen'], ['halen', 'Ophalen']].forEach(([veld, label]) => {
          if (a[veld].wie !== b[veld].wie || a[veld].tijd !== b[veld].tijd) {
            voeg(veld, label + ': ' + naam(b[veld].wie) + (b[veld].tijd ? ' om ' + b[veld].tijd : '') +
              (a[veld].wie !== b[veld].wie && a.school ? ' (was ' + naam(a[veld].wie) + ')' : ''));
          }
        });
      }
      const ouders = new Set(Object.keys(a.werk).concat(Object.keys(b.werk)));
      ouders.forEach(id => {
        if (a.werk[id] !== b.werk[id]) {
          voeg('werk|' + id, naam(id) + ': ' + ({ thuis: 'thuis', kantoor: 'op kantoor', vrij: 'vrij' }[b.werk[id]] || 'niet ingevuld'));
        }
      });
      if ((a.eten.wat || '') !== (b.eten.wat || '') || a.eten.kok !== b.eten.kok) {
        voeg('eten', 'Avondeten: ' + (b.eten.wat || 'nog niet beslist') + (b.eten.kok ? ' (kookt: ' + naam(b.eten.kok) + ')' : ''));
      }
      const sleutelAct = x => (x.tijd || '') + ' ' + x.titel + ' ' + (x.wie || []).join(',');
      const oudeActs = a.activiteiten.map(sleutelAct);
      const nieuweActs = b.activiteiten.map(sleutelAct);
      b.activiteiten.filter(x => !oudeActs.includes(sleutelAct(x))).forEach(x =>
        voeg('act+' + x.titel, 'Activiteit: ' + (x.tijd ? x.tijd + ' ' : '') + x.titel));
      a.activiteiten.filter(x => !nieuweActs.includes(sleutelAct(x)) &&
        !b.activiteiten.some(y => y.titel === x.titel)).forEach(x =>
        voeg('act-' + x.titel, 'Geschrapt: ' + x.titel));
    }
    // Todo's: nieuw, aangepast of afgevinkt (enkel met een deadline vanaf vandaag of te laat).
    const oudeTodos = {};
    (oud.todos || []).forEach(t => { oudeTodos[t.id] = t; });
    const eind = datumSleutel(plusDagen(vanaf, (dagen || 14) - 1));
    (nieuw.todos || []).forEach(t => {
      const o = oudeTodos[t.id];
      const datum = t.deadline || datumSleutel(vanaf);
      if (datum > eind) return;
      const voor = t.wie ? ' (' + naam(t.wie) + ')' : '';
      let tekst = null;
      if (!o) tekst = 'Todo: ' + t.titel + voor;
      else if (!o.klaar && t.klaar) tekst = 'Afgevinkt: ' + t.titel;
      else if (o.klaar && !t.klaar) tekst = 'Todo weer open: ' + t.titel;
      else if (o.titel !== t.titel || o.deadline !== t.deadline || o.wie !== t.wie) tekst = 'Todo: ' + t.titel + voor;
      if (tekst) uit.push({ sleutel: 'todo|' + t.id, datum: datum, tekst: tekst });
    });
    return uit;
  }

  /** Nieuwe wijzigingen bij een bestaande lijst voegen (nieuwere vervangt oudere voor hetzelfde onderdeel). */
  function voegWijzigingenToe(lijst, nieuw) {
    const uit = (lijst || []).filter(x => !nieuw.some(n => n.sleutel === x.sleutel));
    return uit.concat(nieuw).sort((x, y) => x.datum.localeCompare(y.datum));
  }

  // ---------- Pushmeldingen (tekst) ----------

  /**
   * Ochtendmelding: wie brengt, wie haalt op en wie kookt.
   * Geeft { titel, tekst } of null (geen school en opties.ookZonderSchool is niet aan).
   */
  function ochtendMelding(data, datum, opties) {
    const plan = dagPlan(data, datum);
    if (!plan.school && !(opties && opties.ookZonderSchool)) return null;
    const naam = id => { const l = lid(data, id); return l ? l.naam : 'nog niemand'; };
    const regels = [];
    if (plan.school) {
      regels.push('Brengen: ' + naam(plan.brengen.wie) + (plan.brengen.tijd ? ' (' + plan.brengen.tijd + ')' : ''));
      regels.push('Ophalen: ' + naam(plan.halen.wie) + (plan.halen.tijd ? ' (' + plan.halen.tijd + ')' : ''));
    } else {
      regels.push(plan.vakantie ? 'Geen school: ' + plan.vakantie : 'Geen school');
    }
    if (plan.eten.kok || plan.eten.wat) {
      regels.push('Kookt: ' + (plan.eten.kok ? naam(plan.eten.kok) : 'nog niemand') + (plan.eten.wat ? ' (' + plan.eten.wat + ')' : ''));
    } else {
      regels.push('Avondeten: nog niet beslist');
    }
    const titel = datumLang(datum);
    return { titel: titel.charAt(0).toUpperCase() + titel.slice(1), tekst: regels.join('\n') };
  }

  /**
   * Herinnering de dag vóór de deadline: open todo's met deadline morgen,
   * voor `lidId` en voor niemand in het bijzonder (zonder lidId: alle). Geeft { titel, tekst } of null.
   */
  function todoMelding(data, vandaag, lidId) {
    const morgen = datumSleutel(plusDagen(vandaag, 1));
    const lijst = sorteerTodos((data.todos || []).filter(t => !t.klaar && t.deadline === morgen &&
      (!lidId || !t.wie || t.wie === lidId)));
    if (!lijst.length) return null;
    const naam = id => { const l = lid(data, id); return l ? ' (' + l.naam + ')' : ''; };
    return {
      titel: lijst.length === 1 ? 'Morgen te doen' : 'Morgen te doen: ' + lijst.length + " todo's",
      tekst: lijst.map(t => t.titel + (lidId && t.wie === lidId ? '' : naam(t.wie))).join('\n')
    };
  }

  const Logica = {
    DAGEN, DAGEN_KORT, MAANDEN, KLEUREN, DAGVELDEN,
    weekdagIndex, datumSleutel, vanSleutel, plusDagen, maandagVan, zelfdeDag,
    datumLang, datumKort, weekNummer,
    maakId, standaardData, normaliseer, dagPlan,
    zetVeld, herstelVeld, bewaarActiviteit, verwijderActiviteit, herstelActiviteit,
    ruimOudeAanpassingenOp, lid, verwijderLid, volgendeKleur, zetNamen, leesGezinLink,
    voegGerechtToe, verwijderGerecht, gerechtenLijst, zoekGerecht,
    verschillen, voegWijzigingenToe,
    WERKPLEKKEN, zetWerk, herstelWerk, vakantieOp, ochtendMelding, todoMelding,
    agendaWieVoor, zetAgendaWie, wisAgendaWie, agendaTekstVoor, zetAgendaTekst,
    bewaarTodo, verwijderTodo, zetTodoKlaar, sorteerTodos, todosVoorDag, todoGroepen
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Logica;
  else root.Logica = Logica;
})(typeof globalThis !== 'undefined' ? globalThis : this);
// ===== EINDE js/logica.js =====

const TIJDZONE = 'Europe/Brussels';
const APP_URL = 'https://krisfranckx.github.io/weekplanning/';
const MARGE_MINUTEN = 180; // te laat (bv. Supabase lag plat)? Dan niet meer sturen.

// ---------- Web Push (RFC 8291 + VAPID, RFC 8292) met WebCrypto ----------

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function vanB64url(tekst) {
  const s = atob(String(tekst).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(tekst).length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function samen(...delen) {
  const uit = new Uint8Array(delen.reduce((n, d) => n + d.length, 0));
  let i = 0;
  delen.forEach(d => { uit.set(d, i); i += d.length; });
  return uit;
}
async function hmac(sleutel, data) {
  const k = await crypto.subtle.importKey('raw', sleutel, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** Versleutelt de inhoud voor één abonnement (aes128gcm). */
export async function versleutel(tekst, p256dh, auth, zout) {
  const uaPubliek = vanB64url(p256dh);
  const authGeheim = vanB64url(auth);
  const eigen = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPubliek = new Uint8Array(await crypto.subtle.exportKey('raw', eigen.publicKey));
  const uaSleutel = await crypto.subtle.importKey('raw', uaPubliek, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const gedeeld = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaSleutel }, eigen.privateKey, 256));

  const prkSleutel = await hmac(authGeheim, gedeeld);
  const ikm = await hmac(prkSleutel, samen(enc.encode('WebPush: info\0'), uaPubliek, asPubliek, new Uint8Array([1])));
  const salt = zout || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, samen(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, samen(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const inhoud = samen(enc.encode(tekst), new Uint8Array([2])); // 2 = laatste blok
  const versleuteld = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, inhoud));
  const kop = new Uint8Array(21);
  kop.set(salt, 0);
  new DataView(kop.buffer).setUint32(16, 4096);
  kop[20] = asPubliek.length;
  return samen(kop, asPubliek, versleuteld);
}

/** VAPID-handtekening voor de pushdienst (Apple, Google, Mozilla). */
async function vapid(endpoint, sleutels) {
  const jwk = typeof sleutels.prive === 'string' ? JSON.parse(sleutels.prive) : sleutels.prive;
  const k = await crypto.subtle.importKey('jwk', Object.assign({}, jwk, { key_ops: ['sign'] }),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const kop = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const inhoud = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: APP_URL
  })));
  const handtekening = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(kop + '.' + inhoud));
  return 'vapid t=' + kop + '.' + inhoud + '.' + b64url(handtekening) + ', k=' + sleutels.publiek;
}

/** Stuurt één melding. Geeft de HTTP-status van de pushdienst terug. */
export async function stuurPush(abonnement, bericht, sleutels) {
  const body = await versleutel(JSON.stringify(bericht), abonnement.p256dh, abonnement.auth);
  const antwoord = await fetch(abonnement.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '14400',
      Urgency: 'normal',
      Authorization: await vapid(abonnement.endpoint, sleutels)
    },
    body: body
  });
  return antwoord.status;
}

// ---------- Database (REST met de service-sleutel, die Supabase zelf meegeeft) ----------

function env(naam) {
  return globalThis.Deno ? Deno.env.get(naam) : process.env[naam];
}
const DB_URL = (env('SUPABASE_URL') || '').replace(/\/+$/, '');
const DB_SLEUTEL = env('SUPABASE_SERVICE_ROLE_KEY') || '';

async function db(pad, opties) {
  const o = opties || {};
  const antwoord = await fetch(DB_URL + '/rest/v1/' + pad, {
    method: o.methode || 'GET',
    headers: {
      apikey: DB_SLEUTEL,
      Authorization: 'Bearer ' + DB_SLEUTEL,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  if (!antwoord.ok) throw new Error('Database ' + pad + ': ' + antwoord.status + ' ' + (await antwoord.text()));
  return antwoord.status === 204 || o.methode ? null : antwoord.json();
}

// ---------- Wanneer sturen ----------

/** Nu, in Belgische tijd: { datum: Date (lokale middernacht), sleutel 'JJJJ-MM-DD', minuut (sinds middernacht) }. */
export function nuInBelgie(moment) {
  const delen = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TIJDZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(moment || new Date()).forEach(p => { delen[p.type] = p.value; });
  const datum = new Date(Number(delen.year), Number(delen.month) - 1, Number(delen.day));
  return { datum, sleutel: delen.year + '-' + delen.month + '-' + delen.day, minuut: Number(delen.hour) * 60 + Number(delen.minute) };
}

function minuten(tijd) {
  const m = String(tijd || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Is het nu tijd (en vandaag nog niet gestuurd)? */
export function isTijd(nu, tijd, laatst) {
  const m = minuten(tijd);
  if (m === null || laatst === nu.sleutel) return false;
  return nu.minuut >= m && nu.minuut < m + MARGE_MINUTEN;
}

/** Welke meldingen moeten nu naar dit toestel? [{ soort, bericht|null }] */
export function teSturen(L, data, ab, nu) {
  const uit = [];
  if (ab.ochtend && isTijd(nu, ab.ochtend_tijd, ab.laatst_ochtend)) {
    uit.push({ soort: 'ochtend', bericht: L.ochtendMelding(data, nu.datum, { ookZonderSchool: ab.zonder_school }) });
  }
  if (ab.todos && isTijd(nu, ab.todo_tijd, ab.laatst_todo)) {
    uit.push({ soort: 'todo', bericht: L.todoMelding(data, nu.datum, ab.lid_id) });
  }
  return uit;
}

// ---------- Aanvragen ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(waarde, status) {
  return new Response(JSON.stringify(waarde), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}

async function planning(L) {
  const rij = (await db('planning?id=eq.1&select=data'))[0];
  return L.normaliseer(rij ? rij.data : null);
}

async function tik(L, sleutels) {
  const abonnementen = await db('push_abonnementen?select=*');
  if (!abonnementen.length) return { verstuurd: 0 };
  const nu = nuInBelgie();
  const data = await planning(L);
  let verstuurd = 0;
  for (const ab of abonnementen) {
    const lijst = teSturen(L, data, ab, nu);
    if (!lijst.length) continue;
    const gezien = {};
    let weg = false;
    for (const item of lijst) {
      gezien['laatst_' + item.soort] = nu.sleutel; // ook als er niets te melden is: vandaag klaar
      if (!item.bericht || weg) continue;
      try {
        const status = await stuurPush(ab, Object.assign({ tag: item.soort, url: APP_URL }, item.bericht), sleutels);
        if (status === 404 || status === 410) weg = true; // abonnement bestaat niet meer
        else if (status < 300) verstuurd++;
        else console.warn('Pushdienst gaf', status, 'voor', ab.email);
      } catch (fout) {
        console.warn('Sturen mislukt', fout);
      }
    }
    const filter = 'push_abonnementen?endpoint=eq.' + encodeURIComponent(ab.endpoint);
    if (weg) await db(filter, { methode: 'DELETE' });
    else await db(filter, { methode: 'PATCH', body: gezien });
  }
  return { verstuurd };
}

/** Testmelding van een ingelogde gebruiker naar het eigen toestel. */
async function test(L, sleutels, req, endpoint) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const wie = await fetch(DB_URL + '/auth/v1/user', { headers: { apikey: DB_SLEUTEL, Authorization: 'Bearer ' + token } });
  if (!wie.ok) return json({ fout: 'Log opnieuw in.' }, 401);
  const email = String((await wie.json()).email || '').trim().toLowerCase();
  const ab = (await db('push_abonnementen?select=*&email=eq.' + encodeURIComponent(email) +
    '&endpoint=eq.' + encodeURIComponent(endpoint || '')))[0];
  if (!ab) return json({ fout: 'Dit toestel staat niet ingeschreven. Zet de meldingen opnieuw aan.' }, 404);
  const nu = nuInBelgie();
  const data = await planning(L);
  const bericht = L.ochtendMelding(data, nu.datum, { ookZonderSchool: true });
  const status = await stuurPush(ab, Object.assign({ tag: 'test', url: APP_URL }, bericht, { titel: 'Test: ' + bericht.titel }), sleutels);
  if (status === 404 || status === 410) {
    await db('push_abonnementen?endpoint=eq.' + encodeURIComponent(ab.endpoint), { methode: 'DELETE' });
    return json({ fout: 'Dit toestel is niet meer ingeschreven. Zet de meldingen opnieuw aan.' }, 410);
  }
  return status < 300 ? json({ ok: true }) : json({ fout: 'De pushdienst gaf foutcode ' + status + '.' }, 502);
}

export async function verwerk(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const L = globalThis.Logica;
  try {
    const body = await req.json().catch(() => ({}));
    const sleutels = (await db('push_sleutels?id=eq.1&select=publiek,prive,geheim'))[0];
    if (!sleutels) return json({ fout: 'Nog geen meldingssleutels. Zet de meldingen eerst aan in de app.' }, 400);
    if (body.soort === 'test') return await test(L, sleutels, req, body.endpoint);
    if (body.soort === 'tik' && body.geheim && body.geheim === sleutels.geheim) return json(await tik(L, sleutels));
    return json({ fout: 'Onbekende aanvraag' }, 400);
  } catch (fout) {
    console.error(fout);
    return json({ fout: String(fout && fout.message || fout) }, 500);
  }
}

if (globalThis.Deno) Deno.serve(verwerk);
