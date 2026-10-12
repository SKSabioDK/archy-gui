// Miljøkortet: slet-knappen er en skraldespand (ikke et X, der ligner "luk"), og
// opsætningsguiden er til at få øje på og tilbydes når den ikke er gennemgået.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('slet-knappen på miljøkortet er et skraldespandsikon med en tekst til skærmlæsere', () => {
  const linje = HTML.split('\n').find(l => l.includes("onclick=\"deleteCustomer('${c.id}')\""));
  assert.ok(linje, 'fandt ikke slet-knappen');
  assert.ok(linje.includes('<svg'), 'slet-knappen skal være et ikon');
  assert.ok(linje.includes('aria-label'), 'ikonet skal have en tekst til skærmlæsere');
  assert.ok(!linje.includes('>✕<'), 'et X ligner en luk-knap');
});

test('guidens tekster findes på alle fem sprog', () => {
  const nøgler = ['btn_guide', 'card_guide_todo', 'card_guide_done',
                  'guide_prompt_text', 'guide_prompt_open', 'guide_prompt_later', 'guide_prompt_never'];
  for (const k of nøgler) {
    const n = HTML.split('\n').filter(l => l.startsWith(`    ${k}:`)).length;
    assert.equal(n, 5, `${k} skal stå på da, en, fr, nl og es — fandt ${n}`);
  }
});
