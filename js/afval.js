/*
 * Afvalophaling: de avond vóór elke ophaling een todo "<soort> buitenzetten".
 *
 * Twee bronnen:
 *  - een schema per afvalsoort (bv. PMD om de 2 weken op dinsdag), zelf ingegeven;
 *  - een gekoppelde agenda (iCal) die als afvalkalender gemarkeerd is.
 *
 * De todo's worden niet bewaard maar telkens berekend. In de gedeelde planning staat alleen
 * data.afval = { soorten: [...], agendas: ['1'], klaar: {sleutel: true}, verzet: {sleutel: 'JJJJ-MM-DD' | ''} }.
 * Een sleutel is '<soortId>|<ophaaldag>' of 'ag:<uid>|<ophaaldag>'. Verzet '' = deze keer geen ophaling.
 * Geen DOM-code, zodat het ook in Node getest kan worden.
 */
(function (root) {
  'use strict';

  const DAG_MS = 864e5;
  const VOORBEELDEN = ['Restafval', 'PMD', 'Papier en karton', 'GFT', 'Glas', 'Snoeiafval'];
  const DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
  const PREFIX = 'afval:';

  function tweeCijfers(n) { return (n < 10 ? '0' : '') + n; }
  function sleutelVan(d) { return d.getFullYear() + '-' + tweeCijfers(d.getMonth() + 1) + '-' + tweeCijfers(d.getDate()); }
  function vanSleutel(s) { const [j, m, d] = s.split('-').map(Number); return new Date(j, m - 1, d); }
  function plusDagen(s, n) { const d = vanSleutel(s); return sleutelVan(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); }
  function dagenTussen(a, b) { return Math.round((vanSleutel(b) - vanSleutel(a)) / DAG_MS); }
  function geldigeDatum(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && sleutelVan(vanSleutel(s)) === s; }
  function weekdag(s) { return (vanSleutel(s).getDay() + 6) % 7; }
  function maakId() { return 'a' + Math.random().toString(36).slice(2, 9); }

  /** Zorgt voor een volledige, geldige structuur (ook voor data van vóór deze functie). */
  function normaliseer(afval) {
    const a = afval && typeof afval === 'object' ? afval : {};
    const soorten = Array.isArray(a.soorten) ? a.soorten.filter(s => s && s.id && typeof s.naam === 'string' && s.naam.trim() && geldigeDatum(s.vanaf))
      .map(s => ({ id: String(s.id), naam: s.naam.trim(), vanaf: s.vanaf, elke: Math.min(Math.max(parseInt(s.elke, 10) || 1, 1), 12), wie: s.wie || null }))
      : [];
    const agendas = Array.isArray(a.agendas) ? a.agendas.map(String) : [];
    const klaar = {};
    if (a.klaar && typeof a.klaar === 'object') Object.keys(a.klaar).forEach(k => { if (a.klaar[k]) klaar[k] = true; });
    const verzet = {};
    if (a.verzet && typeof a.verzet === 'object') {
      Object.keys(a.verzet).forEach(k => { const v = a.verzet[k]; if (v === '' || geldigeDatum(v)) verzet[k] = v; });
    }
    return { soorten, agendas, klaar, verzet };
  }

  /** Ophaaldagen van één soort tussen van en tot (beide 'JJJJ-MM-DD', inclusief). */
  function ophaaldagen(soort, van, tot) {
    const stap = 7 * soort.elke;
    const verschil = dagenTussen(soort.vanaf, van);
    let d = plusDagen(soort.vanaf, Math.ceil(verschil / stap) * stap);
    const uit = [];
    while (d <= tot) { uit.push(d); d = plusDagen(d, stap); }
    return uit;
  }

  /** De eerstvolgende ophaling van een soort op of na `vanaf`. */
  function volgende(soort, vanaf) {
    return ophaaldagen(soort, vanaf, plusDagen(vanaf, 7 * soort.elke))[0] || null;
  }

  function ophaalVanSleutel(sleutel) { return sleutel.slice(sleutel.lastIndexOf('|') + 1); }

  function titelVoor(naam) {
    return /buiten|klaarzetten|zetten/i.test(naam) ? naam : naam + ' buitenzetten';
  }

  /**
   * Todo's (zelfde vorm als data.todos) met een deadline tussen van en tot.
   * `agendaItems`: [{ uid, titel, datum }] uit agenda's die als afvalkalender gemarkeerd zijn.
   */
  function todos(afval, van, tot, agendaItems) {
    const a = normaliseer(afval);
    const marge = 21; // een verzette ophaling kan buiten het venster vallen
    const bronnen = [];
    a.soorten.forEach(s => ophaaldagen(s, plusDagen(van, -marge), plusDagen(tot, marge)).forEach(d =>
      bronnen.push({ sleutel: s.id + '|' + d, naam: s.naam, ophaling: d, wie: s.wie })));
    (agendaItems || []).forEach(x => {
      if (!x || !x.uid || !geldigeDatum(x.datum) || !x.titel) return;
      bronnen.push({ sleutel: 'ag:' + x.uid + '|' + x.datum, naam: x.titel, ophaling: x.datum, wie: null });
    });
    const gezien = {};
    const uit = [];
    bronnen.forEach(b => {
      if (gezien[b.sleutel]) return;
      gezien[b.sleutel] = true;
      const verzet = a.verzet[b.sleutel];
      if (verzet === '') return;
      const deadline = verzet || plusDagen(b.ophaling, -1);
      if (deadline < van || deadline > tot) return;
      uit.push({
        id: PREFIX + b.sleutel, titel: titelVoor(b.naam), deadline: deadline, wie: b.wie, klaar: !!a.klaar[b.sleutel],
        afval: { sleutel: b.sleutel, ophaling: b.ophaling, naam: b.naam, verzet: !!verzet }
      });
    });
    return uit;
  }

  function isAfvalId(id) { return typeof id === 'string' && id.indexOf(PREFIX) === 0; }
  function sleutelVanId(id) { return id.slice(PREFIX.length); }

  /** Eén afval-todo terugvinden aan zijn id (ook als hij verzet is). */
  function zoekTodo(afval, id, agendaItems) {
    if (!isAfvalId(id)) return null;
    const ophaling = ophaalVanSleutel(sleutelVanId(id));
    if (!geldigeDatum(ophaling)) return null;
    return todos(afval, plusDagen(ophaling, -60), plusDagen(ophaling, 60), agendaItems).find(t => t.id === id) || null;
  }

  function zetKlaar(afval, id, klaar) {
    const k = sleutelVanId(id);
    if (klaar) afval.klaar[k] = true;
    else delete afval.klaar[k];
  }

  /** Klaarzetten op een andere dag (datum), deze keer niet ('') of terug zoals gepland (null). */
  function verzet(afval, id, datum) {
    const k = sleutelVanId(id);
    if (datum === null || datum === undefined || datum === plusDagen(ophaalVanSleutel(k), -1)) delete afval.verzet[k];
    else afval.verzet[k] = datum;
  }

  /** Oude vinkjes en verschuivingen opruimen (ophaling meer dan 30 dagen geleden). */
  function ruimOp(afval, vandaag) {
    const grens = plusDagen(vandaag, -30);
    let gewijzigd = false;
    ['klaar', 'verzet'].forEach(veld => Object.keys(afval[veld]).forEach(k => {
      if (ophaalVanSleutel(k) < grens) { delete afval[veld][k]; gewijzigd = true; }
    }));
    return gewijzigd;
  }

  function bewaarSoort(afval, soort) {
    const naam = String(soort.naam || '').replace(/\s+/g, ' ').trim();
    if (!naam || !geldigeDatum(soort.vanaf)) return null;
    const nieuw = { id: soort.id || maakId(), naam: naam, vanaf: soort.vanaf, elke: Math.min(Math.max(parseInt(soort.elke, 10) || 1, 1), 12), wie: soort.wie || null };
    const i = afval.soorten.findIndex(s => s.id === nieuw.id);
    if (i >= 0) afval.soorten[i] = nieuw;
    else afval.soorten.push(nieuw);
    return nieuw;
  }

  function verwijderSoort(afval, id) {
    afval.soorten = afval.soorten.filter(s => s.id !== id);
    [afval.klaar, afval.verzet].forEach(o => Object.keys(o).forEach(k => { if (k.indexOf(id + '|') === 0) delete o[k]; }));
  }

  function zetAgenda(afval, nr, aan) {
    const s = String(nr);
    afval.agendas = afval.agendas.filter(x => x !== s);
    if (aan) afval.agendas.push(s);
  }

  /** "elke week op dinsdag", "om de 2 weken op dinsdag" */
  function ritmeTekst(soort) {
    return (soort.elke === 1 ? 'elke week' : 'om de ' + soort.elke + ' weken') + ' op ' + DAGEN[weekdag(soort.vanaf)];
  }

  const Afval = {
    VOORBEELDEN, normaliseer, ophaaldagen, volgende, todos, isAfvalId, zoekTodo, zetKlaar, verzet, ruimOp,
    bewaarSoort, verwijderSoort, zetAgenda, ritmeTekst, titelVoor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Afval;
  else root.Afval = Afval;
})(typeof globalThis !== 'undefined' ? globalThis : this);
