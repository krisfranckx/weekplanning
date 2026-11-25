const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logica.js');

const woensdag = new Date(2026, 10, 25); // 25 november 2026
const volgendeWoensdag = L.plusDagen(woensdag, 7);

test('datums in het Nederlands', () => {
  assert.equal(L.weekdagIndex(woensdag), 2);
  assert.equal(L.datumSleutel(woensdag), '2026-11-25');
  assert.equal(L.datumLang(woensdag), 'woensdag 25 november');
  assert.equal(L.datumKort(woensdag), 'wo 25 nov');
  assert.equal(L.datumSleutel(L.maandagVan(woensdag)), '2026-11-23');
  assert.equal(L.weekNummer(woensdag), 48);
  assert.equal(L.weekNummer(new Date(2027, 0, 1)), 53);
});

test('standaarddata: school op weekdagen, woensdag vroeg ophalen', () => {
  const d = L.standaardData();
  assert.equal(d.week.length, 7);
  assert.equal(d.week[0].school, true);
  assert.equal(d.week[5].school, false);
  assert.equal(d.week[2].halen.tijd, '12:05');
});

test('aanpassing voor één dag raakt de standaardweek niet', () => {
  const d = L.standaardData();
  L.zetVeld(d, woensdag, 'halen', { wie: 'kind1', tijd: '13:00' }, 'dag');
  const plan = L.dagPlan(d, woensdag);
  assert.equal(plan.halen.wie, 'kind1');
  assert.equal(plan.aangepast.halen, true);
  assert.equal(L.dagPlan(d, volgendeWoensdag).halen.wie, d.week[2].halen.wie);

  L.herstelVeld(d, woensdag, 'halen');
  assert.equal(L.dagPlan(d, woensdag).aangepast.halen, undefined);
  assert.deepEqual(d.aanpassingen, {});
});

test('aanpassing voor elke week wist ook de dagaanpassing', () => {
  const d = L.standaardData();
  L.zetVeld(d, woensdag, 'eten', { wat: 'Pizza', kok: null }, 'dag');
  L.zetVeld(d, woensdag, 'eten', { wat: 'Spaghetti', kok: 'ouder1' }, 'week');
  assert.equal(L.dagPlan(d, woensdag).eten.wat, 'Spaghetti');
  assert.equal(L.dagPlan(d, volgendeWoensdag).eten.wat, 'Spaghetti');
  assert.deepEqual(d.aanpassingen, {});
});

test('vaste en eenmalige activiteiten', () => {
  const d = L.standaardData();
  const zwemmen = L.bewaarActiviteit(d, woensdag, { titel: 'Zwemmen', tijd: '14:00', wie: ['kind1'] }, 'week');
  L.bewaarActiviteit(d, woensdag, { titel: 'Tandarts', tijd: '09:30', wie: ['kind2'] }, 'dag');

  let plan = L.dagPlan(d, woensdag);
  assert.deepEqual(plan.activiteiten.map(a => a.titel), ['Tandarts', 'Zwemmen']);
  assert.deepEqual(L.dagPlan(d, volgendeWoensdag).activiteiten.map(a => a.titel), ['Zwemmen']);

  // Vaste activiteit één keer overslaan en terugzetten
  L.verwijderActiviteit(d, woensdag, zwemmen.id, 'dag');
  plan = L.dagPlan(d, woensdag);
  assert.deepEqual(plan.activiteiten.map(a => a.titel), ['Tandarts']);
  assert.deepEqual(plan.overgeslagen.map(a => a.titel), ['Zwemmen']);
  L.herstelActiviteit(d, woensdag, zwemmen.id);
  assert.equal(L.dagPlan(d, woensdag).activiteiten.length, 2);

  // Vaste activiteit enkel deze dag verplaatsen
  L.bewaarActiviteit(d, woensdag, Object.assign({}, zwemmen, { tijd: '15:00' }), 'dag');
  plan = L.dagPlan(d, woensdag);
  assert.deepEqual(plan.activiteiten.map(a => a.tijd + ' ' + a.titel), ['09:30 Tandarts', '15:00 Zwemmen']);
  assert.equal(L.dagPlan(d, volgendeWoensdag).activiteiten[0].tijd, '14:00');

  // Vaste activiteit echt verwijderen
  L.verwijderActiviteit(d, volgendeWoensdag, zwemmen.id, 'week');
  assert.equal(L.dagPlan(d, volgendeWoensdag).activiteiten.length, 0);
});

test('lid verwijderen maakt toewijzingen leeg', () => {
  const d = L.standaardData();
  L.zetVeld(d, woensdag, 'brengen', { wie: 'ouder1', tijd: '08:00' }, 'dag');
  L.verwijderLid(d, 'ouder1');
  assert.equal(L.lid(d, 'ouder1'), null);
  assert.ok(d.week.every(w => w.brengen.wie !== 'ouder1' && w.halen.wie !== 'ouder1'));
  assert.equal(L.dagPlan(d, woensdag).brengen.wie, null);
});

test('normaliseer vult ontbrekende velden aan', () => {
  const d = L.normaliseer({ leden: [{ id: 'a', naam: 'A' }], week: [{ brengen: { wie: 'a' } }] });
  assert.equal(d.week.length, 7);
  assert.equal(d.week[0].brengen.wie, 'a');
  assert.equal(d.week[0].brengen.tijd, '08:15');
  assert.deepEqual(d.aanpassingen, {});
  assert.deepEqual(L.normaliseer(null).leden.map(l => l.naam), ['Kris', 'Eva', 'Pablo', 'Polly', 'Louis']);
});

test('oude aanpassingen worden opgeruimd', () => {
  const d = L.standaardData();
  L.zetVeld(d, new Date(2026, 0, 1), 'school', false, 'dag');
  L.zetVeld(d, woensdag, 'school', false, 'dag');
  L.ruimOudeAanpassingenOp(d, woensdag, 60);
  assert.deepEqual(Object.keys(d.aanpassingen), ['2026-11-25']);
});

test('namen instellen via persoonlijke link', () => {
  const d = L.standaardData();
  const g = L.leesGezinLink('#gezin=' + encodeURIComponent('ouders:Ann,Bert;kinderen:Cas,Dirk,Els'));
  assert.deepEqual(g, { ouder: ['Ann', 'Bert'], kind: ['Cas', 'Dirk', 'Els'] });
  L.zetNamen(d, 'ouder', g.ouder);
  L.zetNamen(d, 'kind', g.kind);
  assert.deepEqual(d.leden.map(l => l.naam), ['Ann', 'Bert', 'Cas', 'Dirk', 'Els']);
  assert.equal(L.lid(d, 'ouder1').naam, 'Ann'); // id blijft, planning blijft kloppen
  assert.equal(new Set(d.leden.map(l => l.kleur)).size, 5);
  L.zetNamen(d, 'kind', ['Cas']);
  assert.deepEqual(d.leden.filter(l => l.rol === 'kind').map(l => l.naam), ['Cas']);
  assert.equal(L.leesGezinLink('#koppel=abc'), null);
});

test('oude standaardnamen worden vervangen, aangepaste niet', () => {
  const oud = { leden: [
    { id: 'ouder1', naam: 'Ouder 1', rol: 'ouder' }, { id: 'ouder2', naam: 'Ouder 2', rol: 'ouder' },
    { id: 'kind1', naam: 'Kind 1', rol: 'kind' }, { id: 'kind2', naam: 'Kind 2', rol: 'kind' }
  ], week: [] };
  assert.deepEqual(L.normaliseer(oud).leden.map(l => l.naam), ['Kris', 'Eva', 'Pablo', 'Polly', 'Louis']);
  oud.leden[0].naam = 'Jan';
  assert.deepEqual(L.normaliseer(oud).leden.map(l => l.naam), ['Jan', 'Ouder 2', 'Kind 1', 'Kind 2']);
});
