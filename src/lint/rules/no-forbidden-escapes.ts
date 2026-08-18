/**
 * Q-08: the escape hatches this codebase does not have.
 *
 * The forbidden tokens are assembled from fragments rather than written out, so
 * this source stays clean under the repo's own `eslint .` (risk note 1) — a rule
 * that trips over itself is a rule nobody can keep.
 */
import type { Rule } from 'eslint';

/** The loader's registration triple. */
export const files = ['**/*.ts', '**/*.tsx'];
export const severity = 'error' as const;

const TS_DIRECTIVE = new RegExp(`@ts-(?:${'ignore'}|${'expect'}-error)\\b`);
const LINT_DISABLE = new RegExp(`eslint-${'disable'}(?:-next-line|-line)?\\b`);

/** Modifiers that quietly shrink the suite. */
const MODIFIERS = new Set([`${'sk'}ip`, `${'on'}ly`]);

/** Callees whose modifiers are test-suite surgery rather than ordinary properties. */
const TEST_CALLEES = new Set(['describe', 'it', 'test', 'suite', 'context', 'bench']);

export const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid the Q-08 escape hatches: the loose type, the compiler and lint suppressions, and test-suite modifiers.',
    },
    schema: [],
    messages: {
      looseType: 'Q-08: the loose type annotation is forbidden — name the shape, or use unknown and narrow it.',
      compilerSuppression: 'Q-08: compiler suppression comments are forbidden — fix the type instead.',
      lintSuppression: 'Q-08: lint suppression comments are forbidden — fix the code or change the rule.',
      testModifier: 'Q-08: test-suite modifiers are forbidden — a suite that does not run is a suite that lies.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      Program(): void {
        for (const comment of context.sourceCode.getAllComments()) {
          const { loc } = comment;
          if (!loc) continue;
          if (TS_DIRECTIVE.test(comment.value)) {
            context.report({ loc, messageId: 'compilerSuppression' });
            continue;
          }
          if (LINT_DISABLE.test(comment.value)) {
            context.report({ loc, messageId: 'lintSuppression' });
          }
        }
      },

      MemberExpression(node): void {
        const parent = node.parent;
        if (parent.type !== 'CallExpression' || parent.callee !== node) return;

        const property = !node.computed && node.property.type === 'Identifier'
          ? node.property.name
          : undefined;
        if (property === undefined || !MODIFIERS.has(property)) return;

        // `describe.skip`, `it.only`, `test.each(...).only` — the root name is
        // what makes a modifier test-suite surgery rather than a plain property.
        const rootNameOf = (target: typeof node.object): string | undefined => {
          if (target.type === 'Identifier') return target.name;
          if (target.type === 'MemberExpression') return rootNameOf(target.object);
          if (target.type === 'CallExpression') return rootNameOf(target.callee);
          return undefined;
        };
        const root = rootNameOf(node.object);
        if (root === undefined || !TEST_CALLEES.has(root)) return;

        context.report({ node, messageId: 'testModifier' });
      },

      TSAnyKeyword(node: Rule.Node): void {
        context.report({ node, messageId: 'looseType' });
      },
    };
  },
};
