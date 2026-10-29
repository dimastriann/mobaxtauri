#!/usr/bin/env node
// Mirrors .agents/skills/<name>/SKILL.md into per-agent copies (.claude/skills).
// .agents/skills is the single source of truth: Codex and opencode read it
// directly; Claude Code needs its own .claude/skills copy.
// Usage: node scripts/sync-skills.mjs [--check]
//   --check: verify copies match the source; exit 1 on drift (CI mode).
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(import.meta.dirname, '..', '.agents', 'skills');
const TARGETS = [join(import.meta.dirname, '..', '.claude', 'skills')];
const check = process.argv.includes('--check');

const skillNames = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    (name) => statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, 'SKILL.md')),
  );
};

const fileMatches = (sourceFile, targetFile) =>
  Buffer.compare(readFileSync(sourceFile), readFileSync(targetFile)) === 0;

const sourceSkills = skillNames(SOURCE);
if (sourceSkills.length === 0) {
  console.error(`No skills found in ${SOURCE}`);
  process.exit(1);
}

const drift = [];
for (const target of TARGETS) {
  const targetSkills = skillNames(target);

  for (const stale of targetSkills.filter((name) => !sourceSkills.includes(name))) {
    if (check) {
      drift.push(`stale: ${join(target, stale)}`);
    } else {
      rmSync(join(target, stale), { recursive: true, force: true });
      console.log(`removed stale ${join(target, stale)}`);
    }
  }

  for (const name of sourceSkills) {
    const sourceFile = join(SOURCE, name, 'SKILL.md');
    const targetFile = join(target, name, 'SKILL.md');
    if (existsSync(targetFile) && fileMatches(sourceFile, targetFile)) continue;
    if (check) {
      drift.push(`out of sync: ${targetFile}`);
    } else {
      mkdirSync(join(target, name), { recursive: true });
      cpSync(sourceFile, targetFile);
      console.log(`synced ${targetFile}`);
    }
  }
}

if (check && drift.length > 0) {
  console.error('Skill copies drifted from .agents/skills; run npm run sync:skills:\n' + drift.join('\n'));
  process.exit(1);
}
console.log(check ? 'Skill copies are in sync.' : `Synced ${sourceSkills.length} skill(s).`);
