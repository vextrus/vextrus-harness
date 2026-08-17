import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { files, rule, severity } from '../rules/no-forbidden-escapes';

/**
 * Q-08 — the six forbidden escapes must be lint errors.
 * AC-06 (each token fires) and AC-13 (this file is itself clean).
 *
 * Every forbidden token below is assembled by concatenation. If they were
 * written literally the repo's own `eslint .` would go red on this file and
 * vitest would treat the fixture text as a real test-call modifier — which is
 * exactly the self-flagging trap this increment has to survive.
 */
const ANY = `a${'ny'}`;
const TS_IGNORE = `@ts-${'ignore'}`;
const TS_EXPECT_ERROR = `@ts-${'expect'}-error`;
const DISABLE = `eslint-${'disable'}`;
const DISABLE_NEXT_LINE = `${DISABLE}-next-line`;
const ONLY = `o${'nly'}`;
const SKIP = `s${'kip'}`;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
  // Without this, a disable-directive fixture would switch off the very rule
  // under test and the case would silently pass with zero reports.
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
});

/** name → source that must produce exactly one report. */
const FIRES: ReadonlyArray<readonly [string, string]> = [
  ['unspecified type annotation', `const value: ${ANY} = 1;\nexport { value };\n`],
  ['suppression comment (ignore)', `// ${TS_IGNORE}\nexport const a = 1;\n`],
  ['suppression comment (expect-error)', `// ${TS_EXPECT_ERROR}\nexport const b = 1;\n`],
  ['lint disable, line comment', `// ${DISABLE}\nexport const c = 1;\n`],
  ['lint disable, next-line comment', `// ${DISABLE_NEXT_LINE}\nexport const d = 1;\n`],
  ['lint disable, block comment', `/* ${DISABLE} */\nexport const e = 1;\n`],
  ['exclusive test modifier', `it.${ONLY}('x', () => {});\n`],
  ['skipped test modifier', `describe.${SKIP}('x', () => {});\n`],
];

/** Sources that merely contain the substrings and must produce no report. */
const DOES_NOT_FIRE: ReadonlyArray<readonly [string, string]> = [
  ['word containing the type token', 'export const company = "anywhere";\n'],
  ['property name containing skip', `export const props = { ${SKIP}Link: true };\n`],
  ['string data containing the modifier', `export const values = [".${ONLY}"];\n`],
  ['similarly named array method', 'export const has = [1, 2].some((n) => n > 1);\n'],
];

describe('vextrus/no-forbidden-escapes — module contract (AC-06)', () => {
  it('exports the registration shape the loader expects', () => {
    expect(files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(severity).toBe('error');
    expect(typeof rule.create).toBe('function');
  });
});

describe('vextrus/no-forbidden-escapes — each Q-08 token is an error (AC-06)', () => {
  ruleTester.run('no-forbidden-escapes', rule, {
    valid: DOES_NOT_FIRE.map(([name, code]) => ({ name, code, filename: 'fixture.ts' })),
    invalid: FIRES.map(([name, code]) => ({ name, code, filename: 'fixture.ts', errors: 1 })),
  });
});
