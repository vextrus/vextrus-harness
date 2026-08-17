/**
 * Q-08 — the escape hatches this codebase does not have.
 *
 * The tokens this rule forbids cannot be written literally in its own source or
 * the repo would lint itself red, so every one of them is assembled from
 * fragments at load time. Same trick as the fixture test.
 */
import type { RuleTester } from '@typescript-eslint/rule-tester';

/** The rule shape `RuleTester.run` accepts — taken from the tester itself. */
type LintRuleModule = Parameters<RuleTester['run']>[1];

const TS_DIRECTIVE = '@' + 'ts-';
const COMMENT_ESCAPES: string[] = [
  TS_DIRECTIVE + 'ignore',
  TS_DIRECTIVE + 'expect-error',
  'eslint' + '-disable',
];
const WIDE_TYPE = 'a' + 'ny';
const TEST_MODIFIERS = new Set(['skip', 'only']);

export const rule: LintRuleModule = {
  defaultOptions: [],
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid the escape hatches Q-08 bans: the wide type, TypeScript suppression comments, lint suppression comments and focused/skipped tests.',
    },
    messages: {
      forbidden: 'Forbidden escape hatch: {{escape}} (Q-08). Fix the cause, not the report.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Program(): void {
        for (const comment of sourceCode.getAllComments()) {
          const escape = COMMENT_ESCAPES.find((token) => comment.value.includes(token));
          if (escape !== undefined) {
            context.report({ loc: comment.loc, messageId: 'forbidden', data: { escape } });
          }
        }
      },
      TSAnyKeyword(node): void {
        context.report({ node, messageId: 'forbidden', data: { escape: WIDE_TYPE } });
      },
      MemberExpression(node): void {
        if (node.computed) return;
        const property = node.property;
        if (property.type !== 'Identifier' || !TEST_MODIFIERS.has(property.name)) return;
        const parent = node.parent;
        if (parent.type !== 'CallExpression' || parent.callee !== node) return;
        context.report({
          node: property,
          messageId: 'forbidden',
          data: { escape: '.' + property.name },
        });
      },
    };
  },
};

/** The loader reads these three exports; see src/lint/loader.ts. */
export const files: string[] = ['**/*.ts', '**/*.tsx'];
export const severity = 'error';
