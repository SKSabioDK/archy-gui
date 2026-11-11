// Talesyntese: TTS-motorer i et flow, og skift til en motor målet har.

const axios = require('axios');
const { addLog } = require('./log');
const { getToken } = require('./token');

// ── Talesyntese (TTS) ────────────────────────────────────────────────────────
// Et flow siger pr. sprog hvilken TTS-motor og stemme det taler med:
//
//   supportedLanguages:
//     da-dk:
//       textToSpeech:
//         Microsoft Azure:
//           voice: da-DK-ChristelNeural
//
// Har målet ikke motoren (fx ingen Azure-integration), afviser Archy hele
// importen. Det opdages nu før, og motoren kan skiftes til en målet har — med
// en stemme på samme sprog.

const TTS_DEFAULT = 'defaultEngine';

// [{ lang, engine, voice, engineLine, voiceLine }] — linjenumrene bruges ved omskrivning.
function scanTtsEngines(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  const out = [];
  let lang = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const sprog = l.match(/^([ \t]+)([a-z]{2,3}-[a-z0-9]{2,4}):[ \t]*$/i);
    if (sprog) { lang = sprog[2]; continue; }
    const tts = l.match(/^([ \t]+)textToSpeech:[ \t]*$/);
    if (!tts || !lang) continue;
    const ind = tts[1].length;
    const eng = (lines[i + 1] || '').match(/^([ \t]+)(.+?):[ \t]*$/);
    if (!eng || eng[1].length <= ind) continue;
    const v = (lines[i + 2] || '').match(/^([ \t]+)voice:[ \t]*["']?(.*?)["']?[ \t]*$/);
    const harStemme = v && v[1].length > eng[1].length;
    out.push({ lang, engine: eng[2].replace(/^["']|["']$/g, ''), voice: harStemme ? v[2] : null,
               engineLine: i + 1, voiceLine: harStemme ? i + 2 : null });
  }
  return out;
}

// De motorer flowet bruger, som målet ikke har. Standardmotoren findes altid.
function missingTtsEngines(entries, available) {
  const har = new Set((available || []).map(e => String(e.name).toLowerCase()));
  return [...new Set(entries.map(e => e.engine))]
    .filter(n => n !== TTS_DEFAULT && !har.has(n.toLowerCase()));
}

// Skifter motorer målet ikke har, til en det har, med en stemme på samme sprog.
// Genesys' egen motor foretrækkes. Uden en stemme på sproget røres linjen ikke,
// og sproget meldes — vi gætter ikke på en stemme der taler et andet sprog.
function replaceTtsEngines(yaml, available) {
  const eol = /\r\n/.test(yaml) ? '\r\n' : '\n';
  const lines = String(yaml).split(/\r?\n/);
  const motorer = [...(available || [])].sort((a, b) =>
    (/genesys/i.test(b.name) ? 1 : 0) - (/genesys/i.test(a.name) ? 1 : 0));
  const mangler = new Set(missingTtsEngines(scanTtsEngines(yaml), available));
  const changed = [], unresolved = [];
  // Nedefra og op: en indsat stemmelinje flytter ikke de linjer, der mangler.
  for (const e of scanTtsEngines(yaml).reverse()) {
    if (!mangler.has(e.engine)) continue;
    const lang = e.lang.toLowerCase();
    let valg = null;
    for (const m of motorer) {
      const st = (m.voices || []).find(v => String(v.language || '').toLowerCase() === lang);
      if (st) { valg = { engine: m.name, voice: st.name }; break; }
    }
    if (!valg) { unresolved.push({ lang: e.lang, engine: e.engine }); continue; }
    const ind = lines[e.engineLine].match(/^[ \t]*/)[0];
    lines[e.engineLine] = `${ind}${valg.engine}:`;
    if (e.voiceLine != null) {
      const vind = lines[e.voiceLine].match(/^[ \t]*/)[0];
      lines[e.voiceLine] = `${vind}voice: ${valg.voice}`;
    } else {
      lines.splice(e.engineLine + 1, 0, `${ind}  voice: ${valg.voice}`);
    }
    changed.unshift({ lang: e.lang, from: `${e.engine}${e.voice ? ' / ' + e.voice : ''}`, to: `${valg.engine} / ${valg.voice}` });
  }
  return { yaml: lines.join(eol), changed, unresolved: unresolved.reverse() };
}

// Motorerne og deres stemmer i målet.
async function targetTtsEngines(target) {
  const { token, apiBase } = await getToken(target);
  const ud = [];
  for (let page = 1; ; page++) {
    const r = await axios.get(`${apiBase}/api/v2/integrations/speech/tts/engines`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 100, pageNumber: page, includeVoices: true }
    });
    const e = r.data.entities || [];
    for (const m of e) ud.push({ name: m.name, voices: (m.voices || []).map(v => ({ name: v.name, language: v.language })) });
    if (e.length < 100) break;
  }
  return ud;
}

// Skriver TTS om i en importfil, hvis brugeren har valgt det. Returnerer den
// nye YAML og noterer i loggen og sporet hvad der blev skiftet.
async function applyTtsChoice(yaml, target, flowName, trail) {
  const r = replaceTtsEngines(yaml, await targetTtsEngines(target));
  for (const c of r.changed) {
    addLog('INFO', `TTS in "${flowName}" ${c.lang}: ${c.from} → ${c.to}`, target.name, 'MIGRATE');
    if (trail) trail.push(`↦ ${flowName} ${c.lang}: ${c.from} → ${c.to}`);
  }
  for (const u of r.unresolved) {
    addLog('WARN', `TTS in "${flowName}" ${u.lang}: ${target.name} has no voice for the language — "${u.engine}" kept`, target.name, 'MIGRATE');
    if (trail) trail.push(`⚠ ${flowName} ${u.lang}: ingen stemme på sproget i ${target.name}`);
  }
  return r.yaml;
}

module.exports = { TTS_DEFAULT, scanTtsEngines, missingTtsEngines, replaceTtsEngines,
  targetTtsEngines, applyTtsChoice };
