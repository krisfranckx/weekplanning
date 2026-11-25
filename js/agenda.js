/*
 * Agenda inlezen (WeekCal, iCloud, Google): een ICS-bestand omzetten naar afspraken per dag.
 *
 * - Alleen lezen: wijzigen gebeurt in de agenda zelf (bv. WeekCal).
 * - Ondersteunt hele-dag-afspraken, afspraken over meerdere dagen en herhalingen
 *   (dagelijks, wekelijks, maandelijks, jaarlijks; INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY,
 *   EXDATE en losse wijzigingen via RECURRENCE-ID).
 * - Tijden met TZID worden als plaatselijke tijd gelezen (het gezin woont in één tijdzone),
 *   tijden in UTC (…Z) worden omgerekend naar de tijd van dit toestel.
 */
(function (root) {
  'use strict';

  const DAG_MS = 864e5;
  const BYDAY = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

  function tweeCijfers(n) { return (n < 10 ? '0' : '') + n; }
  function sleutelVan(d) { return d.getFullYear() + '-' + tweeCijfers(d.getMonth() + 1) + '-' + tweeCijfers(d.getDate()); }
  function dagStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function plusDagen(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function dagenTussen(a, b) { return Math.round((dagStart(b) - dagStart(a)) / DAG_MS); }

  // ---------- ICS lezen ----------

  /** Regels "ontvouwen" (een regel die met een spatie begint, hoort bij de vorige). */
  function regels(tekst) {
    return String(tekst || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  }

  function leesRegel(regel) {
    // NAAM;PARAM=waarde;PARAM="a:b":WAARDE  (de eerste : buiten aanhalingstekens scheidt)
    let inAanh = false;
    let i = 0;
    for (; i < regel.length; i++) {
      const c = regel[i];
      if (c === '"') inAanh = !inAanh;
      else if (c === ':' && !inAanh) break;
    }
    if (i >= regel.length) return null;
    const delen = regel.slice(0, i).split(';');
    const params = {};
    delen.slice(1).forEach(p => {
      const j = p.indexOf('=');
      if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '');
    });
    return { naam: delen[0].toUpperCase(), params: params, waarde: regel.slice(i + 1) };
  }

  function ontsnap(tekst) {
    return String(tekst || '').replace(/\\([\\;,nN])/g, (m, c) => (c === 'n' || c === 'N' ? ' ' : c)).replace(/\s+/g, ' ').trim();
  }

  /** Datum of datum-tijd uit ICS. Geeft { datum: Date (plaatselijk), heleDag }. */
  function leesTijd(waarde, params) {
    const m = String(waarde || '').trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const j = +m[1], mnd = +m[2] - 1, d = +m[3];
    if (m[4] === undefined || (params && params.VALUE === 'DATE')) {
      return { datum: new Date(j, mnd, d), heleDag: true };
    }
    const u = +m[4], min = +m[5], s = +(m[6] || 0);
    const datum = m[7] ? new Date(Date.UTC(j, mnd, d, u, min, s)) : new Date(j, mnd, d, u, min, s);
    return { datum: datum, heleDag: false };
  }

  function leesRrule(waarde) {
    const r = {};
    String(waarde || '').split(';').forEach(deel => {
      const [k, v] = deel.split('=');
      if (k && v !== undefined) r[k.toUpperCase()] = v.toUpperCase();
    });
    if (!r.FREQ) return null;
    const regel = {
      freq: r.FREQ,
      interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
      count: r.COUNT ? parseInt(r.COUNT, 10) : null,
      until: null,
      byday: null,
      bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number).filter(Boolean) : null,
      bymonth: r.BYMONTH ? r.BYMONTH.split(',').map(n => Number(n) - 1) : null,
      bysetpos: r.BYSETPOS ? parseInt(r.BYSETPOS, 10) : null
    };
    if (r.UNTIL) {
      const t = leesTijd(r.UNTIL);
      if (t) { regel.until = t.datum; regel.untilHeleDag = t.heleDag; }
    }
    if (r.BYDAY) {
      regel.byday = r.BYDAY.split(',').map(x => {
        const m = x.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
        return m ? { nr: m[1] ? parseInt(m[1], 10) : 0, dag: BYDAY[m[2]] } : null;
      }).filter(Boolean);
    }
    return regel;
  }

  /** Alle VEVENTs uit een ICS-tekst. */
  function leesIcs(tekst) {
    const afspraken = [];
    let huidig = null;
    let diepte = 0; // VALARM e.d. binnen een VEVENT overslaan
    regels(tekst).forEach(r => {
      if (!r) return;
      const l = leesRegel(r);
      if (!l) return;
      if (l.naam === 'BEGIN') {
        if (l.waarde.toUpperCase() === 'VEVENT' && !huidig) { huidig = { exdates: [] }; diepte = 0; }
        else if (huidig) diepte++;
        return;
      }
      if (l.naam === 'END') {
        if (huidig && diepte > 0) { diepte--; return; }
        if (huidig && l.waarde.toUpperCase() === 'VEVENT') {
          if (huidig.start) afspraken.push(huidig);
          huidig = null;
        }
        return;
      }
      if (!huidig || diepte > 0) return;
      switch (l.naam) {
        case 'UID': huidig.uid = l.waarde.trim(); break;
        case 'SUMMARY': huidig.titel = ontsnap(l.waarde); break;
        case 'LOCATION': huidig.plaats = ontsnap(l.waarde); break;
        case 'STATUS': huidig.status = l.waarde.trim().toUpperCase(); break;
        case 'DTSTART': {
          const t = leesTijd(l.waarde, l.params);
          if (t) { huidig.start = t.datum; huidig.heleDag = t.heleDag; }
          break;
        }
        case 'DTEND': {
          const t = leesTijd(l.waarde, l.params);
          if (t) huidig.einde = t.datum;
          break;
        }
        case 'DURATION': huidig.duur = leesDuur(l.waarde); break;
        case 'RRULE': huidig.rrule = leesRrule(l.waarde); break;
        case 'EXDATE':
          l.waarde.split(',').forEach(w => {
            const t = leesTijd(w, l.params);
            if (t) huidig.exdates.push(sleutelVan(t.datum));
          });
          break;
        case 'RECURRENCE-ID': {
          const t = leesTijd(l.waarde, l.params);
          if (t) huidig.vervangt = sleutelVan(t.datum);
          break;
        }
      }
    });
    return afspraken;
  }

  function leesDuur(waarde) {
    const m = String(waarde || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return 0;
    return ((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 * 3600 + +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
  }

  // ---------- Herhalingen ----------

  /** Valt dag `d` op een herhaling van afspraak `a`? (zonder COUNT/UNTIL/EXDATE) */
  function pastInRegel(a, r, d) {
    const s = dagStart(a.start);
    if (d < s) return false;
    if (r.bymonth && !r.bymonth.includes(d.getMonth())) return false;
    switch (r.freq) {
      case 'DAILY':
        if (r.byday && !r.byday.some(b => b.dag === d.getDay())) return false;
        return dagenTussen(s, d) % r.interval === 0;
      case 'WEEKLY': {
        const dagen = r.byday ? r.byday.map(b => b.dag) : [s.getDay()];
        if (!dagen.includes(d.getDay())) return false;
        const maandagS = plusDagen(s, -((s.getDay() + 6) % 7));
        const maandagD = plusDagen(d, -((d.getDay() + 6) % 7));
        return Math.round(dagenTussen(maandagS, maandagD) / 7) % r.interval === 0;
      }
      case 'MONTHLY': {
        const maanden = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
        if (maanden % r.interval !== 0) return false;
        return pastInMaand(r, d, s);
      }
      case 'YEARLY': {
        if ((d.getFullYear() - s.getFullYear()) % r.interval !== 0) return false;
        if (!r.bymonth && d.getMonth() !== s.getMonth()) return false;
        return pastInMaand(r, d, s);
      }
    }
    return false;
  }

  function pastInMaand(r, d, s) {
    const dagenInMaand = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (r.bymonthday) {
      return r.bymonthday.some(n => (n > 0 ? n : dagenInMaand + n + 1) === d.getDate());
    }
    if (r.byday) {
      const nrVooraan = Math.floor((d.getDate() - 1) / 7) + 1;
      const nrAchteraan = -(Math.floor((dagenInMaand - d.getDate()) / 7) + 1);
      const pos = r.bysetpos;
      return r.byday.some(b => b.dag === d.getDay() && (
        pos ? (pos > 0 ? nrVooraan === pos : nrAchteraan === pos)
          : (b.nr === 0 || b.nr === nrVooraan || b.nr === nrAchteraan)));
    }
    return d.getDate() === s.getDate();
  }

  // ---------- Per dag ----------

  function tijdTekst(d) { return tweeCijfers(d.getHours()) + ':' + tweeCijfers(d.getMinutes()); }

  /** Hoeveel dagen beslaat de afspraak (1 = één dag)? */
  function aantalDagen(a) {
    let einde = a.einde || (a.duur ? new Date(a.start.getTime() + a.duur) : null);
    if (!einde) return 1;
    if (a.heleDag) return Math.max(1, dagenTussen(a.start, einde));
    // Getimed: tot op de dag van het einde (een einde om 00:00 telt niet mee). Max. 14 dagen.
    const laatste = new Date(einde.getTime() - 1);
    return Math.min(14, Math.max(1, dagenTussen(a.start, laatste) + 1));
  }

  /**
   * Afspraken per dag tussen `van` en `tot` (beide inbegrepen).
   * Geeft { 'JJJJ-MM-DD': [{ id, titel, tijd, heleDag, plaats }] }, gesorteerd op tijd.
   */
  function perDag(afspraken, van, tot) {
    van = dagStart(van);
    tot = dagStart(tot);
    const uit = {};
    const vervangen = {}; // uid -> [datum-sleutels die apart gewijzigd zijn]
    afspraken.forEach(a => {
      if (a.vervangt && a.uid) (vervangen[a.uid] = vervangen[a.uid] || []).push(a.vervangt);
    });

    function zet(a, begin, volgnr) {
      if (a.status === 'CANCELLED') return;
      const dagen = aantalDagen(a);
      for (let i = 0; i < dagen; i++) {
        const d = plusDagen(begin, i);
        if (d < van || d > tot) continue;
        const sleutel = sleutelVan(d);
        const heleDag = a.heleDag || i > 0;
        (uit[sleutel] = uit[sleutel] || []).push({
          id: 'agenda-' + (a.uid || a.titel || '') + '-' + sleutelVan(begin) + (volgnr ? '-' + volgnr : '') + (i ? '-' + i : ''),
          titel: a.titel || '(zonder titel)',
          tijd: heleDag ? '' : tijdTekst(a.start),
          heleDag: heleDag,
          plaats: a.plaats || ''
        });
      }
    }

    afspraken.forEach((a, nr) => {
      if (!a.start) return;
      if (a.vervangt || !a.rrule) { zet(a, dagStart(a.start), a.vervangt ? 'w' + nr : 0); return; }
      const r = a.rrule;
      const uitgesloten = a.exdates.concat(vervangen[a.uid] || []);
      const marge = aantalDagen(a) - 1;
      // Met COUNT moeten we vanaf de start tellen; anders mogen we vlak voor `van` beginnen.
      let d = r.count ? dagStart(a.start) : new Date(Math.max(dagStart(a.start), plusDagen(van, -marge)));
      let geteld = 0;
      const opDag = a.heleDag || r.untilHeleDag;
      for (let stap = 0; d <= tot && stap < 40000; d = plusDagen(d, 1), stap++) {
        if (!pastInRegel(a, r, d)) continue;
        const begin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), a.start.getHours(), a.start.getMinutes());
        if (r.until && (opDag ? d > dagStart(r.until) : begin > r.until)) break;
        geteld++;
        if (r.count && geteld > r.count) break;
        if (uitgesloten.includes(sleutelVan(d))) continue;
        zet(Object.assign({}, a, { start: a.heleDag ? d : begin, einde: null, duur: duurVan(a) }), d, 0);
      }
    });

    Object.keys(uit).forEach(k => {
      uit[k].sort((x, y) => (x.tijd || '').localeCompare(y.tijd || '') || x.titel.localeCompare(y.titel));
    });
    return uit;
  }

  function duurVan(a) {
    if (a.einde) return a.einde - a.start;
    return a.duur || 0;
  }

  /** Gezinsleden waarvan de naam als los woord in de titel staat (bv. "Pablo voetbal"). */
  function ledenInTitel(titel, leden) {
    const t = ' ' + String(titel || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
    return (leden || []).filter(l => l.naam && t.includes(' ' + l.naam.toLowerCase() + ' ')).map(l => l.id);
  }

  const Agenda = { leesIcs, perDag, ledenInTitel, sleutelVan };

  if (typeof module !== 'undefined' && module.exports) module.exports = Agenda;
  else root.Agenda = Agenda;
})(typeof globalThis !== 'undefined' ? globalThis : this);
