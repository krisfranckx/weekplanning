/*
 * Zet een kopie van js/logica.js in supabase/functions/meldingen/index.ts, tussen de markeringen.
 * De Supabase-editor laat geen import van een andere website toe, dus de functie moet alles zelf bevatten.
 * Gebruik: npm run bouw-meldingen (na elke wijziging aan js/logica.js; npm test controleert het).
 */
const fs = require('fs');
const path = require('path');
const BEGIN = '// ===== BEGIN js/logica.js (niet hier aanpassen: npm run bouw-meldingen) =====';
const EINDE = '// ===== EINDE js/logica.js =====';
const functie = path.join(__dirname, '..', 'supabase', 'functions', 'meldingen', 'index.ts');

function gebouwd() {
  const logica = fs.readFileSync(path.join(__dirname, '..', 'js', 'logica.js'), 'utf8').trimEnd();
  const tekst = fs.readFileSync(functie, 'utf8');
  const a = tekst.indexOf(BEGIN);
  const b = tekst.indexOf(EINDE);
  if (a < 0 || b < a) throw new Error('Markeringen niet gevonden in ' + functie);
  return { oud: tekst, nieuw: tekst.slice(0, a) + BEGIN + '\n' + logica + '\n' + tekst.slice(b) };
}

module.exports = { gebouwd };
if (require.main === module) {
  const { oud, nieuw } = gebouwd();
  if (oud !== nieuw) fs.writeFileSync(functie, nieuw);
  console.log(oud === nieuw ? 'Al bijgewerkt' : 'Bijgewerkt: ' + functie);
}
