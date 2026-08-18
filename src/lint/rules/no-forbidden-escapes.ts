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
      dynamicTestMember: 'Q-08: a computed member on a test callee is forbidden — its name cannot be checked, so the modifier ban cannot be enforced.',
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
        // The root name is what makes a modifier test-suite surgery rather than
        // a plain property: `describe.skip`, `it.only.each(...)`, `test.each(...).only`.
        // Deliberately not restricted to the directly-called form — `describe.skip.each(...)`
        // and `const t = it.only` shrink the suite just as effectively.
        const rootNameOf = (target: typeof node.object): string | undefined => {
          if (target.type === 'Identifier') return target.name;
          if (target.type === 'MemberExpression') return rootNameOf(target.object);
          if (target.type === 'CallExpression') return rootNameOf(target.callee);
          return undefined;
        };
        const root = rootNameOf(node.object);
        if (root === undefined || !TEST_CALLEES.has(root)) return;

        const property = node.property;
        if (!node.computed) {
          if (property.type !== 'Identifier' || !MODIFIERS.has(property.name)) return;
          context.report({ node, messageId: 'testModifier' });
          return;
        }

        // Bracket access: a literal name is checked like any other, and a name
        // this rule cannot read is reported too — a computed member on a test
        // callee is exactly how one would smuggle the modifier past the rule.
        if (property.type === 'Literal') {
          if (typeof property.value !== 'string' || !MODIFIERS.has(property.value)) return;
          context.report({ node, messageId: 'testModifier' });
          return;
        }
        if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
          const cooked = property.quasis[0]?.value.cooked;
          if (cooked === undefined || cooked === null || !MODIFIERS.has(cooked)) return;
          context.report({ node, messageId: 'testModifier' });
          return;
        }
        context.report({ node, messageId: 'dynamicTestMember' });
      },

      TSAnyKeyword(node: Rule.Node): void {
        context.report({ node, messageId: 'looseType' });
      },
    };
  },
};
