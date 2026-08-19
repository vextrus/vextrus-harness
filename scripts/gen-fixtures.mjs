#!/usr/bin/env node
/**
 * L-CAD-09: "fixtures are synthetic drawings authored by committed scripts".
 *
 * This is the two halves of that sentence made operable. `pnpm gen:fixtures`
 * reruns every `fixtures/gen/gen_<name>.py` and writes down what came out;
 * `--check` re-reads the tree and refuses when the record and the bytes have
 * drifted apart. The record is `fixtures/MANIFEST.json`: fixture path, its
 * sha256, the script that authored it, and that script's sha256.
 *
 * The generator hash is the point of the whole exercise. A fixture whose bytes
 * still match is not necessarily current — the script that made it may have
 * been edited without anyone rerunning it, and the next converter change would
 * then be sanity-checked (L-CAD-09) against a drawing nothing in the tree can
 * reproduce. Recording the script's hash turns that into a question `--check`
 * can answer.
 *
 * `--check` runs no generator: it is hashes only, so it is cheap enough to sit
 * inside `pnpm verify` and needs no Python at all.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The tree the manifest describes. It is an override rather than an argument
 * because the callers that move it are tests pointing the checker at a tampered
 * copy of `fixtures/`, and the verify stage passes its environment straight
 * through to the subprocess it runs.
 */
const root = resolve(process.env['GEN_FIXTURES_ROOT'] ?? repoRoot);

const genDir = join(root, 'fixtures', 'gen');
const outDir = join(genDir, 'out');
const manifestPath = join(root, 'fixtures', 'MANIFEST.json');

/** Repo-relative POSIX, so the manifest reads the same on every machine. */
const relative = (absolute) => absolute.slice(root.length + 1).split('\\').join('/');

const sha256 = (absolute) => createHash('sha256').update(readFileSync(absolute)).digest('hex');

/** `gen_smoke_lines.py` -> `smoke_lines`; anything else is not a generator. */
const generatorName = (file) => /^gen_(.+)\.py$/.exec(file)?.[1];

const generators = () =>
  readdirSync(genDir)
    .filter((file) => generatorName(file) !== undefined)
    .sort()
    .map((file) => ({ file, name: generatorName(file), path: join(genDir, file) }));

const outputs = () => (existsSync(outDir) ? readdirSync(outDir).sort() : []);

const say = (line) => process.stdout.write(`${line}\n`);

/**
 * Which generator authored an output file. The convention is the file name:
 * `gen_smoke_lines.py` owns every output prefixed `smoke_lines`, so one script
 * may emit a set of files (a revision pair, in M1) without needing a second
 * register of who-made-what to keep in step.
 */
function author(file, scripts) {
  const owners = scripts.filter((script) => file.startsWith(script.name));
  // Longest prefix wins, so `smoke_lines_rev_b` is not claimed by `smoke_lines`.
  return owners.sort((a, b) => b.name.length - a.name.length)[0];
}

function write() {
  const scripts = generators();
  for (const script of scripts) {
    // PYTHONHASHSEED: a generator that iterates a set must not be able to order
    // its output by the interpreter's per-process hash seed. The fixtures are
    // written to be deterministic without it; pinning it here means a fixture
    // that quietly stops being so fails on the next run rather than on some
    // unlucky one.
    const result = spawnSync(
      'uv',
      ['run', '--project', join(repoRoot, 'cad'), '--group', 'fixtures', 'python', script.path],
      {
        cwd: root,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, PYTHONHASHSEED: '0' },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      say(`GENERATOR_FAILED ${relative(script.path)} — exited ${String(result.status)}`);
      return result.status ?? 1;
    }
  }

  const entries = [];
  for (const file of outputs()) {
    const script = author(file, scripts);
    if (script === undefined) {
      say(`UNATTRIBUTED_OUTPUT fixtures/gen/out/${file} — no fixtures/gen/gen_<name>.py owns it`);
      return 1;
    }
    entries.push({
      path: relative(join(outDir, file)),
      sha256: sha256(join(outDir, file)),
      generator: relative(script.path),
      generatorSha256: sha256(script.path),
    });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // LF and a trailing newline, written whole: the manifest is a committed file,
  // and a file whose bytes depend on the platform is not a record of bytes.
  writeFileSync(manifestPath, `${JSON.stringify({ fixtures: entries }, null, 2)}\n`, 'utf8');
  say(`wrote fixtures/MANIFEST.json (${String(entries.length)} fixtures)`);
  return 0;
}

function check() {
  if (!existsSync(manifestPath)) {
    say('MANIFEST_DRIFT fixtures/MANIFEST.json — no manifest; run `pnpm gen:fixtures`');
    return 1;
  }
  const entries = JSON.parse(readFileSync(manifestPath, 'utf8')).fixtures ?? [];

  /** One line per fault, so a reader fixes every one of them in a single pass. */
  const faults = [];
  const recorded = new Set();
  for (const entry of entries) {
    recorded.add(entry.path);
    const fixture = join(root, entry.path);
    const generator = join(root, entry.generator);
    if (!existsSync(fixture)) {
      faults.push(`${entry.path} — recorded fixture is missing from the tree`);
    } else if (sha256(fixture) !== entry.sha256) {
      faults.push(`${entry.path} — sha256 is not the recorded ${entry.sha256}`);
    } else if (!existsSync(generator)) {
      faults.push(`${entry.path} — generator ${entry.generator} is missing from the tree`);
    } else if (sha256(generator) !== entry.generatorSha256) {
      // The one drift the bytes alone cannot show: the fixture is intact and
      // stale. Regenerating is the fix, not re-recording the hash.
      faults.push(
        `${entry.path} — generator ${entry.generator} changed since it was recorded; run \`pnpm gen:fixtures\``,
      );
    }
  }
  for (const file of outputs()) {
    const path = `fixtures/gen/out/${file}`;
    if (!recorded.has(path)) faults.push(`${path} — present in the tree, absent from the manifest`);
  }

  for (const fault of faults) say(`MANIFEST_DRIFT ${fault}`);
  if (faults.length > 0) return 1;

  say(`manifest ok (${String(entries.length)} fixtures)`);
  return 0;
}

process.exitCode = process.argv.includes('--check') ? check() : write();
