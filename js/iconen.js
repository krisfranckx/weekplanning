/* Eenvoudige lijn-iconen (24x24, volgen de tekstkleur). Gebruik: Icoon('kalender'). */
(function (root) {
  'use strict';

  const PADEN = {
    terug: '<path d="m15 18-6-6 6-6"/>',
    verder: '<path d="m9 18 6-6-6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    zon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    kalender: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
    gezin: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16.5 14.6c2.4.2 4 1.9 4.5 4.6"/>',
    rugzak: '<path d="M8 6V5a4 4 0 0 1 8 0v1"/><rect x="4.5" y="6" width="15" height="15.5" rx="4"/><path d="M8.5 13h7v4.5h-7z"/>',
    school: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M10 21v-5h4v5"/><circle cx="12" cy="11" r="1.6"/>',
    activiteit: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="m9 15 2 2 4-4"/>',
    bestek: '<path d="M7 2v8M4 2v5a3 3 0 0 0 6 0V2M7 10v12"/><path d="M17 22V2c-2.2 0-4 2.7-4 6.5V14h4"/>',
    klok: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    vrij: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 13a3 3 0 0 0 .5 6z"/>',
    bel: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    vuilbak: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M5.5 6l1 14a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-14"/><path d="M10 11v6M14 11v6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    opslag: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    boek: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20"/>',
    terugdraaien: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    vinkje: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    vink: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    micro: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
    huis: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11.5h14V9"/><path d="M10 20.5v-6h4v6"/>',
    kantoor: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M3 13h18"/>',
    wolk: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 13a3 3 0 0 0 .5 6z"/>'
  };

  function Icoon(naam, klasse) {
    const pad = PADEN[naam] || '';
    return '<svg class="ic' + (klasse ? ' ' + klasse : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + pad + '</svg>';
  }

  root.Icoon = Icoon;
})(window);
