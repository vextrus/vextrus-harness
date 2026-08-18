/**
 * `vextrus/no-forbidden-escapes` — the Q-08 escape hatches are lint errors.
 *
 * Q-08 forbids the loose type annotation, the two compiler suppression
 * comments, the linter suppression comment and the two test-call modifiers.
 * Every one of those tokens is assembled here from pieces rather than written
 * out: a rule that bans a token cannot afford to contain it, or linting this
 * repo would report the rule that enforces the repo's own stance (risk note 1).
 *
 * Suppressions are *directives*, so they are matched at the start of a comment
 * line only. Prose that discusses a token — as this repo's own tests and docs
 * must — is not a suppression and is not reported (AC-12: no over-firing).
 */
import type { Rule } from 'eslint';

/** The forbidden comment tokens, never written literally. */
const TS_IGNORE = `${'@'}ts-${'ignore'}`;
const TS_EXPECT_ERROR = `${'@'}ts-${'expect'}-error`;
const ESLINT_DISABLE = `eslint-${'disable'}`;
const COMMENT_TOKENS: readonly string[] = [TS_IGNORE, TS_EXPECT_ERROR, ESLINT_DISABLE];

/** The forbidden test-call modifiers, likewise assembled. */
const SKIP = `sk${'ip'}`;
const ONLY = `on${'ly'}`;
const MODIFIERS: readonly string[] = [SKIP, ONLY];

/** Callables whose modifiers turn a test off; a plain object property is fine. */
const TEST_ROOTS: readonly string[] = ['it', 'test', 'describe', 'suite', 'bench'];

/** The loose type annotation, spelled without spelling it. */
const LOOSE_TYPE = `an${'y'}`;

type Node = { type: string; [key: string]: unknown };

/**
 * The identifier a member chain hangs off: a modifier reached through
 * `it.concurrent`, or through `test.each([])`, still roots at `it` / `test`.
 * Anything else (a call on a value, a computed access) has no root and is left
 * alone.
 */
function rootIdentifier(node: Node): string | undefined {
  let current: Node = node;
  for (;;) {
    if (current.type === 'Identifier') return typeof current['name'] === 'string' ? current['name'] : undefined;
    if (current.type === 'MemberExpression') {
      current = current['object'] as Node;
      continue;
    }
    if (current.type === 'CallExpression') {
      current = current['callee'] as Node;
      continue;
    }
    return undefined;
  }
}

/**
 * The suppression a comment *is*, if any. Each line of the comment is stripped
 * of its leading whitespace and block-comment decoration, then matched at the
 * start — the position where a compiler or linter directive actually takes
 * effect.
 */
function directiveToken(value: string): string | undefined {
  for (const line of value.split('\n')) {
    const stripped = line.replace(/^[\s*]+/, '');
    const token = COMMENT_TOKENS.find((candidate) => stripped.startsWith(candidate));
    if (token !== undefined) return token;
  }
  return undefined;
}

export const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid the Q-08 escape hatches: the loose type, the two compiler suppressions, the linter suppression and the test-call modifiers.',
    },
    schema: [],
    messages: {
      forbidden: 'Forbidden escape hatch `{{token}}` (Q-08): fix the cause, do not silence the check.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program(): void {
        for (const comment of sourceCode.getAllComments()) {
          const token = directiveToken(comment.value);
          if (token === undefined) continue;
          const loc = comment.loc;
          if (loc === undefined || loc === null) continue;
          context.report({ loc, messageId: 'forbidden', data: { token } });
        }
      },

      TSAnyKeyword(node: unknown): void {
        context.report({
          node: node as never,
          messageId: 'forbidden',
          data: { token: LOOSE_TYPE },
        });
      },

      MemberExpression(node: unknown): void {
        const member = node as Node;
        if (member['computed'] === true) return;
        const property = member['property'] as Node | undefined;
        if (property === undefined || property.type !== 'Identifier') return;
        const name = property['name'];
        if (typeof name !== 'string' || !MODIFIERS.includes(name)) return;
        const root = rootIdentifier(member['object'] as Node);
        if (root === undefined || !TEST_ROOTS.includes(root)) return;
        context.report({
          node: node as never,
          messageId: 'forbidden',
          data: { token: `.${name}` },
        });
      },
    } as Rule.RuleListener;
  },
};

/** Registration triple consumed by `src/lint/loader.ts`. */
export const files: string[] = ['**/*.ts', '**/*.tsx'];
export const severity: 'error' | 'warn' = 'error';
