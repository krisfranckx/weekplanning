const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/afval.js');
const L = require('../js/logica.js');

function basis() {
  const a = A.normaliseer({});
  A.bewaarSoort(a, { id: 'pmd', naam: 'PMD', vanaf: '2026-12-01', elke: 2 }); // dinsdag
  return a;
}

test('ophaaldagen volgen het ritme, ook vóór de startdatum', () => {
  const s = basis().soorten[0];
  assert.deepStrictEqual(A.ophaaldagen(s, '2026-11-15', '2026-12-31'), ['2026-11-17', '2026-12-01', '2026-12-15', '2026-12-29']);
  assert.strictEqual(A.volgende(s, '2026-12-02'), '2026-12-15');
  assert.strictEqual(A.ritmeTekst(s), 'om de 2 weken op dinsdag');
});

test('todo de avond ervoor, met titel', () => {
  const t = A.todos(basis(), '2026-11-30', '2026-11-30');
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].titel, 'PMD buitenzetten');
  assert.strictEqual(t[0].deadline, '2026-11-30');
  assert.strictEqual(t[0].afval.ophaling, '2026-12-01');
  assert.ok(A.isAfvalId(t[0].id));
});

test('afvinken, verzetten en overslaan', () => {
  const a = basis();
  const id = 'afval:pmd|2026-12-01';
  A.zetKlaar(a, id, true);
  assert.strictEqual(A.todos(a, '2026-11-30', '2026-11-30')[0].klaar, true);
  A.verzet(a, id, '2026-11-29');
  assert.strictEqual(A.todos(a, '2026-11-30', '2026-11-30').length, 0);
  assert.strictEqual(A.todos(a, '2026-11-29', '2026-11-29')[0].afval.verzet, true);
  assert.strictEqual(A.zoekTodo(a, id).deadline, '2026-11-29');
  A.verzet(a, id, null);
  assert.strictEqual(A.todos(a, '2026-11-30', '2026-11-30').length, 1);
  A.verzet(a, id, '');
  assert.strictEqual(A.todos(a, '2026-11-01', '2026-12-31').filter(t => t.id === id).length, 0);
});

test('ophalingen uit een afvalkalender (agenda)', () => {
  const a = A.normaliseer({});
  const t = A.todos(a, '2026-12-01', '2026-12-07', [{ uid: '1-abc', titel: 'Restafval', datum: '2026-12-04' }]);
  assert.deepStrictEqual(t.map(x => [x.titel, x.deadline]), [['Restafval buitenzetten', '2026-12-03']]);
});

test('opruimen en verwijderen', () => {
  const a = basis();
  A.zetKlaar(a, 'afval:pmd|2026-09-01', true);
  A.zetKlaar(a, 'afval:pmd|2026-12-01', true);
  assert.ok(A.ruimOp(a, '2026-11-26'));
  assert.deepStrictEqual(Object.keys(a.klaar), ['pmd|2026-12-01']);
  A.verwijderSoort(a, 'pmd');
  assert.deepStrictEqual(a.soorten, []);
  assert.deepStrictEqual(a.klaar, {});
});

test('normaliseer van de planning houdt afval bij', () => {
  const d = L.normaliseer({ afval: basis() });
  assert.strictEqual(A.normaliseer(d.afval).soorten[0].naam, 'PMD');
  assert.strictEqual(L.normaliseer({}).afval, undefined);
});
