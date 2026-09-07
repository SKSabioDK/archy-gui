// Et manglende felt skal give en besked man kan handle på.
//
// /api/export brugte flowType før nogen havde set efter om den var der, og
// svarede derfor
//
//     500 Cannot read properties of undefined (reading 'toLowerCase')
//
// Det er en Node-fejl, ikke en forklaring: den siger hvad koden snublede over,
// ikke hvad man selv har glemt at sende.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

// ── Selve hjælperen ──────────────────────────────────────────────────────────

test('missingFields siger god for en fuldstændig krop', () => {
  assert.equal(s.missingFields({ flowName: 'X', flowType: 'WORKFLOW' }, ['flowName', 'flowType']), null);
});

test('missingFields navngiver det felt der mangler', () => {
  assert.equal(s.missingFields({ flowName: 'X' }, ['flowName', 'flowType']),
    'Missing or empty field: flowType');
});

test('missingFields navngiver dem alle, ikke bare den første', () => {
  assert.equal(s.missingFields({}, ['flowName', 'flowType']),
    'Missing or empty fields: flowName, flowType');
});

test('et felt der kun er mellemrum tæller som manglende', () => {
  assert.equal(s.missingFields({ flowName: '   ', flowType: 'W' }, ['flowName', 'flowType']),
    'Missing or empty field: flowName');
});

test('et felt af forkert type tæller som manglende', () => {
  // Et tal eller et objekt ville ryge videre til .toLowerCase() og kaste.
  for (const forkert of [42, null, {}, [], true]) {
    assert.equal(s.missingFields({ flowName: forkert, flowType: 'W' }, ['flowName', 'flowType']),
      'Missing or empty field: flowName', `${JSON.stringify(forkert)} slap igennem`);
  }
});

test('missingFields tåler at der slet ingen krop er', () => {
  for (const ingen of [undefined, null]) {
    assert.equal(s.missingFields(ingen, ['flowName']), 'Missing or empty field: flowName');
  }
});

// ── Ruten selv ───────────────────────────────────────────────────────────────

test('/api/export svarer 400 med feltnavnet, ikke 500 med en Node-fejl', async () => {
  const srv = await new Promise(res => { const h = s.app.listen(0, '127.0.0.1', () => res(h)); });
  try {
    const port = srv.address().port;
    const kald = (krop) => fetch(`http://127.0.0.1:${port}/api/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(krop)
    });

    for (const [krop, ventet] of [
      [{ customerId: 'x', flowName: 'X' }, 'Missing or empty field: flowType'],
      [{ customerId: 'x' }, 'Missing or empty fields: flowName, flowType'],
      [{ customerId: 'x', flowName: ' ', flowType: 'WORKFLOW' }, 'Missing or empty field: flowName'],
    ]) {
      const r = await kald(krop);
      assert.equal(r.status, 400, `${JSON.stringify(krop)} gav ${r.status}`);
      const d = await r.json();
      assert.equal(d.error, ventet);
      assert.ok(!/Cannot read properties/.test(d.error), 'en Node-fejl slap ud til brugeren');
    }

    // Er felterne der, men kunden ikke, er det kunden der er problemet.
    const r = await kald({ customerId: 'findes-ikke', flowName: 'X', flowType: 'WORKFLOW' });
    assert.equal(r.status, 404);
    assert.match((await r.json()).error, /Customer not found/);
  } finally {
    await new Promise(res => srv.close(res));
  }
});

test('en flowtype med mellemrum omkring bliver trimmet, ikke afvist', async (t) => {
  // ' WORKFLOW ' er en gyldig værdi med slør på. missingFields slipper den
  // igennem (den er jo ikke tom), og uden .trim() ville archyBareArg derefter
  // afvise den som "is not a valid name" — en besked der peger på det forkerte.
  //
  // Prøves mod et demo-miljø: kommandolinjen bygges, men Archy nås aldrig.
  const kunder = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'customers.json'), 'utf8')); }
    catch (_) { return []; }
  })();
  const demo = kunder.find(c => c.demo);
  if (!demo) return t.skip('intet demo-miljø i customers.json');

  const srv = await new Promise(res => { const h = s.app.listen(0, '127.0.0.1', () => res(h)); });
  try {
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: demo.id, flowName: 'Velkomst', flowType: '  WORKFLOW  ' })
    });
    const fejl = (await r.json()).error || '';
    // Den skal nå helt frem til demo-vagten — altså forbi opbygningen af
    // kommandolinjen — og ikke falde over sine egne mellemrum.
    assert.match(fejl, /demo environment/, `faldt før demo-vagten: ${fejl}`);
    assert.ok(!/is not a valid name/.test(fejl), 'flowtypen blev ikke trimmet');
  } finally {
    await new Promise(res => srv.close(res));
  }
});

// ── Ingen andre ruter har samme mønster ──────────────────────────────────────

test('intet felt fra req.body bruges før det er tjekket', () => {
  // Samme scanning der fandt /api/export. Den kan ikke se alt, men den fælder
  // netop dét mønster: et metodekald på en værdi der kan mangle.
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const L = SERVER.split(/\r?\n/);
  const METODER = 'toLowerCase|toUpperCase|trim|map|filter|split|replace|slice|includes|join|forEach|find';
  const fund = [];

  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^app\.(post|put|delete|patch)\('([^']+)'/);
    if (!m) continue;
    let krop = '', j = i;
    for (; j < L.length; j++) { krop += L[j] + '\n'; if (j > i && /^\}\);/.test(L[j])) break; }

    const d = krop.match(/const \{([^}]*)\} = req\.body/);
    if (!d) continue;

    for (const f of d[1].split(',').map(x => x.split('=')[0].trim()).filter(Boolean)) {
      const brug = new RegExp('(?<![.\\w?$])' + f + '\\.(' + METODER + ')\\b', 'g');
      for (const mm of krop.matchAll(brug)) {
        const før = krop.slice(0, mm.index);
        const tjekket = new RegExp(
          '!' + f + '\\b|typeof ' + f + '|' + f + '\\s*(\\|\\||&&|\\?\\?|\\?\\.)' +
          '|Array\\.isArray\\(' + f + '\\)' +
          "|missingFields\\([^)]*'" + f + "'"
        ).test(før);
        if (!tjekket) fund.push(`${m[2]}: ${f}.${mm[0].split('.')[1]}() (linje ${i + krop.slice(0, mm.index).split('\n').length})`);
      }
    }
  }
  assert.deepEqual([...new Set(fund)], [], 'utjekket felt fra req.body:\n  ' + fund.join('\n  '));
});

test('kontrol: scanneren læser faktisk ruterne', () => {
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const skrivende = (SERVER.match(/^app\.(post|put|delete|patch)\('/gm) || []).length;
  const medKrop = (SERVER.match(/const \{[^}]*\} = req\.body/g) || []).length;
  assert.ok(skrivende >= 25, `fandt kun ${skrivende} skrivende ruter`);
  assert.ok(medKrop >= 15, `fandt kun ${medKrop} ruter der læser req.body`);
});
