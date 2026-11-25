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
    return { versie: VERSIE, leden: leden, week: week, aanpassingen: {}, gerechten: STANDAARD_GERECHTEN.slice() };
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
    for (let i = 0; i < 7; i++) {
      const bron = (Array.isArray(data.week) && data.week[i]) || {};
      const leeg = leegDagpatroon(i);
      uit.week.push({
        school: typeof bron.school === 'boolean' ? bron.school : leeg.school,
        brengen: Object.assign(leeg.brengen, bron.brengen),
        halen: Object.assign(leeg.halen, bron.halen),
        eten: Object.assign(leeg.eten, bron.eten),
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

    const overslaan = aanp.overslaan || [];
    const vast = patroon.activiteiten
      .filter(a => !overslaan.includes(a.id))
      .map(a => Object.assign(kopie(a), { eenmalig: false }));
    const extra = (aanp.extra || []).map(a => Object.assign(kopie(a), { eenmalig: true }));
    plan.activiteiten = sorteerOpTijd(vast.concat(extra));
    plan.overgeslagen = patroon.activiteiten.filter(a => overslaan.includes(a.id)).map(kopie);
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
   * bereik 'week' = vaste activiteit, elke week op deze weekdag
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
   * Voor een vaste activiteit: bereik 'dag' slaat ze enkel deze datum over, 'week' verwijdert ze echt.
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
      ['activiteiten', 'extra'].forEach(k => {
        (dag[k] || []).forEach(a => { a.wie = (a.wie || []).filter(x => x !== id); });
      });
    };
    data.week.forEach(wis);
    Object.values(data.aanpassingen).forEach(wis);
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

  const Logica = {
    DAGEN, DAGEN_KORT, MAANDEN, KLEUREN, DAGVELDEN,
    weekdagIndex, datumSleutel, vanSleutel, plusDagen, maandagVan, zelfdeDag,
    datumLang, datumKort, weekNummer,
    maakId, standaardData, normaliseer, dagPlan,
    zetVeld, herstelVeld, bewaarActiviteit, verwijderActiviteit, herstelActiviteit,
    ruimOudeAanpassingenOp, lid, verwijderLid, volgendeKleur, zetNamen, leesGezinLink,
    voegGerechtToe, verwijderGerecht, gerechtenLijst, zoekGerecht
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Logica;
  else root.Logica = Logica;
})(typeof globalThis !== 'undefined' ? globalThis : this);
