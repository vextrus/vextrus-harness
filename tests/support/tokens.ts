// Q-08 forbidden tokens, built by concatenation so that this repo's own
// `eslint .` stays green and vitest never sees a real test modifier (AC-13).
export const AT_SIGN = '@';
export const TOKEN_TS_IGNORE = `${AT_SIGN}ts-` + 'ignore';
export const TOKEN_TS_EXPECT_ERROR = `${AT_SIGN}ts-` + 'expect-error';
export const TOKEN_ESLINT_DISABLE = 'eslint-' + 'disable';
export const TOKEN_ESLINT_DISABLE_NEXT_LINE = `${TOKEN_ESLINT_DISABLE}-next-line`;
export const TOKEN_ANY = 'an' + 'y';
export const TOKEN_SKIP = 'sk' + 'ip';
export const TOKEN_ONLY = 'on' + 'ly';
export const RULE_ID = 'vextrus/no-forbidden-escapes';
