// Programmet skal køre på en Node.js-version med sikkerhedsrettelserne fra
// 21. oktober 2026 (22.23.4, 24.22.1, 26.12.1 eller nyere).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { nodeSecurityStatus } = require('../src/server.js');

test('rettede versioner godkendes', () => {
  for (const v of ['22.23.4', 'v22.24.0', '24.22.1', '24.23.0', '26.12.1', '27.0.0']) assert.equal(nodeSecurityStatus(v).ok, true, v);
});

test('ældre og ikke-vedligeholdte versioner afvises', () => {
  for (const v of ['18.20.4', '20.20.0', '22.23.3', '24.22.0', '25.3.0', '26.12.0']) assert.equal(nodeSecurityStatus(v).ok, false, v);
});

test('package.json og README kræver de rettede versioner', () => {
  const rod = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(rod, 'package.json'), 'utf8'));
  assert.match(pkg.engines.node, /22\.23\.4/);
  assert.match(pkg.engines.node, /24\.22\.1/);
  assert.match(pkg.engines.node, /26\.12\.1/);
  const readme = fs.readFileSync(path.join(rod, 'README.md'), 'utf8');
  assert.equal((readme.match(/24\.22\.1/g) || []).length >= 2, true, 'README nævner minimumsversionen på dansk og engelsk');
});

test('den ugentlige CI-kørsel tester på hver Node-hovedversion programmet tillader', () => {
  const rod = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(rod, 'package.json'), 'utf8'));
  const tilladte = [...pkg.engines.node.matchAll(/>=(\d+)\./g)].map(m => m[1]).sort();
  const wf = fs.readFileSync(path.join(rod, '.github', 'workflows', 'security.yml'), 'utf8');
  const matrix = (wf.match(/node:\s*\[([^\]]*)\]/) || [, ''])[1].match(/\d+/g) || [];
  assert.deepEqual(matrix.sort(), tilladte, 'matrixen i security.yml følger engines.node');
  assert.match(wf, /fail-fast: false/, 'én fejlende version må ikke skjule de andre');
});
