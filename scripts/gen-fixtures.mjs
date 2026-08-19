#!/usr/bin/env node
/**
 * L-CAD-09: "fixtures are synthetic drawings authored by committed scripts".
 *
 * This is what makes that sentence checkable. Write mode runs every generator in
 * `fixtures/gen/` and records what came out; `--check` re-reads the tree and says
 * whether the record still holds. The record is a manifest rather than a comment
 * because the interesting failure is silent: a generator edited without its
 * fixture regenerated leaves a drawing in the tree that no committed script
 * produces any more, and the next converter change would be sanity-numbered
 * against a fixture nobody can reproduce.
 *
 * So each entry carries two digests — the fixture's and its generator's — and
 * `--check` is a pure hash comparison: it runs no Python, which is what lets it
 * sit inside the verify stage and inside `pnpm test` without paying for ezdxf and
 * reportlab on every run.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { repoRoot } from './lib/stage.mjs';

/**
 * The tree this run reads. The override exists so the drift check can be pointed
 * at a tampered copy of `fixtures/` — proving the check fires costs a scenario,
 * and a scenario must never be the real tree.
 */
const root = process.env['GEN_FIXTURES_ROOT']?.trim() || repoRoot;

const GEN_DIR = 'fixtures/gen';
const OUT_DIR = 'fixtures/gen/out';
const MANIFEST = 'fixtures/MANIFEST.json';

const check = process.argv.slice(2).includes('--check');

/** Repo-relative POSIX, so a manifest written on Windows reads the same here. */
const posixPath = (absolute) => relative(root, absolute).split(sep).join('/');

const digest = (absolute) => createHash('sha256').update(readFileSync(absolute)).digest('hex');

const lines = [];
const say = (line) => lines.push(line);

/** `gen_smoke_lines.py` -> `smoke_lines`, in filename order. */
function generators() {
  const directory = join(root, GEN_DIR);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => /^gen_.+\.py$/.test(entry))
    .sort()
    .map((file) => ({ file, name: file.replace(/^gen_/, '').replace(/\.py$/, '') }));
}

/** Every file a generator left behind, in filename order. */
function outputs() {
  const directory = join(root, OUT_DIR);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => statSync(join(directory, entry)).isFile())
    .sort();
}

/**
 * The generator a file came from: outputs are prefixed with their generator's
 * name, and the longest matching name wins so that a later `gen_smoke.py` cannot
 * quietly claim `smoke_lines.dxf` from `gen_smoke_lines.py`.
 */
function generatorOf(file, all) {
  return all
    .filter((generator) => file.startsWith(generator.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

function writeManifest() {
  const all = generators();
  for (const generator of all) {
    const script = join(root, GEN_DIR, generator.file);
    const result = spawnSync('uv', ['run', '--project', 'cad', '--group', 'fixtures', 'python', script], {
      cwd: root,
      stdio: 'inherit',
      // The generators' own determinism knob: see gen_smoke_lines.py — Python's
      // randomised string hashing reorders a DXF's OBJECTS section otherwise.
      env: { ...process.env, PYTHONHASHSEED: '0' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.stdout.write(`${GEN_DIR}/${generator.file} exited ${String(result.status)}\n`);
      process.exitCode = result.status ?? 1;
      return;
    }
  }

  const fixtures = [];
  for (const file of outputs()) {
    const generator = generatorOf(file, all);
    const fixture = join(root, OUT_DIR, file);
    if (generator === undefined) {
      process.stdout.write(`no generator owns ${OUT_DIR}/${file}\n`);
      process.exitCode = 1;
      return;
    }
    const script = join(root, GEN_DIR, generator.file);
    fixtures.push({
      path: posixPath(fixture),
      sha256: digest(fixture),
      generator: posixPath(script),
      generatorSha256: digest(script),
    });
  }
  fixtures.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // LF and a trailing newline, written whole: the manifest is committed, so its
  // bytes are as much a fixture as the drawings it describes.
  writeFileSync(join(root, MANIFEST), `${JSON.stringify({ fixtures }, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${MANIFEST} (${String(fixtures.length)} fixtures)\n`);
}

function checkManifest() {
  const manifestPath = join(root, MANIFEST);
  if (!existsSync(manifestPath)) {
    process.stdout.write(`MANIFEST_DRIFT ${MANIFEST} — no manifest in the tree\n`);
    process.exitCode = 1;
    return;
  }
  const recorded = JSON.parse(readFileSync(manifestPath, 'utf8')).fixtures ?? [];

  for (const entry of recorded) {
    const fixture = join(root, entry.path);
    if (!existsSync(fixture)) {
      say(`MANIFEST_DRIFT ${entry.path} — recorded in the manifest but missing from the tree`);
    } else if (digest(fixture) !== entry.sha256) {
      say(`MANIFEST_DRIFT ${entry.path} — sha256 is ${digest(fixture)}, the manifest records ${entry.sha256}`);
    }

    const script = join(root, entry.generator);
    if (!existsSync(script)) {
      say(`MANIFEST_DRIFT ${entry.path} — its generator ${entry.generator} is missing from the tree`);
    } else if (digest(script) !== entry.generatorSha256) {
      say(
        `MANIFEST_DRIFT ${entry.path} — its generator ${entry.generator} changed since this fixture was recorded; rerun pnpm gen:fixtures`,
      );
    }
  }

  const known = new Set(recorded.map((entry) => entry.path));
  for (const file of outputs()) {
    const path = `${OUT_DIR}/${file}`;
    if (!known.has(path)) say(`MANIFEST_DRIFT ${path} — in the tree but not recorded in ${MANIFEST}`);
  }

  if (lines.length > 0) {
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`manifest ok (${String(recorded.length)} fixtures)\n`);
}

if (check) checkManifest();
else writeManifest();
