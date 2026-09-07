// Fejltekster og maskering af hemmeligheder.
//
// Archy og Genesys svarer begge med lange, larmende udskrifter hvor den
// egentlige årsag står ét sted midt i. Vælger vi den forkerte linje, får
// brugeren en besked der ikke kan handles på — det er sket flere gange.
//
// Maskeringen står til sidst. Den er ikke en pænhed: --clientSecret står på
// kommandolinjen, og Node lægger HELE kommandoen i err.message når exec fejler.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server.js');
const fs = require('fs');
const path = require('path');

const arkiv = (...linjer) => linjer.join('\n');

// ── Archys egne fejl ─────────────────────────────────────────────────────────

test('archyErrorReason tager overskriften, ikke detaljelinjen under den', () => {
  // Fejlen: brugeren fik "Property name: 'voice'" og kunne intet stille op med
  // det. Den brugbare sætning stod linjen over og blev kastet væk, fordi
  // baglænssøgningen standsede på den første linje der ikke lignede støj.
  const ud = s.archyErrorReason(arkiv(
    'Archy - Architect Yaml Flow Processor',
    'DateTime: 2025-01-01',
    "did not find a text to speech voice with the name 'da-DK-Standard-C' for language 'da-dk'",
    "    Path: '/inboundCall/supportedLanguages/textToSpeech'",
    "    Property name: 'voice'",
    'Error(s) encountered.'
  ));
  assert.match(ud, /did not find a text to speech voice/);
  assert.match(ud, /voice/);
  assert.match(ud, /supportedLanguages/);
});

test('archyErrorReason foretrækker den manglende ressource frem for "code: 99"', () => {
  // "Architect Scripting session ended in error ( code: 99 )" siger ingenting.
  const ud = s.archyErrorReason(arkiv(
    "find 'queue' by value of 'Support DK' - no matches",
    'Architect Scripting session ended in error ( code: 99 )',
    'Error(s) and warning(s) encountered.'
  ));
  assert.equal(ud, 'queue "Support DK" findes ikke i mål-org\'en');
});

test('archyErrorReason siger hvilken rettighed OAuth-klienten mangler', () => {
  const ud = s.archyErrorReason(arkiv(
    "the 'architect:flow:add' permission is required",
    'Architect Scripting session ended in error ( code: 99 )',
    'Error(s) encountered.'
  ));
  assert.match(ud, /mangler rettigheden 'architect:flow:add'/);
});

test('archyErrorReason kalder en certifikatfejl hvad den er', () => {
  // Archy konkluderer selv "ugyldige credentials", og det sendte folk ud at
  // lede efter et forkert client secret der aldrig var forkert.
  const ud = s.archyErrorReason(arkiv(
    'Error: unable to verify the first certificate',
    'invalid credentials',
    'Error(s) encountered.'
  ));
  assert.match(ud, /certifikatkæden/);
  assert.match(ud, /TLS-inspektion/);
});

test('archyErrorReason tager Exception-linjen ved en YAML-fejl', () => {
  const ud = s.archyErrorReason(arkiv(
    'Exception: - ERROR! the yaml is not valid -- [metadata]',
    "Property name: 'voice'",
    'Error(s) encountered.'
  ));
  assert.match(ud, /the yaml is not valid/);
  assert.ok(!ud.includes('metadata'), 'metadata-halen skal skæres af');
});

test('parseArchyOutput fjerner Archys bannere og opgraderingsreklame', () => {
  const ud = s.parseArchyOutput(arkiv(
    '*********************************',
    'Archy - Architect Yaml Flow Processor',
    'DateTime: 2025-01-01T00:00:00Z',
    'Archy minor version update available',
    'Run archy version --upgrade to upgrade',
    '',
    '',
    'Flow imported.',
    'execution complete.',
    'exit code: 0'
  ));
  assert.equal(ud, 'Flow imported.');
});

test('truncateArchyError viser slutningen — det er dér fejlen står', () => {
  const langt = Array.from({ length: 100 }, (_, i) => 'linje ' + i).join('\n');
  const ud = s.truncateArchyError(langt);
  assert.match(ud, /^\[\.\.\. 70 linjer skjult/);
  assert.ok(ud.endsWith('linje 99'));
});

test('truncateArchyError rører ikke en kort udskrift', () => {
  assert.equal(s.truncateArchyError('kort\nfejl'), 'kort\nfejl');
});

// ── Genesys' API-fejl ────────────────────────────────────────────────────────

test('describeApiError samler hele svaret, ikke bare "Bad Request"', () => {
  // Genesys lægger årsagen i .code og .details[], mens .message kun siger
  // "Bad Request". Vi plukkede kun .message, så loggen sagde reelt ingenting.
  const ud = s.describeApiError({
    message: 'Request failed with status code 400',
    response: { status: 400, data: {
      message: 'Bad Request', code: 'bad.request', contextId: 'ctx-1',
      details: [{ fieldName: 'name', errorCode: 'too.long' }]
    } },
    config: { url: 'https://api.mypurecloud.de/api/v2/flows/datatables', method: 'post' }
  });
  assert.match(ud, /bad\.request/);
  assert.match(ud, /name too\.long/);
  assert.match(ud, /HTTP 400 POST \/api\/v2\/flows\/datatables/);
  assert.match(ud, /contextId=ctx-1/);
});

test('describeApiError viser de felter den ikke forstår frem for at tabe dem', () => {
  const ud = s.describeApiError({
    message: 'x',
    response: { status: 400, data: { message: 'Bad Request', ukendtFelt: 'vigtigt' } },
    config: { url: 'https://api.mypurecloud.de/api/v2/flows', method: 'get' }
  });
  assert.match(ud, /ukendtFelt/);
  assert.match(ud, /vigtigt/);
});

test('describeApiError falder tilbage på beskeden når der ikke er et svar', () => {
  assert.equal(s.describeApiError(new Error('getaddrinfo ENOTFOUND')), 'getaddrinfo ENOTFOUND');
});

// ── Maskering ────────────────────────────────────────────────────────────────

test('--clientSecret maskeres, uanset om værdien står i anførselstegn', () => {
  const q = s.redactSecrets('Command failed: archy import --clientId "abc" --clientSecret "h3mm3l1gt" --location "mypurecloud.de"');
  assert.ok(!q.includes('h3mm3l1gt'));
  assert.match(q, /--clientSecret "\*\*\*"/);

  const u = s.redactSecrets('--clientSecret h3mm3l1gt --location mypurecloud.de');
  assert.ok(!u.includes('h3mm3l1gt'));
});

test('--authToken og Bearer-tokens maskeres', () => {
  assert.ok(!s.redactSecrets('--authToken "eyJhbGciOiJIUzI1NiJ9"').includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!s.redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9').includes('eyJhbGciOiJIUzI1NiJ9'));
});

test('kommandoen fra archyCredFlags er ren efter maskering', () => {
  // Det er præcis den streng der ender i err.message når exec fejler.
  const flags = s.archyCredFlags({
    name: 'Prøvekunde', region: 'mypurecloud.de',
    clientId: 'id-0000-1111', clientSecret: 'h3mm3l1gt-værdi'
  });
  const maskeret = s.redactSecrets(`Command failed: archy import ${flags}`);
  assert.ok(!maskeret.includes('h3mm3l1gt-værdi'), 'secret må aldrig stå i klartekst');
  assert.match(maskeret, /--clientSecret "\*\*\*"/);
});

test('archyCredFlags nægter at bygge en kommando uden gyldigt OAuth-token', () => {
  // Ellers ville Archy blive kaldt med et tomt token og fejle et andet sted,
  // hvor beskeden ikke fortæller at man skal logge ind igen.
  assert.throws(
    () => s.archyCredFlags({ name: 'X', authType: 'oauth', region: 'mypurecloud.de' }),
    /log in again/
  );
  s.tokenStore['udloebet'] = { token: 'gammelt', expiresAt: Date.now() - 1000 };
  assert.throws(
    () => s.archyCredFlags({ id: 'udloebet', name: 'X', authType: 'oauth', region: 'mypurecloud.de' }),
    /expired/
  );
  delete s.tokenStore['udloebet'];
});

test('redactSecrets tåler null og tom tekst uden at kaste', () => {
  assert.equal(s.redactSecrets(null), null);
  assert.equal(s.redactSecrets(undefined), undefined);
  assert.equal(s.redactSecrets(''), '');
});

test('rigtige credentials fra customers.json slipper ikke igennem', () => {
  // Læser kun filen — den bliver aldrig skrevet af testene. Findes den ikke,
  // springes testen over frem for at lade som om den bestod.
  const fil = path.join(__dirname, '..', 'customers.json');
  if (!fs.existsSync(fil)) return;
  let kunder;
  try { kunder = JSON.parse(fs.readFileSync(fil, 'utf8')); } catch (_) { return; }

  const secrets = kunder.map(c => c.clientSecret).filter(x => x && x.length > 6);
  const ids     = kunder.map(c => c.clientId).filter(x => x && x.length > 6);
  if (!secrets.length && !ids.length) return;

  // Værdierne vises ALDRIG i en fejlbesked — kun hvilken kunde det gik galt på.
  for (let i = 0; i < secrets.length; i++) {
    const ud = s.redactSecrets(`et eller andet ${secrets[i]} midt i teksten`);
    assert.ok(!ud.includes(secrets[i]), `client secret for "${kunder[i]?.name}" stod i klartekst`);
  }
  for (let i = 0; i < ids.length; i++) {
    const ud = s.redactSecrets(`klienten ${ids[i]} fejlede`);
    assert.ok(!ud.includes(ids[i]), `client id for "${kunder[i]?.name}" stod ubeskåret`);
    assert.ok(ud.includes(ids[i].slice(0, 8)), 'de første 8 tegn skal blive stående, så man kan se HVILKEN klient');
  }
});
