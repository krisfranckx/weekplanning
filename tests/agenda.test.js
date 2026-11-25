const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/agenda.js');

const ics = rijen => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' + rijen.join('\r\n') + '\r\nEND:VCALENDAR\r\n';
const ev = velden => ['BEGIN:VEVENT'].concat(velden, ['END:VEVENT']).join('\r\n');
const d = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

test('losse afspraak met TZID, gevouwen titel en alarm', () => {
  const lijst = A.leesIcs(ics([ev([
    'UID:a1', 'DTSTART;TZID=Europe/Brussels:20261126T153000', 'DTEND;TZID=Europe/Brussels:20261126T163000',
    'SUMMARY:Tandarts Polly\\, controle', ' (jaarlijks)', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'SUMMARY:Alarm', 'END:VALARM'
  ])]));
  assert.strictEqual(lijst.length, 1);
  const dagen = A.perDag(lijst, d('2026-11-23'), d('2026-11-29'));
  assert.deepStrictEqual(Object.keys(dagen), ['2026-11-26']);
  assert.strictEqual(dagen['2026-11-26'][0].titel, 'Tandarts Polly, controle(jaarlijks)');
  assert.strictEqual(dagen['2026-11-26'][0].tijd, '15:30');
});

test('hele dag over meerdere dagen', () => {
  const lijst = A.leesIcs(ics([ev(['UID:k', 'DTSTART;VALUE=DATE:20261228', 'DTEND;VALUE=DATE:20261231', 'SUMMARY:Ski'])]));
  const dagen = A.perDag(lijst, d('2026-12-27'), d('2027-01-02'));
  assert.deepStrictEqual(Object.keys(dagen).sort(), ['2026-12-28', '2026-12-29', '2026-12-30']);
  assert.strictEqual(dagen['2026-12-29'][0].heleDag, true);
  assert.strictEqual(dagen['2026-12-29'][0].tijd, '');
});

test('wekelijkse herhaling met BYDAY, EXDATE, UNTIL en gewijzigde keer', () => {
  const lijst = A.leesIcs(ics([
    ev(['UID:voetbal', 'DTSTART;TZID=Europe/Brussels:20261104T140000', 'DTEND;TZID=Europe/Brussels:20261104T153000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE,SA;UNTIL=20261205T225959Z', 'EXDATE;TZID=Europe/Brussels:20261125T140000', 'SUMMARY:Voetbal Pablo']),
    ev(['UID:voetbal', 'RECURRENCE-ID;TZID=Europe/Brussels:20261128T140000',
      'DTSTART;TZID=Europe/Brussels:20261128T100000', 'DTEND;TZID=Europe/Brussels:20261128T113000', 'SUMMARY:Voetbal Pablo (match)'])
  ]));
  const dagen = A.perDag(lijst, d('2026-11-23'), d('2026-12-13'));
  assert.deepStrictEqual(Object.keys(dagen).sort(), ['2026-11-28', '2026-12-02', '2026-12-05']);
  assert.strictEqual(dagen['2026-11-28'].length, 1);
  assert.strictEqual(dagen['2026-11-28'][0].tijd, '10:00');
  assert.strictEqual(dagen['2026-11-28'][0].titel, 'Voetbal Pablo (match)');
});

test('om de twee weken en COUNT', () => {
  const lijst = A.leesIcs(ics([ev(['UID:z', 'DTSTART:20261102T180000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3', 'SUMMARY:Zwemmen'])]));
  const dagen = A.perDag(lijst, d('2026-11-01'), d('2027-01-31'));
  assert.deepStrictEqual(Object.keys(dagen).sort(), ['2026-11-02', '2026-11-16', '2026-11-30']);
});

test('maandelijks op de eerste maandag en laatste vrijdag', () => {
  const lijst = A.leesIcs(ics([
    ev(['UID:m1', 'DTSTART;VALUE=DATE:20260907', 'RRULE:FREQ=MONTHLY;BYDAY=1MO', 'SUMMARY:Oudercontact']),
    ev(['UID:m2', 'DTSTART;VALUE=DATE:20260925', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'SUMMARY:Spelavond'])
  ]));
  const dagen = A.perDag(lijst, d('2026-12-01'), d('2026-12-31'));
  assert.deepStrictEqual(Object.keys(dagen).sort(), ['2026-12-07', '2026-12-25']);
});

test('jaarlijks en geannuleerd', () => {
  const lijst = A.leesIcs(ics([
    ev(['UID:j', 'DTSTART;VALUE=DATE:20150312', 'RRULE:FREQ=YEARLY', 'SUMMARY:Verjaardag Louis']),
    ev(['UID:x', 'DTSTART:20270312T090000', 'STATUS:CANCELLED', 'SUMMARY:Afgelast'])
  ]));
  const dagen = A.perDag(lijst, d('2027-03-01'), d('2027-03-31'));
  assert.deepStrictEqual(Object.keys(dagen), ['2027-03-12']);
  assert.strictEqual(dagen['2027-03-12'].length, 1);
});

test('UTC-tijd wordt plaatselijke tijd', () => {
  const lijst = A.leesIcs(ics([ev(['UID:u', 'DTSTART:20261126T143000Z', 'SUMMARY:Call'])]));
  const dagen = A.perDag(lijst, d('2026-11-26'), d('2026-11-26'));
  const verwacht = new Date(Date.UTC(2026, 10, 26, 14, 30));
  assert.strictEqual(dagen['2026-11-26'][0].tijd, String(verwacht.getHours()).padStart(2, '0') + ':30');
});

test('gezinsleden herkennen in de titel', () => {
  const leden = [{ id: 'p', naam: 'Pablo' }, { id: 'l', naam: 'Louis' }, { id: 'e', naam: 'Eva' }];
  assert.deepStrictEqual(A.ledenInTitel('Voetbal Pablo + Louis', leden), ['p', 'l']);
  assert.deepStrictEqual(A.ledenInTitel('Evaluatie', leden), []);
});

test('personen kiezen bij een afspraak: elke keer, één keer, automatisch', () => {
  const L = require('../js/logica.js');
  const data = L.standaardData();
  const lijst = A.leesIcs(ics([ev(['UID:zw', 'DTSTART;TZID=Europe/Brussels:20261104T170000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Zwemmen'])]));
  const dagen = A.perDag(lijst, d('2026-11-25'), d('2026-12-02'));
  const item = dagen['2026-11-25'][0];
  assert.strictEqual(item.uid, 'zw');
  assert.strictEqual(item.herhaalt, true);
  assert.strictEqual(L.agendaWieVoor(data, 'zw', '2026-11-25'), null);

  L.zetAgendaWie(data, 'zw', '2026-11-25', ['kind2'], 'reeks');
  assert.deepStrictEqual(L.agendaWieVoor(data, 'zw', '2026-12-02'), ['kind2']);
  L.zetAgendaWie(data, 'zw', '2026-12-02', ['kind3'], 'dag');
  assert.deepStrictEqual(L.agendaWieVoor(data, 'zw', '2026-12-02'), ['kind3']);
  assert.deepStrictEqual(L.agendaWieVoor(data, 'zw', '2026-12-09'), ['kind2']);

  // Blijft bewaard na normaliseren (export/import, delen)
  const terug = L.normaliseer(JSON.parse(JSON.stringify(data)));
  assert.deepStrictEqual(terug.agendaWie, data.agendaWie);

  // Lid verwijderen haalt het overal weg; oude losse keren worden opgeruimd
  L.verwijderLid(terug, 'kind3');
  assert.deepStrictEqual(L.agendaWieVoor(terug, 'zw', '2026-12-02'), []);
  L.ruimOudeAanpassingenOp(terug, d('2027-03-01'), 60);
  assert.deepStrictEqual(L.agendaWieVoor(terug, 'zw', '2026-12-02'), ['kind2']);

  L.wisAgendaWie(terug, 'zw', '2026-12-02', 'reeks');
  assert.strictEqual(L.agendaWieVoor(terug, 'zw', '2026-12-02'), null);
});
