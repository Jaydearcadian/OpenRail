#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkDir = resolve(__dirname, '..');
const repoRoot = resolve(sdkDir, '..');

const requiredEnv = [
  'PAYER_PRIVATE_KEY',
  'PACKAGE_ID',
  'PAYER_COIN_OBJECT_ID',
  'PAYER_GAS_COIN_OBJECT_ID',
  'FUNDING_COIN_OBJECT_ID',
];

const optionalEnv = [
  'RECIPIENT_PRIVATE_KEY',
  'MERCHANT_PRIVATE_KEY',
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function isPlaceholder(value) {
  return !value || value.startsWith('REPLACE_WITH') || value.includes('<');
}

function status(label, ok, detail = '') {
  const mark = ok ? '✓' : '!';
  console.log(`${mark} ${label}${detail ? `: ${detail}` : ''}`);
}

console.log('\nOpenRails testnet preflight (read-only)\n');

const suiVersion = run('sui', ['--version']);
status('sui CLI available', suiVersion.ok, suiVersion.ok ? suiVersion.stdout : 'install with suiup before publishing');

if (suiVersion.ok) {
  const activeEnv = run('sui', ['client', 'active-env']);
  status('sui active env readable', activeEnv.ok, activeEnv.ok ? activeEnv.stdout : activeEnv.stderr);
  status('sui active env is testnet', activeEnv.ok && activeEnv.stdout === 'testnet', activeEnv.ok ? (activeEnv.stdout === 'testnet' ? 'testnet' : `currently ${activeEnv.stdout}; run: sui client switch --env testnet`) : 'unreadable');

  const activeAddress = run('sui', ['client', 'active-address']);
  status('sui active address readable', activeAddress.ok, activeAddress.ok ? activeAddress.stdout : activeAddress.stderr);
}

const distIndex = resolve(sdkDir, 'dist', 'index.js');
status('SDK dist/index.js exists', existsSync(distIndex), existsSync(distIndex) ? distIndex : 'run: cd sdk && npm run build');

console.log('\nEnvironment variables');
for (const name of requiredEnv) {
  const value = process.env[name];
  if (name.endsWith('PRIVATE_KEY')) {
    status(`${name} set`, Boolean(value), value ? 'value hidden' : 'missing');
  } else {
    status(`${name} configured`, Boolean(value) && !isPlaceholder(value), value ? (isPlaceholder(value) ? 'placeholder' : 'set') : 'missing');
  }
}

for (const name of optionalEnv) {
  status(`${name} optional`, Boolean(process.env[name]), process.env[name] ? 'set, value hidden' : 'not set, demo will use payer-sponsored ephemeral wallet');
}

console.log('\nExact next commands');
console.log(`
# Local validation
cd ${repoRoot}/sdk && npm run build && node scripts/tier1.mjs
cd ${repoRoot}/move && sui move build && sui move test

# Publish to testnet after local validation succeeds
sui client switch --env testnet
cd ${repoRoot}/move && sui client publish --gas-budget 100000000

# Export env vars in your shell only, do not write secrets to .env
export PAYER_PRIVATE_KEY='<exportedPrivateKey from sui keytool export>'
export PACKAGE_ID='0x<PackageID from publish output>'
export PAYER_COIN_OBJECT_ID='0x<payer SUI coin object for vault allocation>'
export PAYER_GAS_COIN_OBJECT_ID='0x<second payer SUI coin object for RailsCard gas reserve>'
export FUNDING_COIN_OBJECT_ID='0x<payer SUI coin object for RailsFlow funding>'
# Optional funded-wallet proof runs:
# export RECIPIENT_PRIVATE_KEY='<funded recipient exportedPrivateKey>'
# export MERCHANT_PRIVATE_KEY='<funded merchant exportedPrivateKey>'

# RailsCard proof, sponsors ephemeral or unfunded recipient unseal by default
cd ${repoRoot}/sdk && npx ts-node --esm --project tsconfig.json ../examples/railscard-demo.ts

# RailsFlow proof, sponsors ephemeral or unfunded merchant claim by default
cd ${repoRoot}/sdk && npx ts-node --esm --project tsconfig.json ../examples/railsflow-demo.ts

# Inspect proof transactions
sui client tx-block <digest> --show-events --show-object-changes --show-effects
# Explorer: https://suiexplorer.com/txblock/<digest>?network=testnet
`);

console.log('Preflight complete. This script did not publish, write secrets, or modify files.');
