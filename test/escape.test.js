// Navne fra en Genesys-org går ind i brugerfladens HTML. Et flow der hedder
//
//     <img src=x onerror=…>
//
// ville køre som kode i vinduet, og vinduet kan kalde hele API'et — herunder
// /api/files/content og /api/customers. Der er 0 af 517 rigtige flownavne der
// indeholder de tegn i dag, så det er et hul der lukkes, ikke en fejl der
// rettes. Testen her holder det lukket.
//
// To slags steder, som ikke kan behandles ens:
//
//   HTML-tekst        <td>${f.name}</td>              → escapeHtml
//   JS i en attribut  onclick="fn('${f.name}')"       → jsAttr
//
// jsAttr findes fordi escapeHtml IKKE er nok i en attribut: HTML-parseren
// afkoder &#39; tilbage til ' før JS ser strengen, og så er man ude af
// strengen igen.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const KLIENT = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const LINJER = KLIENT.split(/\r?\n/);

// Felter der bærer tekst fra en org eller fra en formular. Id'er, tal, farver
// og faste værdier står bevidst udenfor — de kan ikke indeholde markup.
const UTRYGT = /\b(name|flowName|fileName|customerName|actionName|tableName|tenant|group|prefix|orgLabel|division|region|error|message|category|varName|resultVar|jsonVar|lookupValue|extraYaml|content|environment)\b/;

// Efterset i hånden: alle giver en fast streng, ikke tekst fra en org.
//   tt==='group'?…            transfer-type fra en lukket liste
//   prefix / prefix==='ia'?…  'ia' eller 'dc', sat af koden selv
const KENDTE_UNDTAGELSER = new Set([
  "tt==='group'?'selected':''",
  'prefix',
  "prefix==='ia'?'wiz.initialAudioType':'wiz.disconnectAudioType'"
]);

function fund() {
  const tekst = [], attr = [];
  for (let i = 0; i < LINJER.length; i++) {
    const l = LINJER[i];
    if (!l.includes('${') || /^\s*\/\//.test(l)) continue;
    // Kun linjer der faktisk laver HTML
    if (!/[<>]/.test(l) && !/on\w+=|value=|placeholder=|title=|data-\w+=/.test(l)) continue;

    for (const m of l.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const u = m[1].trim();
      if (!UTRYGT.test(u)) continue;
      if (KENDTE_UNDTAGELSER.has(u)) continue;
      if (/^(escapeHtml|jsAttr|t)\(/.test(u)) continue;
      if (u.includes('escapeHtml') || u.includes('jsAttr')) continue;
      if (u.includes('<') || u.includes('`')) continue;   // producerer selv markup
      const iAttrJs = /on\w+="[^"]*$/.test(l.slice(0, m.index));
      (iAttrJs ? attr : tekst).push(`linje ${i + 1}: \${${u.slice(0, 70)}}`);
    }
  }
  return { tekst, attr };
}

test('ingen utryg værdi går uescapet ind i HTML-tekst', () => {
  const { tekst } = fund();
  assert.deepEqual(tekst, [], 'mangler escapeHtml:\n  ' + tekst.join('\n  '));
});

test('ingen utryg værdi går uescapet ind i en onclick', () => {
  const { attr } = fund();
  assert.deepEqual(attr, [], 'mangler jsAttr:\n  ' + attr.join('\n  '));
});

test('de hjemmelavede escapes er væk', () => {
  // Der var seks forskellige: .replace(/</g,'&lt;'), .replace(/"/g,'&quot;')
  // og &apos;. Hver dækkede ét tegn, og hvilket ét afhang af hvem der skrev
  // linjen. escapeHtml dækker & < > " ' — alle steder.
  for (const hjemmelavet of [
    String.raw`replace(/</g,'&lt;')`,
    String.raw`replace(/"/g,'&quot;')`,
    '&apos;'
  ]) {
    assert.ok(!KLIENT.includes(hjemmelavet), `hjemmelavet escape tilbage: ${hjemmelavet}`);
  }
});

test('kontrol: scanneren finder faktisk noget at kigge på', () => {
  // Uden dette ville de tre ovenstående bestå i tavshed hvis mønstret holdt op
  // med at matche.
  assert.ok((KLIENT.match(/escapeHtml\(/g) || []).length > 100, 'for få escapeHtml-kald til at ligne konsekvent brug');
  assert.ok((KLIENT.match(/jsAttr\(/g) || []).length >= 6, 'jsAttr bruges ikke i attributterne');
  assert.match(KLIENT, /function jsAttr\(/, 'jsAttr findes ikke');
});

// De to funktioner hentes UD AF index.html og køres som de er. En kopi her i
// filen ville bestå selvom nogen ændrede den rigtige — det viste en
// mutationskørsel, hvor jsAttr holdt op med at JSON-kode uden at fælde noget.
const { escapeHtml, jsAttr } = (() => {
  const hent = (navn) => {
    const start = KLIENT.indexOf(`function ${navn}(`);
    assert.ok(start > 0, `fandt ikke ${navn} i index.html`);
    const slut = KLIENT.indexOf('\n}', start);
    return KLIENT.slice(start, slut + 2);
  };
  const boks = {};
  new Function('ud',
    hent('escapeHtml') + hent('jsAttr') +
    '\nud.escapeHtml = escapeHtml; ud.jsAttr = jsAttr;')(boks);
  return boks;
})();

test('jsAttr overlever et flownavn med apostrof', () => {
  // Sådan et navn brød onclick-handleren før — uden ondsindet hensigt.
  const ud = jsAttr("Kunde's flow");
  assert.equal(ud, '&quot;Kunde&#39;s flow&quot;');
  // Sådan ser attributten ud efter HTML-afkodning: fn("Kunde's flow")
  const afkodet = ud.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.equal(afkodet, '"Kunde\'s flow"');
  assert.doesNotThrow(() => JSON.parse(afkodet));
  assert.equal(JSON.parse(afkodet), "Kunde's flow");
});

test('jsAttr lukker et anførselstegn og en scriptstump inde', () => {
  for (const ondt of ['a" onerror="alert(1)', '</script><img src=x onerror=alert(1)>', "'); alert(1); ('"]) {
    const ud = jsAttr(ondt);
    // Hverken attributten eller HTML-parseren kan brydes: alle fire tegn er væk.
    assert.ok(!/[<>"']/.test(ud), `${ondt} slap igennem som ${ud}`);
    const afkodet = ud.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(JSON.parse(afkodet), ondt, 'værdien skal komme uskadt frem til funktionen');
  }
});
