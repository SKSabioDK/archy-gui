// Ruter: login med OAuth/PKCE og login-status.

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { addLog } = require('../lib/log');
const { loadCustomers } = require('../lib/customers');
const { OAUTH_REDIRECT_URI } = require('../lib/conventions');
const { REGION_MAP } = require('../lib/fields');
const { describeApiError } = require('../lib/helpers');
const { wrongOrg, tenantOf, stageOf, isDemo, orgOwnedElsewhere, rememberOrgId } = require('../lib/environments');
const { tokenStore, scheduleSessionSave, pkceStore, base64url } = require('../lib/sessions');
const { _mfTableCache, _whoCache } = require('../lib/token');
const { PROD_DEPLOY_WINDOW, checkDeployRights, missingLog } = require('../lib/prod-rights');
const { orgIdCache } = require('../lib/manifest');

const router = express.Router();

// ── OAuth / PKCE endpoints ───────────────────────────────────────────────────

// Step 1: Generate PKCE challenge and return the Genesys authorization URL
router.get('/api/auth/login/:id', (req, res) => {
  const customer = loadCustomers().find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  if (customer.authType !== 'oauth') return res.status(400).json({ error: 'Not an OAuth customer' });

  const verifier   = base64url(crypto.randomBytes(32));
  const challenge  = base64url(crypto.createHash('sha256').update(verifier).digest());
  pkceStore[customer.id] = { verifier };

  const apiBase    = REGION_MAP[customer.region] || `https://api.${customer.region}`;
  const loginBase  = apiBase.replace('api.', 'login.');
  const redirectUri = OAUTH_REDIRECT_URI;
  const url = `${loginBase}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(customer.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=${encodeURIComponent(customer.id)}` +
    // Er man logget ind i flere orgs, genbrugte Genesys ellers den husket
    // session — og login til miljø nr. 2 landede stille i org nr. 1.
    // prompt=login beder altid om et nyt login; target peger på den org
    // miljøet er kendt i. Callback'en tjekker org'en uanset hvad.
    `&prompt=login` +
    (customer.orgId ? `&target=${encodeURIComponent(customer.orgId)}` : '');

  addLog('INFO', `PKCE login initiated for ${customer.name}`, customer.name, 'CUSTOMER');
  res.json({ url });
});

// Step 2: Genesys redirects here with ?code=...&state=...
// Backend exchanges code for token (PKCE — no client secret needed)
router.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  const page = (ok, heading, body) => res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Archy GUI — Login</title>
<style>
  body{font-family:sans-serif;background:#0d0f14;color:#e8eaf0;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;flex-direction:column;gap:0}
  .card{background:#131620;border:1px solid #1f2433;border-radius:10px;padding:36px 44px;
        text-align:center;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
  h2{color:${ok?'#2ecc71':'#e74c3c'};margin:0 0 10px;font-size:22px}
  p{color:#6b7394;font-size:14px;margin:0;line-height:1.5}
  .sub{font-size:11px;color:#3a4060;margin-top:14px}
</style></head><body>
<div class="card">
  <div style="font-size:40px;margin-bottom:14px">${ok?'✅':'❌'}</div>
  <h2>${heading}</h2>
  <p>${body}</p>
  <p class="sub">Dette vindue lukker automatisk…</p>
</div>
<script>setTimeout(()=>window.close(),2500)</script>
</body></html>`);

  if (error) return page(false, 'Login failed', String(error).replace(/</g,'&lt;'));
  if (!code || !state) return page(false, 'Invalid response', 'No code or state received.');

  const customer = loadCustomers().find(c => c.id === state);
  if (!customer) return page(false, 'Unknown customer', `State: ${state}`);

  const pkce = pkceStore[state];
  if (!pkce) return page(false, 'Session expired', 'Please start the login again from Archy GUI.');
  delete pkceStore[state];

  const apiBase    = REGION_MAP[customer.region] || `https://api.${customer.region}`;
  const loginBase  = apiBase.replace('api.', 'login.');
  const redirectUri = OAUTH_REDIRECT_URI;

  try {
    const resp = await axios.post(
      `${loginBase}/oauth/token`,
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        code_verifier: pkce.verifier,
        client_id:     customer.clientId,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token, expires_in } = resp.data;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

    // Hvilken org landede login'et i? Det vælger brugeren på Genesys' side, og
    // med trusted orgs kan det være en kundes. Tokenet gemmes først når org'en
    // passer — ellers ville miljøet læse og skrive i den forkerte org.
    const me = await axios.get(`${apiBase}/api/v2/users/me`,
      { headers: { Authorization: `Bearer ${access_token}` }, params: { expand: 'organization' } });
    const org = me.data.organization || {};
    if (!org.id) throw new Error('Genesys did not say which org the login belongs to');
    if (wrongOrg(customer, org.id)) {
      delete tokenStore[customer.id];
      delete _whoCache[customer.id];
      addLog('ERROR', `PKCE login for ${customer.name} refused: ${me.data.name} logged into org "${org.name}" (${org.id}), ` +
        `but the environment belongs to org ${customer.orgId}`, customer.name, 'SECURITY');
      return page(false, 'Wrong organisation',
        `You logged into <b>${esc(org.name || org.id)}</b>, but <b>${esc(customer.name)}</b> belongs to another org ` +
        `(${esc(customer.orgId)}). The login was discarded — nothing was read or written.<br><br>` +
        `Log out of Genesys Cloud (or use a private window) and log in again, choosing the right organisation.`);
    }
    const owner = orgOwnedElsewhere(customer, org.id, loadCustomers());
    if (owner) {
      delete tokenStore[customer.id];
      delete _whoCache[customer.id];
      addLog('ERROR', `PKCE login for ${customer.name} refused: org "${org.name}" (${org.id}) belongs to ${owner.name} ` +
        `(tenant ${tenantOf(owner)}), not tenant ${tenantOf(customer)}`, customer.name, 'SECURITY');
      return page(false, 'Wrong organisation',
        `You logged into <b>${esc(org.name || org.id)}</b>, which is the org of <b>${esc(owner.name)}</b> ` +
        `— another customer than <b>${esc(customer.name)}</b>. The login was discarded — nothing was read or written.<br><br>` +
        `Log in again and choose the right organisation.`);
    }

    const expiresAt = Date.now() + ((expires_in || 86400) * 1000) - 60000;
    tokenStore[customer.id] = { token: access_token, expiresAt, orgId: org.id, orgName: org.name || '', loginAt: Date.now() };
    delete _whoCache[customer.id];
    // Manifest-tabellens id er slået op med det forrige login — måske i en anden org.
    delete _mfTableCache[customer.id];
    orgIdCache[customer.id] = org.id;
    rememberOrgId(customer, org.id);
    addLog('SUCCESS', `PKCE OAuth login succeeded for ${customer.name}: ${me.data.name} in org "${org.name}"`, customer.name, 'CUSTOMER');

    // I prod afgøres deploy-retten her, ved login — og kun her, så den altid
    // hviler på et frisk login og ikke på et døgngammelt token.
    let extra = '';
    if (stageOf(customer) === 'prod' && !isDemo(customer)) {
      let d;
      try { d = await checkDeployRights(customer); }
      catch (e) { d = { ok: false, who: '?', missing: [{ kind: 'lookup', value: describeApiError(e) }], checkedAt: Date.now() }; }
      tokenStore[customer.id].deploy = d;
      scheduleSessionSave();
      addLog(d.ok ? 'SUCCESS' : 'WARN',
        `Prod deploy rights for ${customer.name}: ${d.who} ${d.ok ? 'allowed' : 'denied — missing ' + d.missing.map(missingLog).join(', ')}`,
        customer.name, 'SECURITY');
      extra = d.ok
        ? `<br><br>🔓 ${esc(d.who)} may deploy to prod for ${PROD_DEPLOY_WINDOW / 60000} minutes.`
        : `<br><br>⛔ ${esc(d.who)} may NOT deploy to prod — missing ${esc(d.missing.map(missingLog).join(', '))}.`;
    }
    page(true, 'Logged in!', `Organisation: <b>${esc(org.name || org.id)}</b><br>` +
      'You can close this window and return to Archy GUI.' + extra);
  } catch (e) {
    const msg = e.response?.data?.description || e.response?.data?.error || e.message;
    addLog('ERROR', `PKCE token exchange failed for ${customer.name}: ${msg}`, customer.name, 'CUSTOMER');
    page(false, 'Token exchange failed', String(msg).replace(/</g,'&lt;'));
  }
});

// Status for alle OAuth-miljøer i ét kald. Sidebjælken og kundekortene skal
// vise hvem man er logget ind i, og med 200 kunder er ét kald pr. miljø for
// meget.
router.get('/api/auth/status', (req, res) => {
  const now = Date.now();
  const out = {};
  for (const c of loadCustomers()) {
    if (c.authType !== 'oauth') continue;
    const st = tokenStore[c.id];
    if (!st || now > st.expiresAt) { out[c.id] = { authenticated: false }; continue; }
    const o = { authenticated: true, expiresIn: Math.floor((st.expiresAt - now) / 1000), orgName: st.orgName || '' };
    if (stageOf(c) === 'prod' && st.deploy)
      o.deploy = { ok: st.deploy.ok, who: st.deploy.who, missing: st.deploy.missing,
                   expiresIn: Math.max(0, Math.floor((st.deploy.checkedAt + PROD_DEPLOY_WINDOW - now) / 1000)) };
    out[c.id] = o;
  }
  res.json(out);
});

// Token status check
router.get('/api/auth/status/:id', (req, res) => {
  const stored = tokenStore[req.params.id];
  if (!stored) return res.json({ authenticated: false });
  if (Date.now() > stored.expiresAt) {
    delete tokenStore[req.params.id];
    return res.json({ authenticated: false, expired: true });
  }
  const out = { authenticated: true, expiresIn: Math.floor((stored.expiresAt - Date.now()) / 1000), orgName: stored.orgName || '' };
  const env = loadCustomers().find(c => c.id === req.params.id);
  if (env && stageOf(env) === 'prod' && !isDemo(env) && stored.deploy) {
    const d = stored.deploy;
    out.deploy = { ok: d.ok, who: d.who, missing: d.missing,
                   expiresIn: Math.max(0, Math.floor((d.checkedAt + PROD_DEPLOY_WINDOW - Date.now()) / 1000)) };
  }
  res.json(out);
});

module.exports = { router };
