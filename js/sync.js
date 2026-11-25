/*
 * Live delen via Supabase (optioneel).
 *
 * - Zonder instellingen werkt de app gewoon lokaal; Supabase wordt dan niet eens geladen.
 * - De hele planning staat als één JSON-document in de tabel `planning` (rij id = 1).
 * - Elke wijziging wordt meteen lokaal bewaard en daarna naar Supabase gestuurd.
 *   Lukt dat niet (offline), dan blijft ze "wachtend" en gaat ze mee zodra er weer verbinding is.
 * - Wijzigingen van de partner komen binnen via Supabase Realtime.
 * - Bij een conflict (beide toestellen offline gewijzigd) wint de laatste die verstuurt.
 */
(function (root) {
  'use strict';

  const CONFIG_SLEUTEL = 'weekplanning.supabase';
  const STAAT_SLEUTEL = 'weekplanning.sync';
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const TABEL = 'planning';
  const RIJ = 1;

  let opties = null;      // { haalData, opNieuweData, opStatus }
  let client = null;
  let kanaal = null;
  let gebruiker = null;
  let status = { soort: 'uit', tekst: 'Niet gedeeld' };
  let verzendTimer = null;
  let bezig = false;

  // ---------- Kleine opslag ----------

  function leesJson(sleutel) {
    try { return JSON.parse(localStorage.getItem(sleutel)) || null; } catch (e) { return null; }
  }
  function schrijfJson(sleutel, waarde) {
    try {
      if (waarde == null) localStorage.removeItem(sleutel);
      else localStorage.setItem(sleutel, JSON.stringify(waarde));
    } catch (e) { /* opslag niet beschikbaar */ }
  }

  function syncStaat() {
    const s = leesJson(STAAT_SLEUTEL) || {};
    if (!s.apparaat) {
      s.apparaat = Math.random().toString(36).slice(2, 10);
      schrijfJson(STAAT_SLEUTEL, s);
    }
    return s;
  }
  function zetSyncStaat(wijziging) {
    schrijfJson(STAAT_SLEUTEL, Object.assign(syncStaat(), wijziging));
  }

  function config() {
    return leesJson(CONFIG_SLEUTEL);
  }

  function zetStatus(soort, tekst) {
    status = { soort: soort, tekst: tekst };
    if (opties && opties.opStatus) opties.opStatus(status);
  }

  // ---------- Supabase laden ----------

  function laadBibliotheek() {
    if (root.supabase && root.supabase.createClient) return Promise.resolve(root.supabase);
    return new Promise((ok, fout) => {
      const s = document.createElement('script');
      s.src = SUPABASE_JS;
      s.onload = () => (root.supabase ? ok(root.supabase) : fout(new Error('Supabase niet geladen')));
      s.onerror = () => fout(new Error('Kon Supabase niet laden (offline?)'));
      document.head.appendChild(s);
    });
  }

  async function maakClient() {
    const c = config();
    if (!c) return null;
    if (client) return client;
    const lib = await laadBibliotheek();
    client = lib.createClient(c.url, c.sleutel, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'weekplanning.auth' }
    });
    client.auth.onAuthStateChange((gebeurtenis, sessie) => {
      gebruiker = sessie ? sessie.user : null;
    });
    return client;
  }

  // ---------- Synchroniseren ----------

  async function haalOp() {
    const { data, error } = await client.from(TABEL).select('data, bijgewerkt, apparaat, bijgewerkt_door').eq('id', RIJ).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function verstuur() {
    if (!client || !gebruiker || bezig) return;
    if (!navigator.onLine) { zetStatus('offline', 'Offline: wordt gedeeld zodra er verbinding is'); return; }
    bezig = true;
    try {
      const s = syncStaat();
      const nu = new Date().toISOString();
      const { error } = await client.from(TABEL).upsert({
        id: RIJ,
        data: opties.haalData(),
        bijgewerkt: nu,
        apparaat: s.apparaat,
        bijgewerkt_door: gebruiker.email || null
      });
      if (error) throw error;
      zetSyncStaat({ wachtend: false, laatsteSync: nu });
      zetStatus('ok', 'Gedeeld');
    } catch (fout) {
      zetSyncStaat({ wachtend: true });
      meldFout(fout);
    } finally {
      bezig = false;
    }
  }

  function meldFout(fout) {
    const tekst = (fout && fout.message) || String(fout);
    const code = fout && fout.code;
    if (!navigator.onLine || /Failed to fetch|NetworkError|network/i.test(tekst)) {
      zetStatus('offline', 'Offline: wordt gedeeld zodra er verbinding is');
    } else if (/permission denied/i.test(tekst)) {
      // Tabelrechten ontbreken (nieuwere Supabase-projecten geven die niet meer automatisch).
      zetStatus('fout', 'Geen rechten op de tabel: voer supabase/opzet.sql opnieuw uit (' + tekst + ')');
    } else if (/row-level security/i.test(tekst) || code === '42501') {
      const wie = gebruiker && gebruiker.email ? gebruiker.email : 'je e-mailadres';
      zetStatus('fout', 'Geen toegang: staat ' + wie + ' exact zo in de tabel "toegelaten"?');
    } else {
      zetStatus('fout', 'Delen mislukt: ' + tekst + (code ? ' (' + code + ')' : ''));
    }
    console.warn('Synchronisatie:', fout);
  }

  /** Haal de gedeelde planning op en beslis wie gelijk heeft. */
  async function synchroniseer() {
    if (!client || !gebruiker) return;
    zetStatus('bezig', 'Verbinden…');
    try {
      const op = await haalOp();
      const s = syncStaat();
      if (!op) {
        // Nog niets gedeeld: deze planning wordt de gedeelde.
        await verstuur();
      } else if (s.wachtend && s.laatsteSync) {
        // Wij hebben offline gewijzigd: onze versie gaat mee (laatste wint).
        await verstuur();
      } else if (!s.laatsteSync || op.bijgewerkt > s.laatsteSync) {
        // Eerste keer gekoppeld, of de partner heeft intussen iets gewijzigd: overnemen.
        opties.opNieuweData(op.data, s.laatsteSync ? 'gedeeld' : 'eerste', { door: op.bijgewerkt_door });
        zetSyncStaat({ wachtend: false, laatsteSync: op.bijgewerkt });
        zetStatus('ok', 'Gedeeld');
      } else {
        zetStatus('ok', 'Gedeeld');
      }
      luister();
    } catch (fout) {
      meldFout(fout);
    }
  }

  function luister() {
    if (kanaal || !client) return;
    kanaal = client
      .channel('weekplanning')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABEL }, payload => {
        const rij = payload.new;
        if (!rij || !rij.data) return;
        if (rij.apparaat === syncStaat().apparaat) return; // onze eigen wijziging
        if (syncStaat().wachtend) return; // eigen wijzigingen gaan eerst mee
        opties.opNieuweData(rij.data, 'partner', { door: rij.bijgewerkt_door });
        zetSyncStaat({ laatsteSync: rij.bijgewerkt });
        zetStatus('ok', 'Gedeeld');
      })
      .subscribe();
  }

  function stopLuisteren() {
    if (kanaal && client) client.removeChannel(kanaal);
    kanaal = null;
  }

  // ---------- Publieke functies ----------

  const Sync = {
    /** Start: laadt Supabase alleen als het ingesteld is. */
    async start(o) {
      opties = o;
      syncStaat();
      // Altijd luisteren: delen kan later in deze sessie aangezet worden.
      root.addEventListener('online', () => { if (gebruiker) synchroniseer(); });
      root.addEventListener('offline', () => {
        if (config()) zetStatus('offline', 'Offline: wordt gedeeld zodra er verbinding is');
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && gebruiker) synchroniseer();
      });
      if (!config()) { zetStatus('uit', 'Niet gedeeld'); return; }
      try {
        await maakClient();
        const { data } = await client.auth.getSession();
        gebruiker = data && data.session ? data.session.user : null;
        if (!gebruiker) { zetStatus('afgemeld', 'Log in om te delen'); return; }
        await synchroniseer();
      } catch (fout) {
        meldFout(fout);
      }
    },

    /** Gegevens voor de Siri-opdracht: maakt een nieuwe persoonlijke Siri-sleutel aan. */
    async siriGegevens() {
      const c = config();
      if (!c || !client || !gebruiker) throw new Error('Log eerst in om te delen');
      const { data, error } = await client.rpc('maak_siri_sleutel');
      if (error) {
        if (/maak_siri_sleutel|function|schema cache/i.test(error.message || '')) {
          throw new Error('Voer eerst het bijgewerkte supabase/opzet.sql opnieuw uit in Supabase');
        }
        throw error;
      }
      return { adres: c.url.replace(/\/+$/, '') + '/rest/v1/rpc/todo_via_siri', apikey: c.sleutel, sleutel: data };
    },

    /** Een functie in Supabase aanroepen (alleen als je ingelogd bent). */
    async rpc(naam, args) {
      if (!client || !gebruiker) throw new Error('Log eerst in om te delen');
      const { data, error } = await client.rpc(naam, args || {});
      if (error) {
        if (/function|schema cache/i.test(error.message || '') && (error.message || '').includes(naam)) {
          throw new Error('Voer eerst het bijgewerkte supabase/opzet.sql opnieuw uit in Supabase');
        }
        throw new Error(error.message || 'Er ging iets mis');
      }
      return data;
    },

    /** Een Edge Function aanroepen als ingelogde gebruiker. Geeft het JSON-antwoord. */
    async functie(naam, body) {
      if (!client || !gebruiker) throw new Error('Log eerst in om te delen');
      const { data: sessie } = await client.auth.getSession();
      const token = sessie && sessie.session ? sessie.session.access_token : '';
      const c = config();
      let antwoord;
      try {
        antwoord = await fetch(c.url + '/functions/v1/' + naam, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: c.sleutel, Authorization: 'Bearer ' + token },
          body: JSON.stringify(body || {})
        });
      } catch (fout) {
        throw new Error('De functie "' + naam + '" is niet bereikbaar. Staat ze in Supabase (zie MELDINGEN.md)?');
      }
      const data = await antwoord.json().catch(() => ({}));
      if (antwoord.status === 404 && !data.fout) throw new Error('De functie "' + naam + '" staat nog niet in Supabase (zie MELDINGEN.md).');
      if (antwoord.status === 401 && !data.fout) throw new Error('Supabase weigert: zet bij de functie "' + naam + '" de JWT-controle uit (zie MELDINGEN.md).');
      if (!antwoord.ok) throw new Error(data.fout || data.message || ('Foutcode ' + antwoord.status));
      return data;
    },

    /** Na elke lokale wijziging aanroepen. */
    gewijzigd() {
      if (!config()) return;
      zetSyncStaat({ wachtend: true });
      if (!gebruiker) return;
      clearTimeout(verzendTimer);
      verzendTimer = setTimeout(verstuur, 600);
    },

    status() { return status; },
    config() { return config(); },
    gebruiker() { return gebruiker; },

    zetConfig(url, sleutel) {
      url = String(url || '').trim().replace(/\/+$/, '');
      sleutel = String(sleutel || '').trim();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^https:\/\//i.test(url)) {
        throw new Error('De project-URL moet beginnen met https://');
      }
      if (sleutel.length < 20) throw new Error('Dat lijkt geen geldige sleutel');
      stopLuisteren();
      client = null;
      gebruiker = null;
      schrijfJson(CONFIG_SLEUTEL, { url: url, sleutel: sleutel });
      zetSyncStaat({ laatsteSync: null });
      zetStatus('afgemeld', 'Log in om te delen');
    },

    async wisConfig() {
      try { if (client) await client.auth.signOut(); } catch (e) { /* maakt niet uit */ }
      stopLuisteren();
      client = null;
      gebruiker = null;
      schrijfJson(CONFIG_SLEUTEL, null);
      zetSyncStaat({ laatsteSync: null, wachtend: false });
      zetStatus('uit', 'Niet gedeeld');
    },

    async inloggen(email, wachtwoord) {
      await maakClient();
      const { data, error } = await client.auth.signInWithPassword({ email: email, password: wachtwoord });
      if (error) throw vertaalAuthFout(error);
      gebruiker = data.user;
      await synchroniseer();
    },

    async registreren(email, wachtwoord) {
      await maakClient();
      const { data, error } = await client.auth.signUp({ email: email, password: wachtwoord });
      if (error) throw vertaalAuthFout(error);
      if (data.session) {
        gebruiker = data.user;
        await synchroniseer();
        return 'ingelogd';
      }
      return 'bevestigen'; // e-mailbevestiging staat aan in Supabase
    },

    async uitloggen() {
      stopLuisteren();
      if (client) await client.auth.signOut();
      gebruiker = null;
      zetStatus('afgemeld', 'Log in om te delen');
    },

    /** Link voor de partner: vult project-URL en sleutel automatisch in. */
    koppelLink() {
      const c = config();
      if (!c) return null;
      const code = btoa(JSON.stringify({ u: c.url, k: c.sleutel }));
      return location.origin + location.pathname + '#koppel=' + encodeURIComponent(code);
    },

    /** Leest een koppel-link uit het adres. Geeft true als er iets ingesteld werd. */
    leesKoppelLink() {
      if (!/koppel=/.test(location.hash)) return false;
      const ok = Sync.koppelVanTekst(location.hash);
      if (ok) history.replaceState(null, '', location.pathname + location.search);
      return ok;
    },

    /**
     * Koppel-link (of alleen de code) die geplakt werd, bv. in de app op het beginscherm.
     * Die app heeft op iPhone eigen opslag en kan geen link openen, dus plakken is de weg.
     */
    koppelVanTekst(tekst) {
      tekst = String(tekst || '').trim();
      const m = tekst.match(/koppel=([^&\s]+)/);
      const code = m ? m[1] : tekst;
      try {
        const c = JSON.parse(atob(decodeURIComponent(code)));
        if (!c || !c.u || !c.k) return false;
        Sync.zetConfig(c.u, c.k);
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  function vertaalAuthFout(fout) {
    const t = (fout && fout.message) || '';
    if (/Invalid login credentials/i.test(t)) return new Error('E-mailadres of wachtwoord klopt niet');
    if (/Email not confirmed/i.test(t)) return new Error('Bevestig eerst je e-mailadres via de mail van Supabase');
    if (/already registered/i.test(t)) return new Error('Dit e-mailadres heeft al een account: kies Inloggen');
    if (/Password should be/i.test(t)) return new Error('Kies een wachtwoord van minstens 6 tekens');
    if (/fetch|network/i.test(t)) return new Error('Geen verbinding met Supabase');
    return new Error(t || 'Er ging iets mis');
  }

  root.Sync = Sync;
})(window);
