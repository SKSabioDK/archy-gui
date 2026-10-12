// Tavlen følger med de andre pc'er ved at spørge til et fingeraftryk af
// manifest-tabellen. Det skal ændre sig når en række ændres — og kun da.

const test = require('node:test');
const assert = require('node:assert/strict');
const { manifestSignature } = require('../server.js');

const rows = () => ({
  'Betaling|INBOUNDCALL': { flowName: 'Betaling', version: '5.0', publishedAt: 100, at: 1000 },
  'Velkomst|INBOUNDCALL': { flowName: 'Velkomst', version: '2.0', publishedAt: 200, at: 2000, releases: [{ id: 'a' }] }
});

test('samme rækker giver samme fingeraftryk, uanset rækkefølge', () => {
  const a = rows();
  const b = {}; for (const k of Object.keys(a).reverse()) b[k] = a[k];
  assert.equal(manifestSignature(a), manifestSignature(b));
});

test('en ny udgave, en ny række eller en ny release ændrer fingeraftrykket', () => {
  const grund = manifestSignature(rows());
  const ny = rows(); ny['Betaling|INBOUNDCALL'].version = '6.0'; ny['Betaling|INBOUNDCALL'].at = 3000;
  assert.notEqual(manifestSignature(ny), grund);
  const flere = rows(); flere['Ny|BOT'] = { flowName: 'Ny', version: '1.0', at: 4000 };
  assert.notEqual(manifestSignature(flere), grund);
  const rel = rows(); rel['Velkomst|INBOUNDCALL'].releases.push({ id: 'b' });
  assert.notEqual(manifestSignature(rel), grund);
});

test('ingen tabel har sit eget fingeraftryk', () => {
  assert.equal(manifestSignature(null), 'none');
  assert.notEqual(manifestSignature({}), 'none');
});
