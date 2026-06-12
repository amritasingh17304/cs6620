// local-test.mjs — runs the SAST scanner locally (FREE, no AWS needed).
// Proves the professor's scanner.js "brain" works before we deploy it.
// Usage:  node scripts/local-test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { scanCode } from '../src/sast/scanner.js';

const here = dirname(fileURLToPath(import.meta.url));
const samples = ['app-dev.js', 'app-staging.js', 'app-prod.js'];

console.log('SAST local scan — dev/staging/prod regression demo\n');
for (const name of samples) {
  const code = readFileSync(join(here, '..', 'samples', name), 'utf-8');
  const findings = scanCode(code, name);
  const high = findings.filter((v) => v.severity === 'HIGH').length;
  const med = findings.filter((v) => v.severity === 'MEDIUM').length;
  const low = findings.filter((v) => v.severity === 'LOW').length;
  console.log(`${name.padEnd(16)}  total=${findings.length}  HIGH=${high} MEDIUM=${med} LOW=${low}`);
  for (const v of findings) {
    console.log(`   [${v.severity}] ${v.name} (line ${v.line}) — ${v.description}`);
  }
  console.log('');
}
console.log('Notice: dev has many HIGH findings, staging far fewer, and prod');
console.log('re-introduces a HIGH "Hardcoded password" — that reappearing finding');
console.log('is the cross-environment REGRESSION the tracker is built to catch.');
