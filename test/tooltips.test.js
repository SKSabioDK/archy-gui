// Tooltips hentes fra LANGS: data-tip="nøgle" på knapper bygget i JS, og
// tip_<data-i18n> på de statiske. En nøgle der ikke findes, giver ingen fejl —
// knappen står bare uden forklaring. Det er dét denne test fanger.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const da = HTML.slice(HTML.indexOf('  da: {'), HTML.indexOf('  en: {'));
const findes = k => new RegExp(`\\b${k}:'`).test(da);

test('hver data-tip peger på en tekst der findes', () => {
  const noegler = [...new Set([...HTML.matchAll(/data-tip="([a-z_]+)"/g)].map(m => m[1]))];
  assert.ok(noegler.length > 15, `fandt kun ${noegler.length} data-tip`);
  const mangler = noegler.filter(k => !findes(k));
  assert.deepEqual(mangler, [], 'data-tip uden tekst i LANGS:\n  ' + mangler.join('\n  '));
});

test('hver tip_-tekst hører til en knap', () => {
  // En tip til en knap der er fjernet eller omdøbt, er død tekst i fem sprog.
  const tips = [...da.matchAll(/\b(tip_[a-z_]+):'/g)].map(m => m[1]);
  const brugt = k => HTML.includes(`data-tip="${k}"`) || HTML.includes(`data-i18n="${k.slice(4)}"`)
    || HTML.includes(`dataset.i18n = '${k.slice(4)}'`);
  const doede = tips.filter(k => !brugt(k));
  assert.deepEqual(doede, [], 'tip_-tekster ingen knap bruger:\n  ' + doede.join('\n  '));
});

test('hvert ⓘ ved et felt har en forklaring og en etiket', () => {
  // data-fh på de statiske felter, fl('etiket', 'fh_…') i ⚙ Indstillinger.
  const statiske = [...HTML.matchAll(/data-fh="([a-z_]+)"/g)].map(m => m[1]);
  const par = [...HTML.matchAll(/fl\('([a-z_]+)', '([a-z_]+)'\)/g)];
  assert.ok(statiske.length >= 10, `fandt kun ${statiske.length} statiske ⓘ`);
  assert.ok(par.length >= 13, `fandt kun ${par.length} felter i ⚙ Indstillinger`);
  const mangler = [...statiske, ...par.flatMap(m => [m[1], m[2]])].filter(k => !findes(k));
  assert.deepEqual([...new Set(mangler)], [], 'nøgler uden tekst i LANGS:\n  ' + mangler.join('\n  '));
});
