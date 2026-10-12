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
                  'guide_prompt_text', 'guide_prompt_open', 'guide_prompt_later', 'guide_prompt_never',
                  'pl_mf_missing', 'gd_optional'];
  for (const k of nøgler) {
    const n = HTML.split('\n').filter(l => l.startsWith(`    ${k}:`)).length;
    assert.equal(n, 5, `${k} skal stå på da, en, fr, nl og es — fandt ${n}`);
  }
});

test('kortet regner ikke et miljø for gennemgået fordi org\'en kender det', () => {
  const fn = HTML.slice(HTML.indexOf('function guideInfo('), HTML.indexOf('function guideCardLine('));
  assert.ok(fn.length > 100, 'fandt ikke guideInfo');
  assert.ok(!fn.includes('setupAt'), 'guideInfo må kun gå ud fra guidens punkter — ellers ser pc\'erne forskelligt');
  assert.ok(fn.includes('optional'), 'det valgfrie punkt skal ikke tælle med');
});

test('Hent hertil tilbyder versionsudligning, slået til fra start', () => {
  const stykke = HTML.slice(HTML.indexOf('let alignHtml'), HTML.indexOf("const titel = { promote: 'act_promote_title'"));
  assert.ok(stykke.length > 200, 'fandt ikke udligningen i boardAction');
  assert.ok(stykke.includes("kind === 'pull_here'"), 'udligningen skal også gælde Hent hertil');
  assert.ok(stykke.includes("kind === 'pull_here' ? ' checked'"), 'og være slået til fra start');
});
