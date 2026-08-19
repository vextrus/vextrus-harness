#!/usr/bin/env node
/**
 * The cad lane's verify stage (V-VERIFY: the Python lane's lint and test run).
 *
 * It runs five steps, fail-fast, and the order is the point. L-CAD-04's licence
 * ban is a property of the tree, not of the Python: a manifest that names an AGPL
 * renderer is already wrong, and finding that out after a minute of interpreter
 * time would be finding it out late. So the cheap tree-level refusals come first
 * — licence scan, fixture-manifest drift, the banned-converter grep — and only a
 * tree that survives all three pays for the Python run.
 *
 * Every scan is pointed at its input through an environment variable, defaulting
 * to the real file. That is what makes the ban testable: a fixture test feeds the
 * real scanner a tampered manifest instead of asserting that a scanner exists.
 *
 * The stage's exit code is the first failing step's, so a caller can tell a
 * licence refusal (1) from a failing Python suite without reading the transcript.
 *
 * Read top to bottom: each step guards on `process.exitCode` being unset, which
 * is what "fail-fast" means in a file that has no early return to give.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from '../lib/stage.mjs';

const thisFile = fileURLToPath(import.meta.url);

const say = (line) => process.stdout.write(`${line}\n`);

/** Ends the stage here, with the code the failing step earned. */
const refuse = (status) => {
  process.exitCode = status;
};

const pending = () => process.exitCode === undefined || process.exitCode === 0;

/** The override, else the default — an exported-but-empty variable is no override. */
const from = (name, fallback) => process.env[name]?.trim() || fallback;

const packageJsonPath = from('LICENCE_PACKAGE_JSON', join(repoRoot, 'package.json'));
const pyprojectPath = from('LICENCE_PYPROJECT', join(repoRoot, 'cad', 'pyproject.toml'));
const scanRoot = from('LICENCE_SCAN_ROOT', repoRoot);

// ---------------------------------------------------------------------------
// Step 1 — the licence scan (L-CAD-04, D-04).
// ---------------------------------------------------------------------------

/** The npm packages that may never be depended on. */
const BANNED_NPM = ['@vivliostyle/cli']; // licence-scanner-table

/** The Python distributions that may never be depended on, at all. */
const BANNED_PYTHON = ['pymupdf', 'fitz', 'mutool']; // licence-scanner-table

/** Permissive, but only as a fixtures tool: D-04 allows it here and nowhere else. */
const FIXTURES_ONLY = { name: 'reportlab', where: 'dependency-groups.fixtures' };

const NPM_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** `ezdxf==1.4.4` / `Pillow[extra] >=1` -> `ezdxf` / `pillow`. */
const requirementName = (requirement) =>
  requirement
    .trim()
    .split(/[[(<>=!~;\s]/)[0]
    .toLowerCase()
    .replace(/_/g, '-');

/**
 * Every `key = [ ... ]` array in a TOML file, tagged with the table it sits in.
 *
 * A hand-rolled reader rather than a TOML parser because this increment adds no
 * npm dependency, and because the question is narrow: which arrays name which
 * distributions. Anything it cannot parse it simply does not report — and the
 * Python half of the licence test reads the same file with a real parser, so the
 * two runtimes disagreeing is itself a signal.
 */
function tomlArrays(toml) {
  const arrays = [];
  let table = '';
  let open = null;
  for (const raw of toml.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (open === null) {
      const header = /^\s*\[([^[\]]+)\]\s*$/.exec(line);
      if (header !== null) {
        table = header[1];
        continue;
      }
      const assignment = /^\s*"?([A-Za-z0-9_.-]+)"?\s*=\s*\[(.*)$/.exec(line);
      if (assignment === null) continue;
      const key = assignment[1];
      open = { where: table === '' ? key : `${table}.${key}`, text: assignment[2] };
    } else {
      open.text += `\n${line}`;
    }
    const end = open.text.indexOf(']');
    if (end < 0) continue;
    const values = [...open.text.slice(0, end).matchAll(/"([^"]*)"|'([^']*)'/g)].map(
      (match) => match[1] ?? match[2] ?? '',
    );
    arrays.push({ where: open.where, values });
    open = null;
  }
  return arrays;
}

function scanPackageJson(path) {
  if (!existsSync(path)) return [];
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const refusals = [];
  for (const section of NPM_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (BANNED_NPM.includes(name.toLowerCase())) refusals.push(`${name} in ${path}`);
    }
  }
  return refusals;
}

function scanPyproject(path) {
  if (!existsSync(path)) return [];
  const toml = readFileSync(path, 'utf8');
  const refusals = [];

  // "anywhere": an AGPL PDF library named in this file at all is a refusal — in a
  // dependency list, a comment or a tool table alike. There is no legitimate
  // reason to write one of these names down in the file the app is built from.
  const lowered = toml.toLowerCase();
  for (const banned of BANNED_PYTHON) {
    if (lowered.includes(banned)) refusals.push(`${banned} in ${path}`);
  }

  // reportlab is about placement rather than the name, so it is read out of the
  // arrays: the group is the whole permission (D-04), and prose naming the tool
  // is not a dependency on it.
  for (const array of tomlArrays(toml)) {
    if (array.where === FIXTURES_ONLY.where) continue;
    if (array.values.some((value) => requirementName(value) === FIXTURES_ONLY.name)) {
      refusals.push(`${FIXTURES_ONLY.name} in ${path}`);
    }
  }
  return refusals;
}

const licenceRefusals = [...scanPackageJson(packageJsonPath), ...scanPyproject(pyprojectPath)];
if (licenceRefusals.length > 0) {
  for (const refusal of licenceRefusals) say(`BANNED_DEPENDENCY ${refusal}`);
  refuse(1);
}

// ---------------------------------------------------------------------------
// Step 2 — the fixture manifest still describes the tree (L-CAD-09).
// ---------------------------------------------------------------------------

if (pending()) {
  const drift = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'gen-fixtures.mjs'), '--check'],
    { cwd: repoRoot, stdio: 'inherit', env: process.env },
  );
  if (drift.error) throw drift.error;
  if (drift.status !== 0) refuse(drift.status ?? 1);
}

// ---------------------------------------------------------------------------
// Step 3 — the banned converter is not referred to anywhere in shipped code.
// ---------------------------------------------------------------------------

/**
 * The converter L-CAD-04 bans by name. Written out rather than obfuscated: a
 * scanner whose own pattern has been disguised to slip past itself is a scanner
 * nobody can read or trust. Instead the scan exempts the lines of its own table,
 * each marked below — a mention *here* is the ban being stated, not broken.
 */
const BANNED_TOOL = /oda[\s_-]*file[\s_-]*converter/i; // licence-scanner-table

/** Marks a line of this file as part of the table, so the scan may skip it. */
const SELF_EXEMPT = 'licence-scanner-table';

/** Where shipped code lives. Everything else is either scratch or not shipped. */
const SCANNED = ['cad', 'scripts', 'src', 'fixtures/gen', 'package.json'];

/**
 * Directories the ban does not reach into: prose about the ban (`docs/`), the
 * tests that prove it fires (`tests/`, `cad/tests/`), dependencies nobody here
 * wrote (`node_modules/`), and everything dot-prefixed — `.git`, `.next*`,
 * `cad/.venv` and the tool caches beside it, which are neither ours nor shipped.
 */
const SKIPPED = new Set(['docs', 'tests', 'node_modules', '__pycache__']);

const skipped = (name) => name.startsWith('.') || SKIPPED.has(name);

function* filesUnder(path) {
  if (!existsSync(path)) return;
  if (statSync(path).isFile()) {
    yield path;
    return;
  }
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (skipped(entry.name)) continue;
    yield* filesUnder(join(path, entry.name));
  }
}

if (pending()) {
  const references = [];
  for (const root of SCANNED) {
    for (const file of filesUnder(join(scanRoot, root))) {
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        if (!BANNED_TOOL.test(line)) continue;
        if (file === thisFile && line.includes(SELF_EXEMPT)) continue;
        references.push(`${file}:${String(index + 1)}`);
      }
    }
  }
  if (references.length > 0) {
    for (const reference of references) say(`BANNED_TOOL_REFERENCE ${reference}`);
    refuse(1);
  }
}

// ---------------------------------------------------------------------------
// Steps 4 and 5 — the Python lane's own verdict, in its own project.
// ---------------------------------------------------------------------------

const cad = join(repoRoot, 'cad');

/** `uv run <argv>` in `cad/`, inheriting stdio so the tool's diagnosis survives. */
function uv(argv) {
  const result = spawnSync('uv', ['run', ...argv], { cwd: cad, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (pending()) {
  const status = uv(['ruff', 'check', '.']);
  if (status !== 0) refuse(status);
}

if (pending()) {
  const status = uv(['pytest', '-q']);
  if (status !== 0) refuse(status);
}
