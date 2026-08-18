/**
 * Q-08 guardrail: the six escape hatches are lint errors, not conventions.
 *
 * Every forbidden token is assembled from fragments here so this file — and the
 * whole repository — stays green under its own `eslint .` (AC-13).
 */
import type { Rule } from 'eslint';

const AT = '@';
const TS_PREFIX = `${AT}ts-`;
const IGNORE = 'ign' + 'ore';
const EXPECT_ERROR = 'exp' + 'ect-error';
const DISABLE = 'es' + 'lint-' + 'disable';
const SKIP = 'sk' + 'ip';
const ONLY = 'on' + 'ly';

/** A TypeScript suppression directive must open the comment to count. */
const SUPPRESSION = new RegExp(`^\\s*${TS_PREFIX}(?:${IGNORE}|${EXPECT_ERROR})\\b`);
/** Every disable-comment variant: whole file, this line, next line. */
const DISABLE_COMMENT = new RegExp(`^\\s*${DISABLE}(?:-next-line|-line)?\\b`);

/** Test runner entry points whose modifiers focus or silence a suite. */
const TEST_CALLEES = new Set(['describe', 'it', 'test', 'suite', 'bench']);
const TEST_MODIFIERS = new Set([SKIP, ONLY]);

/** Root identifier of a member chain, so a modifier behind `it.each(...)` still counts. */
function rootName(node: { type: string; [key: string]: unknown }): string | undefined {
  let current = node;
  for (;;) {
    if (current.type === 'Identifier') return current['name'] as string;
    if (current.type === 'MemberExpression') {
      current = current['object'] as typeof current;
      continue;
    }
    if (current.type === 'CallExpression') {
      current = current['callee'] as typeof current;
      continue;
    }
    return undefined;
  }
}

export const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Bans the Q-08 escape hatches: the loose type, suppression directives, lint disables and focused or skipped tests.',
    },
    schema: [],
    messages: {
      looseType: `The loose "${'an' + 'y'}" type is banned (Q-08); give the value a real type.`,
      suppression: `TypeScript suppression directives are banned (Q-08); fix the type instead.`,
      disableComment: `Lint disable comments are banned (Q-08); fix the finding instead.`,
      testModifier: `Focused or skipped tests are banned (Q-08); run the whole suite.`,
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      // The loose type, wherever it is written as a type annotation.
      TSAnyKeyword(node: Rule.Node) {
        context.report({ node, messageId: 'looseType' });
      },

      // Test-call modifiers that focus or silence a suite.
      MemberExpression(node) {
        const property = node.property as unknown as { type: string; name?: string };
        if (node.computed || property.type !== 'Identifier') return;
        if (property.name === undefined || !TEST_MODIFIERS.has(property.name)) return;
        const root = rootName(node.object as unknown as { type: string });
        if (root === undefined || !TEST_CALLEES.has(root)) return;
        context.report({ node, messageId: 'testModifier' });
      },

      // Comment directives are checked once, when the program is complete.
      'Program:exit'() {
        for (const comment of sourceCode.getAllComments()) {
          if (SUPPRESSION.test(comment.value)) {
            context.report({ loc: comment.loc ?? { line: 1, column: 0 }, messageId: 'suppression' });
            continue;
          }
          if (DISABLE_COMMENT.test(comment.value)) {
            context.report({ loc: comment.loc ?? { line: 1, column: 0 }, messageId: 'disableComment' });
          }
        }
      },
    };
  },
};

export const files: string[] = ['**/*.ts', '**/*.tsx'];

export const severity: 'error' | 'warn' = 'error';
