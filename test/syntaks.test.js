// Et enkelt forkert tegn i index.html — fx en apostrof der ikke er escapet i
// en fransk tekst — stopper HELE scriptet, og programmet står dødt uden at
// nogen af de andre tests opdager det. Denne test oversætter hvert inline
// <script> uden at køre det.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('alle inline-scripts i index.html kan oversættes', () => {
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, antal = 0;
  while ((m = re.exec(HTML)) !== null) {
    antal++;
    const linje = HTML.slice(0, m.index).split('\n').length;
    assert.doesNotThrow(() => new vm.Script(m[1], { filename: `index.html (script fra linje ${linje})` }),
      e => { throw new Error(`Syntaksfejl i script fra linje ${linje}: ${e.message}`); });
  }
  assert.ok(antal > 0);
});

test('hver af serverens filer kan oversættes', () => {
  const { serverFiler, kilde } = require('./kilde.js');
  const filer = serverFiler();
  assert.ok(filer.length > 20, 'fandt kun ' + filer.length + ' filer');
  for (const f of filer) {
    const src = kilde(f);
    assert.doesNotThrow(() => new vm.Script(`(function(require,module,exports,__dirname,__filename){${src}\n})`, { filename: f }), f);
  }
});
