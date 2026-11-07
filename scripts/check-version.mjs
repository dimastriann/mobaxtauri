import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const read = (path) => readFile(resolve(root, path), 'utf8');
const match = (content, pattern, label) => {
  const found = content.match(pattern);
  if (!found) throw new Error(`Could not find the version in ${label}`);
  return found[1];
};

const checks = [];

const packageJson = JSON.parse(await read('package.json'));
checks.push(['package.json', packageJson.version]);

const packageLock = JSON.parse(await read('package-lock.json'));
checks.push(['package-lock.json', packageLock.version]);
checks.push(['package-lock.json packages[""]', packageLock.packages[''].version]);

const tauriConf = JSON.parse(await read('src-tauri/tauri.conf.json'));
checks.push(['src-tauri/tauri.conf.json', tauriConf.version]);

const cargoToml = await read('src-tauri/Cargo.toml');
checks.push([
  'src-tauri/Cargo.toml',
  match(cargoToml, /^version\s*=\s*"([^"]+)"/m, 'src-tauri/Cargo.toml'),
]);

const cargoLock = await read('src-tauri/Cargo.lock');
const mobaxtauriBlock = cargoLock.match(/\[\[package\]\]\nname = "mobaxtauri"\nversion = "([^"]+)"/);
checks.push(['src-tauri/Cargo.lock', mobaxtauriBlock?.[1] ?? '']);

const settings = await read('src/components/SettingsModal.tsx');
checks.push([
  'src/components/SettingsModal.tsx',
  match(settings, /v(\d+\.\d+\.\d+)/, 'SettingsModal About'),
]);

const terminal = await read('src/components/Terminal.tsx');
checks.push([
  'src/components/Terminal.tsx',
  match(terminal, /v(\d+\.\d+\.\d+)/, 'Terminal banner'),
]);

const expected = checks[0][1];
const mismatches = checks.filter(([, version]) => version !== expected);

if (mismatches.length) {
  console.error(`Version mismatch: expected ${expected}`);
  for (const [file, version] of checks) {
    const suffix = version === expected ? '' : '  <-- mismatch';
    console.error(`  ${file}: ${version || '<missing>'}${suffix}`);
  }
  process.exit(1);
}

console.log(`Version ${expected} is consistent across ${checks.length} checks.`);
