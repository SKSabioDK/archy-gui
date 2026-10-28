// Fejlrapporter og ønsker bliver til forudfyldte GitHub-issues i brugerens
// browser, og en ugentlig scanning melder fund som en issue. Testen holder dem sammen.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../server.js');

const rod = path.join(__dirname, '..');
const laes = f => fs.readFileSync(path.join(rod, f), 'utf8');
const HTML = laes('public/index.html');

test('kun et gyldigt owner/repo bruges som mål for issues', () => {
  assert.match('skndkprivat/ArchyGUI', s.ISSUE_REPO_RE);
  for (const x of ['', 'a', 'a/b/c', 'a/b?x=1', 'https://evil.example/x', 'a b/c', '../x'])
    assert.doesNotMatch(x, s.ISSUE_REPO_RE, x);
  assert.equal(s.issueRepo(), 'skndkprivat/ArchyGUI');
});

test('serveren udleverer oplysninger til rapporten, ingen hemmeligheder', () => {
  assert.match(laes('server.js'), /app\.get\('\/api\/report-info'/);
  const dialog = HTML.slice(HTML.indexOf('async function openIssue'), HTML.indexOf('function issDownloadLog'));
  assert.ok(dialog.length > 500, 'dialogen findes ikke');
  assert.doesNotMatch(dialog, /clientSecret|authToken/);
});

test('dialogen åbner GitHub uden token og holder adressen under grænsen', () => {
  assert.match(HTML, /github\.com\/\$\{issInfo\.repo\}\/issues\/new/);
  assert.match(HTML, /ISS_URL_BUDGET = \d+/);
  assert.match(HTML, /window\.open\(url, '_blank', 'noopener'\)/);
  assert.doesNotMatch(HTML, /api\.github\.com/, 'ingen kald til GitHubs API fra appen');
  assert.match(HTML, /onclick="openIssue\('bug'\)"/);
  assert.match(HTML, /onclick="openIssue\('idea'\)"/);
});

test('teksterne til rapporter og ønsker findes på alle seks sprog', () => {
  for (const k of ['link_bug', 'link_idea', 'head_bug', 'head_idea', 'f_desc_bug', 'f_desc_idea', 'ph_bug', 'ph_idea', 'f_title', 'f_log', 'dl', 'open',
    'note_bug', 'note_idea', 'need_title', 'no_info', 'too_long', 'opened', 'opened_copied', 'b_version', 'b_page', 'b_lang', 'b_browser', 'b_log', 'b_trimmed', 'b_screens'])
    assert.equal(HTML.split('iss_' + k + ':').length - 1, 6, k);
});

test('den ugentlige scanning findes og kører npm audit og testene', () => {
  const wf = laes('.github/workflows/security.yml');
  assert.match(wf, /cron:/);
  assert.match(wf, /npm audit --omit=dev/);
  assert.match(wf, /npm test/);
  assert.match(wf, /issues: write/);
  assert.match(laes('.github/dependabot.yml'), /package-ecosystem: npm/);
});
