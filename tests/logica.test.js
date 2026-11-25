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
  assert.deepEqual(L.normaliseer(oud).leden.map(l => l.naam), ['Jan', 'Eva', 'Pablo', 'Polly', 'Louis']);
  const zelfGedaan = { leden: oud.leden.map((l, i) => Object.assign({}, l, { naam: 'X' + i })), week: [] };
  assert.deepEqual(L.normaliseer(zelfGedaan).leden.map(l => l.naam), ['X0', 'X1', 'X2', 'X3']);
});

test('gerechtenlijst: standaard, zelf toevoegen zonder dubbels, verwijderen', () => {
  const d = L.standaardData();
  assert.ok(d.gerechten.includes('Spaghetti bolognese'));
  assert.equal(L.voegGerechtToe(d, '  Curry   met rijst '), true);
  assert.ok(d.gerechten.includes('Curry met rijst'));
  assert.equal(L.voegGerechtToe(d, 'curry met rijst'), false);
  assert.equal(L.voegGerechtToe(d, ''), false);
  assert.deepEqual(L.gerechtenLijst(d, 'curry'), ['Curry met rijst']);
  L.verwijderGerecht(d, 'CURRY MET RIJST');
  assert.equal(L.zoekGerecht(d, 'Curry met rijst'), null);
});

test('normaliseer: oude data krijgt gerechtenlijst met gerechten uit de planning', () => {
  const d = L.normaliseer({ week: [{ eten: { wat: 'Witloof in de oven' } }], aanpassingen: { '2026-11-25': { eten: { wat: 'Sushi', kok: null } } } });
  assert.ok(d.gerechten.includes('Witloof in de oven'));
  assert.ok(d.gerechten.includes('Sushi'));
  assert.ok(d.gerechten.includes('Pizza'));
  const eigen = L.normaliseer({ gerechten: ['Alleen dit'], week: [] });
  assert.deepEqual(eigen.gerechten, ['Alleen dit']);
});

test('verschillen tussen twee versies van de planning', () => {
  const oud = L.standaardData();
  const nieuw = L.normaliseer(JSON.parse(JSON.stringify(oud)));
  assert.deepEqual(L.verschillen(oud, nieuw, woensdag, 14), []);
  const donderdag = L.plusDagen(woensdag, 1);
  L.zetVeld(nieuw, donderdag, 'halen', { wie: 'ouder2', tijd: '16:00' }, 'dag');
  L.zetVeld(nieuw, donderdag, 'eten', { wat: 'Lasagne', kok: 'ouder1' }, 'dag');
  L.bewaarActiviteit(nieuw, donderdag, { titel: 'Zwemles', tijd: '17:00', wie: [] }, 'dag');
  const v = L.verschillen(oud, nieuw, woensdag, 14);
  assert.deepEqual(v.map(x => x.tekst), [
    'Ophalen: Eva om 16:00 (was Kris)',
    'Avondeten: Lasagne (kookt: Kris)',
    'Activiteit: 17:00 Zwemles'
  ]);
  assert.ok(v.every(x => x.datum === '2026-11-26'));
  // Standaardweek-wijziging toont op elke komende dag van die weekdag
  const n2 = L.normaliseer(JSON.parse(JSON.stringify(oud)));
  n2.week[0].eten = { wat: 'Pizza', kok: null };
  assert.equal(L.verschillen(oud, n2, woensdag, 14).length, 2);
  // Samenvoegen: nieuwere tekst vervangt oudere voor hetzelfde onderdeel
  const lijst = L.voegWijzigingenToe(v, [{ sleutel: '2026-11-26|eten', datum: '2026-11-26', tekst: 'Avondeten: Soep' }]);
  assert.equal(lijst.length, 3);
  assert.ok(lijst.some(x => x.tekst === 'Avondeten: Soep'));
});

test("todo's: toevoegen, afvinken, tonen op dag en in groepen", () => {
  const d = L.standaardData();
  assert.deepEqual(d.todos, []);
  const t1 = L.bewaarTodo(d, { titel: '  Turnzak   wassen ', deadline: '2026-11-25', wie: 'kind2' });
  const t2 = L.bewaarTodo(d, { titel: 'Formulier school', deadline: '2026-11-20', wie: 'ouder1' });
  L.bewaarTodo(d, { titel: 'Cadeau kopen', deadline: '2026-11-27', wie: null });
  L.bewaarTodo(d, { titel: 'Garage opruimen', deadline: null });
  L.bewaarTodo(d, { titel: 'Volgende maand', deadline: '2026-12-15' });
  assert.equal(L.bewaarTodo(d, { titel: '   ' }), null);
  assert.equal(t1.titel, 'Turnzak wassen');

  // Vandaag: deadline vandaag + open en te laat
  assert.deepEqual(L.todosVoorDag(d, woensdag, woensdag).map(t => t.titel + (t.telaat ? '!' : '')), ['Formulier school!', 'Turnzak wassen']);
  // Andere dag: enkel eigen deadline
  assert.deepEqual(L.todosVoorDag(d, L.plusDagen(woensdag, 2), woensdag).map(t => t.titel), ['Cadeau kopen']);
  assert.deepEqual(L.todosVoorDag(d, new Date(2026, 10, 20), woensdag).map(t => t.titel), ['Formulier school']);

  L.zetTodoKlaar(d, t2.id, true);
  assert.deepEqual(L.todosVoorDag(d, woensdag, woensdag).map(t => t.titel), ['Turnzak wassen']);
  const g = L.todoGroepen(d, woensdag);
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map(t => t.titel)])), {
    telaat: [], vandaag: ['Turnzak wassen'], week: ['Cadeau kopen'], later: ['Volgende maand'],
    geenDatum: ['Garage opruimen'], klaar: ['Formulier school']
  });

  // Aanpassen behoudt id en klaar-status
  L.bewaarTodo(d, { id: t2.id, titel: 'Formulier', deadline: '2026-11-26', wie: 'ouder2' });
  assert.equal(d.todos.find(t => t.id === t2.id).klaar, true);
  L.verwijderLid(d, 'kind2');
  assert.equal(d.todos.find(t => t.id === t1.id).wie, null);
  L.verwijderTodo(d, t1.id);
  assert.equal(d.todos.length, 4);
  // normaliseer houdt todo's, en oude data krijgt een lege lijst
  assert.equal(L.normaliseer(JSON.parse(JSON.stringify(d))).todos.length, 4);
  assert.deepEqual(L.normaliseer({ week: [] }).todos, []);
});

test("todo's in het wijzigingsoverzicht", () => {
  const oud = L.standaardData();
  const nieuw = L.normaliseer(JSON.parse(JSON.stringify(oud)));
  const t = L.bewaarTodo(nieuw, { titel: 'Turnzak', deadline: '2026-11-26', wie: 'kind2' });
  assert.deepEqual(L.verschillen(oud, nieuw, woensdag, 14).map(x => x.datum + ' ' + x.tekst), ['2026-11-26 Todo: Turnzak (Polly)']);
  const later = L.normaliseer(JSON.parse(JSON.stringify(nieuw)));
  L.zetTodoKlaar(later, t.id, true);
  assert.deepEqual(L.verschillen(nieuw, later, woensdag, 14).map(x => x.tekst), ['Afgevinkt: Turnzak']);
});

test('thuis of op kantoor: standaardweek en per dag', () => {
  const d = L.standaardData();
  assert.deepEqual(L.dagPlan(d, woensdag).werk, {});
  L.zetWerk(d, woensdag, 'ouder1', 'kantoor', 'week');
  L.zetWerk(d, woensdag, 'ouder2', 'thuis', 'week');
  assert.deepEqual(L.dagPlan(d, volgendeWoensdag).werk, { ouder1: 'kantoor', ouder2: 'thuis' });
  // Enkel deze woensdag werkt Kris thuis
  L.zetWerk(d, woensdag, 'ouder1', 'thuis', 'dag');
  let plan = L.dagPlan(d, woensdag);
  assert.deepEqual(plan.werk, { ouder1: 'thuis', ouder2: 'thuis' });
  assert.deepEqual(plan.aangepast.werk, ['ouder1']);
  assert.equal(L.dagPlan(d, volgendeWoensdag).werk.ouder1, 'kantoor');
  // Eva enkel deze dag leeg maken
  L.zetWerk(d, woensdag, 'ouder2', '', 'dag');
  assert.deepEqual(L.dagPlan(d, woensdag).werk, { ouder1: 'thuis' });
  L.herstelWerk(d, woensdag, 'ouder1');
  L.herstelWerk(d, woensdag, 'ouder2');
  assert.deepEqual(d.aanpassingen, {});
  // Wijzigingsoverzicht
  const nieuw = L.normaliseer(JSON.parse(JSON.stringify(d)));
  L.zetWerk(nieuw, woensdag, 'ouder2', 'vrij', 'dag');
  assert.deepEqual(L.verschillen(d, nieuw, woensdag, 1).map(x => x.tekst), ['Eva: vrij']);
  // Lid verwijderen ruimt op; normaliseer houdt enkel geldige waarden
  L.verwijderLid(nieuw, 'ouder2');
  assert.deepEqual(nieuw.aanpassingen, {});
  assert.deepEqual(L.normaliseer({ week: [{ werk: { ouder1: 'thuis', x: 'maan' } }] }).week[0].werk, { ouder1: 'thuis' });
});

test('vaste activiteit met einddatum en verwijderen vanaf een datum', () => {
  const d = L.standaardData();
  const over2 = L.plusDagen(woensdag, 14);
  const zw = L.bewaarActiviteit(d, woensdag, { titel: 'Zwemmen', tijd: '14:00', wie: [], tot: L.datumSleutel(volgendeWoensdag) }, 'week');
  assert.equal(zw.tot, '2026-12-02');
  assert.equal(L.dagPlan(d, volgendeWoensdag).activiteiten.length, 1);
  assert.equal(L.dagPlan(d, over2).activiteiten.length, 0);
  // Eenmalig: geen einddatum
  const t = L.bewaarActiviteit(d, woensdag, { titel: 'Tandarts', tot: '2027-01-01' }, 'dag');
  assert.equal(t.tot, undefined);
  // Einddatum weghalen
  L.bewaarActiviteit(d, woensdag, Object.assign({}, zw, { tot: '' }), 'week');
  assert.equal(L.dagPlan(d, over2).activiteiten.length, 1);

  // Deze en alle volgende verwijderen: eerdere weken blijven
  L.verwijderActiviteit(d, over2, 'onbestaand', 'volgende');
  L.verwijderActiviteit(d, L.plusDagen(over2, 7), zw.id, 'dag'); // later overgeslagen
  L.verwijderActiviteit(d, volgendeWoensdag, zw.id, 'volgende');
  assert.deepEqual(L.dagPlan(d, woensdag).activiteiten.map(a => a.titel), ['Zwemmen', 'Tandarts']);
  assert.equal(L.dagPlan(d, volgendeWoensdag).activiteiten.length, 0);
  assert.equal(L.dagPlan(d, volgendeWoensdag).overgeslagen.length, 0);
  assert.equal(L.dagPlan(d, over2).activiteiten.length, 0);
  assert.equal(d.aanpassingen[L.datumSleutel(L.plusDagen(over2, 7))], undefined);
  // Bewaard na normaliseren
  assert.equal(L.normaliseer(JSON.parse(JSON.stringify(d))).week[2].activiteiten[0].tot, '2026-12-01');
});
