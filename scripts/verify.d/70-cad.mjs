/**
 * The cad lane's stage of `pnpm verify` (V-VERIFY, L-CAD-04, L-CAD-09).
 *
 * Five steps, fail-fast, cheapest and most consequential first:
 *
 *   1. the licence scan — what the two manifests are allowed to declare;
 *   2. the fixture-manifest drift check — hashes only, no generator is run;
 *   3. the banned-tool grep over the sources;
 *   4. the Python lane's linter;
 *   5. the Python lane's tests.
 *
 * The order is the contract, not a preference. A licence breach is a fact about
 * two text files: it must never cost a Python interpreter, a wheel download or
 * a test run to find out about, and it must be the answer the exit code carries
 * when several things are wrong at once. So the stage's exit code is the first
 * failing step's, and nothing after it runs.
 *
 * Runnable on its own — `node scripts/verify.d/70-cad.mjs` — like every other
 * stage, and the three scan roots are environment overrides so a fixture test
 * can point the real scanner at a tampered tree instead of asserting that the
 * scanner's source code looks about right.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const say = (line) => process.stdout.write(`${line}\n`);

/** Ends the stage with the first failing step's code; nothing after it runs. */
const fail = (status) => {
  process.exitCode = status;
};

// ---------------------------------------------------------------------------
// 1. The licence scan (L-CAD-04, D-04)
// ---------------------------------------------------------------------------

const packageJsonPath = process.env['LICENCE_PACKAGE_JSON'] ?? join(repoRoot, 'package.json');
const pyprojectPath = process.env['LICENCE_PYPROJECT'] ?? join(repoRoot, 'cad', 'pyproject.toml');

/* licence-scan:exempt-begin — the names below are the ban itself. A scanner that
   could not say what it forbids would have to spell the names some other way,
   and a ban nobody can read is a ban nobody maintains. */

/** AGPL PDF libraries, banned in shipped code on the Python runtime. */
const BANNED_PYTHON = ['pymupdf', 'fitz', 'mutool'];

/** D-04: permissive, and allowed for fixture generation in this group alone. */
const FIXTURES_ONLY = { name: 'reportlab', table: 'dependency-groups', key: 'fixtures' };

/** AGPL, banned on the Node runtime. */
const BANNED_NODE = ['@vivliostyle/cli'];

/** The converter L-CAD-04 bans outright, in any spelling. */
const BANNED_TOOL = /oda[\s_-]*file[\s_-]*converter/i;

/* licence-scan:exempt-end */

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** PEP 503-ish: names differing only in case or separator are the same name. */
const normalise = (name) => name.trim().toLowerCase().replace(/[-_.]+/g, '-');

/** `ezdxf==1.4.4` -> `ezdxf`; `reportlab>=4 ; python_version>"3"` -> `reportlab`. */
const requirementName = (requirement) => normalise(requirement.split(/[[<>=!~;\s]/)[0] ?? '');

function scanPackageJson(path) {
  if (!existsSync(path)) return [];
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const offences = [];
  for (const section of DEPENDENCY_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (BANNED_NODE.includes(name.toLowerCase())) offences.push(`${name} in ${path}`);
    }
  }
  return offences;
}

/**
 * A line scanner rather than a TOML parser: this increment adds no dependency
 * to either runtime, and the shape being read — arrays of requirement strings
 * under a table and a key — is exactly what a line scanner can see. Every
 * quoted string in an array is treated as a requirement; a value that is not
 * one (a description, a version range) simply has no banned name in it.
 */
function scanPyproject(path) {
  if (!existsSync(path)) return [];
  const offences = [];
  let tableName = '';
  let key = '';
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.split('#')[0] ?? '';
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header !== null) {
      tableName = header[1].trim();
      key = '';
      continue;
    }
    // A key, not a requirement: `fixtures = [` opens an array, whereas the
    // `"reportlab==4.4.9",` inside it only looks like an assignment if the `==`
    // of a pin is mistaken for one.
    const assignment = /^\s*(?:"([\w.-]+)"|'([\w.-]+)'|([\w.-]+))\s*=(?!=)/.exec(line);
    if (assignment !== null) key = assignment[1] ?? assignment[2] ?? assignment[3] ?? '';

    for (const [, quoted] of line.matchAll(/["']([^"']+)["']/g)) {
      const name = requirementName(quoted);
      const where = key === '' ? tableName : `${tableName}.${key}`;
      if (BANNED_PYTHON.includes(name)) {
        offences.push(`${name} in ${path} (${where})`);
      } else if (
        name === FIXTURES_ONLY.name &&
        !(tableName === FIXTURES_ONLY.table && key === FIXTURES_ONLY.key)
      ) {
        offences.push(`${name} in ${path} (${where})`);
      }
    }
  }
  return offences;
}

const offences = [...scanPackageJson(packageJsonPath), ...scanPyproject(pyprojectPath)];
if (offences.length > 0) {
  for (const offence of offences) say(`BANNED_DEPENDENCY ${offence}`);
  fail(1);
}

// ---------------------------------------------------------------------------
// 2. The fixture manifest (L-CAD-09)
// ---------------------------------------------------------------------------

if (process.exitCode === undefined || process.exitCode === 0) {
  const manifest = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'gen-fixtures.mjs'), '--check'],
    { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
  );
  if (manifest.error) throw manifest.error;
  if (manifest.status !== 0) fail(manifest.status ?? 1);
}

// ---------------------------------------------------------------------------
// 3. The banned-tool grep (L-CAD-04)
// ---------------------------------------------------------------------------

const scanRoot = resolve(process.env['LICENCE_SCAN_ROOT'] ?? repoRoot);

/**
 * Exempt by path: prose that names the banned converter in order to ban it is
 * not a use of it. The specification and the tests are where those sentences
 * live, so both are read past — everything else under the root is scanned,
 * which is wider than the sources the contract names and errs the safe way.
 */
const EXEMPT_PREFIXES = ['docs', 'tests', 'cad/tests', 'var'];

/** Build output, dependency trees and every tool cache: not this repo's text. */
const EXEMPT_DIRECTORIES = ['node_modules', '__pycache__'];

const exemptDirectory = (name) => name.startsWith('.') || EXEMPT_DIRECTORIES.includes(name);

const scanExempt = (relativePath) =>
  EXEMPT_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));

/** Four megabytes of text is already not a source file; a binary is not text at all. */
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

function* textFiles(directory, prefix = '') {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (scanExempt(relativePath)) continue;
    if (entry.isDirectory()) {
      if (!exemptDirectory(entry.name)) yield* textFiles(join(directory, entry.name), relativePath);
      continue;
    }
    if (!entry.isFile()) continue;
    const absolute = join(directory, entry.name);
    if (statSync(absolute).size > MAX_SCAN_BYTES) continue;
    const bytes = readFileSync(absolute);
    // A NUL byte is the cheapest honest test for "this is not text", and it
    // keeps the fixtures' own PDF out of a grep it could only match by accident.
    if (bytes.includes(0)) continue;
    yield { relativePath, text: bytes.toString('utf8') };
  }
}

if (process.exitCode === undefined || process.exitCode === 0) {
  const references = [];
  for (const file of textFiles(scanRoot)) {
    let exempt = false;
    file.text.split('\n').forEach((line, index) => {
      // The scanner's own table of banned names is not a reference to them.
      if (line.includes('licence-scan:exempt-begin')) exempt = true;
      else if (line.includes('licence-scan:exempt-end')) exempt = false;
      else if (!exempt && BANNED_TOOL.test(line)) {
        references.push(`${file.relativePath}:${String(index + 1)}`);
      }
    });
  }
  if (references.length > 0) {
    for (const reference of references) say(`BANNED_TOOL_REFERENCE ${reference}`);
    fail(1);
  }
}

// ---------------------------------------------------------------------------
// 4. and 5. The Python lane: lint, then test (V-VERIFY)
// ---------------------------------------------------------------------------

const cad = join(repoRoot, 'cad');

const uv = (args) => {
  const result = spawnSync('uv', ['run', ...args], {
    cwd: cad,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

if (process.exitCode === undefined || process.exitCode === 0) {
  const lint = uv(['ruff', 'check', '.']);
  if (lint !== 0) fail(lint);
}

if (process.exitCode === undefined || process.exitCode === 0) {
  const tests = uv(['pytest', '-q']);
  if (tests !== 0) fail(tests);
}
