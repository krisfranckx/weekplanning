/*
 * Weekplanning: pushmeldingen (Supabase Edge Function "meldingen").
 *
 * - Elke 5 minuten roept Supabase deze functie aan (pg_cron, zie supabase/opzet.sql deel 9).
 *   Ze kijkt per toestel of het tijd is voor de ochtendmelding of de todo-herinnering
 *   en stuurt die via Web Push. Elke melding gaat hoogstens één keer per dag.
 * - De app kan ook een testmelding vragen (knop bij Gezin > Meldingen).
 *
 * Plak dit bestand in Supabase > Edge Functions > Deploy a new function > Via editor,
 * met als naam "meldingen". Uitleg: MELDINGEN.md.
 * Gewone JavaScript (geen TypeScript-types), zodat het ook in Node getest kan worden.
 */
import 'https://krisfranckx.github.io/weekplanning/js/logica.js';

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
