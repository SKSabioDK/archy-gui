// Serverens kildekode som tekst, til de tests der læser selve koden.
// src/server.js er kun indgangen; koden bor i config.js, lib/ og routes/.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Serverens egne filer, relativt til src/ — ikke de selvstændige moduler
// (ai-agent.js, ai-providers.js, terraform.js), som testene læser for sig.
function serverFiler() {
  const ud = ['server.js', 'config.js'];
  for (const dir of ['lib', 'routes']) {
    for (const f of fs.readdirSync(path.join(SRC, dir)).sort()) if (f.endsWith('.js')) ud.push(`${dir}/${f}`);
  }
  return ud;
}

const kilde = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Hele serveren som én tekst — til tjek der gælder alle filer: hvor mange gange
// noget står, alle addLog-kald, alle ruter, alle processer der startes.
const helServeren = () => serverFiler().map(kilde).join('\n');

// Teksten fra `fra` op til `til` (eller til slutningen). Fejler hvis en markør
// mangler eller `til` ikke står efter `fra` — så et udsnit aldrig stille bliver
// tomt eller hele filen, når koden flytter.
function udsnit(kode, fra, til) {
  const a = kode.indexOf(fra);
  if (a < 0) throw new Error(`Fandt ikke: ${fra}`);
  if (til === undefined) return kode.slice(a);
  const b = kode.indexOf(til, a + fra.length);
  if (b < 0) throw new Error(`Fandt ikke: ${til} — efter ${fra}`);
  return kode.slice(a, b);
}

module.exports = { SRC, serverFiler, kilde, helServeren, udsnit };
