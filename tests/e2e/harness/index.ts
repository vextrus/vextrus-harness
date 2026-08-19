/**
 * The V-E2E harness: what a journey file is allowed to know about the lane.
 *
 * Four helpers, and the reason each one is here rather than in the journey:
 *
 *   journey(id, fn)     — a journey is identified by its J-id, and the id has to
 *                         survive into the runner so `--journey` and the
 *                         traceability report can both work off the same string.
 *                         It becomes a Playwright tag, `@<id>`; breakers get
 *                         `@breaker` on top, which is what the lane grep-inverts
 *                         so a deliberately-red journey cannot redden CI.
 *   checkpoint(page, n) — the Bible names three things at every named checkpoint
 *                         (screenshot, axe, visual compare against a committed
 *                         Linux baseline). One call, so a journey cannot ship
 *                         two of the three.
 *   readMail/waitForMail— the dev mailer of m0-12 writes one JSON file per
 *                         message under `.mail/`; these read that directory so a
 *                         journey can assert on mail without knowing the format.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { describeJourney } from './describe.journey';
import { masksFor } from './masks';

/** The repo root, from this file: tests/e2e/harness/ -> ../../.. */
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** Where every run artifact goes. Gitignored: a run leaves scratch, not tree. */
const ARTIFACTS = join(repoRoot, 'var', 'e2e', 'artifacts');

/** The impact levels Q-11 fails on. `minor` and `moderate` are reported, not fatal. */
const FATAL_IMPACTS = new Set(['serious', 'critical']);

/** Baselines are Linux-only by contract (AC-05), so the compare is too. */
const LINUX = process.platform === 'linux';

export interface MailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface JourneyOptions {
  /** A journey that is *supposed* to fail: tagged `@breaker` and excluded by default. */
  breaker?: boolean;
}

/**
 * Registers a journey as a tagged describe block.
 *
 * The tag is the whole point: `pnpm e2e --journey J-000` is `--grep @J-000`, and
 * a journey that forgot to declare its id would silently never be selected.
 */
export function journey(id: string, fn: () => void, opts?: JourneyOptions): void {
  // The tags go in the *title*, not in the `tag` option: Playwright's JSON
  // reporter strips the leading `@` from `tags`, and the lane's traceability —
  // and the acceptance that reads `--list --reporter=json` — is the literal
  // `@J-000` string. A title tag is a first-class tag either way: `--grep` and
  // `testInfo.tags` both see it.
  const tags = opts?.breaker === true ? `@${id} @breaker` : `@${id}`;
  // Delegated so the describe's recorded location is a *.journey.ts file; see
  // the comment in ./describe.journey.ts for why that matters.
  describeJourney(`${id} ${tags}`, fn);
}

/**
 * The journey id of the running test, read back off its own tags.
 *
 * The `@` is optional here on purpose: a tag is `@J-000` in `testInfo.tags` and
 * `J-000` once a reporter has been through it, and a checkpoint that routed its
 * baseline differently depending on who was watching would be a fine bug.
 */
function journeyIdOf(tags: readonly string[]): string {
  const own = tags
    .map((tag) => (tag.startsWith('@') ? tag.slice(1) : tag))
    .find((tag) => tag.startsWith('J-'));
  return own ?? 'unknown';
}

/**
 * A named checkpoint: the screenshot, the axe scan and the baseline compare that
 * V-E2E asks for at every one of them.
 *
 * Order matters. The artifact is written first, so a checkpoint that goes on to
 * fail still leaves behind the picture of what it saw; axe runs before the
 * pixels, because "this screen is inaccessible" is a better failure to read than
 * "these pixels moved".
 */
export async function checkpoint(page: Page, name: string): Promise<void> {
  const info = test.info();
  const id = journeyIdOf(info.tags);

  const shotPath = join(ARTIFACTS, 'checkpoints', id, `${name}.png`);
  mkdirSync(dirname(shotPath), { recursive: true });
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  writeFileSync(shotPath, shot);
  await info.attach(`${id}/${name}.png`, { body: shot, contentType: 'image/png' });

  const scan = await new AxeBuilder({ page }).analyze();
  const fatal = scan.violations.filter((violation) =>
    FATAL_IMPACTS.has(String(violation.impact ?? '')),
  );
  const report = fatal
    .map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`)
    .join('\n');
  expect(fatal, `axe found serious/critical violations at ${id}/${name}:\n${report}`).toHaveLength(
    0,
  );

  if (!LINUX) {
    process.stdout.write('baselines: skipped (non-linux)\n');
    return;
  }

  await expect(page).toHaveScreenshot([id, `${name}.png`], {
    maxDiffPixelRatio: 0.002,
    animations: 'disabled',
    caret: 'hide',
    mask: masksFor(id).map((selector) => page.locator(selector)),
  });
}

/** The directory the dev mailer (m0-12) writes one JSON file per message into. */
const MAIL_DIR = join(repoRoot, '.mail');

/** Every captured message, oldest file first. A missing directory means no mail. */
export async function readMail(dir?: string): Promise<MailMessage[]> {
  const root = dir === undefined ? MAIL_DIR : resolve(dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(root, file), 'utf8')) as MailMessage);
}

const matches = (message: MailMessage, match: { to?: string; subject?: string | RegExp }): boolean => {
  if (match.to !== undefined && message.to !== match.to) return false;
  if (match.subject === undefined) return true;
  return typeof match.subject === 'string'
    ? message.subject.includes(match.subject)
    : match.subject.test(message.subject);
};

/**
 * The first message matching `match`, waiting for it to arrive.
 *
 * Mail is written by another process (the app, on its own clock), so the read
 * has to be a poll with a deadline rather than a single look — and a timeout
 * has to say what it was waiting for, or a red journey is a puzzle.
 */
export async function waitForMail(
  match: { to?: string; subject?: string | RegExp },
  opts?: { dir?: string; timeoutMs?: number },
): Promise<MailMessage> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await readMail(opts?.dir)).find((message) => matches(message, match));
    if (found !== undefined) return found;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForMail: no message matching ${JSON.stringify({
          to: match.to,
          subject: String(match.subject),
        })} after ${String(timeoutMs)}ms`,
      );
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

export { journeyMasks } from './masks';
