const test = require('node:test');
const assert = require('node:assert/strict');
const { gebouwd } = require('../scripts/bouw-meldingen.js');

test('Edge Function bevat de actuele js/logica.js en importeert niets van buiten', () => {
  const { oud, nieuw } = gebouwd();
  assert.ok(oud === nieuw, 'Voer npm run bouw-meldingen uit');
  assert.ok(!/^\s*import\s/m.test(oud), 'De Supabase-editor laat geen imports van andere websites toe');
});
