// Serveren gemmer loggens tid i UTC. Systemloggen viste den som den stod —
// "22:07" midt om natten dansk tid, to timer forkert — fordi visningen blot
// skar T og Z af. logTime omregner til maskinens egen tid.

process.env.TZ = 'Europe/Copenhagen';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const src = HTML.match(/function logTime\(iso\) \{[\s\S]*?\n\}/);
const logTime = new Function('escapeHtml', `${src[0]}; return logTime;`)(x => x);

test('loggens UTC-tid vises som dansk tid', () => {
  assert.equal(logTime('2026-09-25T22:07:01.123Z'), '2026-09-26 00:07:01');   // sommertid, +2
  assert.equal(logTime('2026-01-15T10:00:00.000Z'), '2026-01-15 11:00:00');   // vintertid, +1
});

test('en tid der ikke kan læses, vises som den er', () => {
  assert.equal(logTime('ukendt'), 'ukendt');
});

test('"I dag" betyder fra midnat, ikke de sidste 24 timer', () => {
  assert.match(HTML, /onclick="slQuick\('today'\)"/);
  assert.match(HTML, /setHours\(0, 0, 0, 0\)/);
});
