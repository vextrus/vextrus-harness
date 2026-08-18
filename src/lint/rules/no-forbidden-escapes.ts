/**
 * Q-08: the escape hatches this codebase does not have.
 *
 * The forbidden tokens are assembled from fragments rather than written out, so
 * this source stays clean under the repo's own `eslint .` (risk note 1) — a rule
 * that trips over itself is a rule nobody can keep.
 */
import type { Rule, Scope } from 'eslint';

/** The loader's registration triple. */
export const files = ['**/*.ts', '**/*.tsx'];
export const severity = 'error' as const;

const TS_DIRECTIVE = new RegExp(`@ts-(?:${'ignore'}|${'expect'}-error)\\b`);
const LINT_DISABLE = new RegExp(`eslint-${'disable'}(?:-next-line|-line)?\\b`);

/**
 * Modifiers that quietly shrink the suite. Q-08 is about suites that do not run,
 * not about one spelling: the conditional and parked forms shrink it too.
 */
const MODIFIERS = new Set([
  `${'sk'}ip`,
  `${'on'}ly`,
  `${'sk'}ipIf`,
  `${'ru'}nIf`,
  `${'to'}do`,
  `${'fa'}ils`,
  `${'fa'}iling`,
]);

/** Callees whose modifiers are test-suite surgery rather than ordinary properties. */
const TEST_CALLEES = new Set(['describe', 'it', 'test', 'suite', 'context', 'bench']);

/** The identifier a member/call chain is rooted at: `it.only.each(x).y` -> `it`. */
function rootIdentifier(target: Rule.Node | null | undefined): string | undefined {
  if (!target) return undefined;
  if (target.type === 'Identifier') return target.name;
  if (target.type === 'MemberExpression') return rootIdentifier(target.object as Rule.Node);
  if (target.type === 'CallExpression') return rootIdentifier(target.callee as Rule.Node);
  return undefined;
}

function lookup(scope: Scope.Scope | null, name: string): Scope.Variable | undefined {
  for (let current = scope; current !== null; current = current.upper) {
    const found = current.variables.find((variable) => variable.name === name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * A name is a test callee only when it really is one: the runner's global (or its
 * import), or a local alias of one. A parameter named `context`, or a domain
 * object named `bench`, is ordinary code — the rule must fire, and must not
 * over-fire.
 */
function isTestCallee(scope: Scope.Scope | null, name: string, depth = 0): boolean {
  // An alias carries any name at all, so the name alone decides nothing: what
  // decides is what the name resolves to.
  if (depth > 4) return false;

  const variable = lookup(scope, name);
  // Unresolved: the runner injects `describe`/`it` as globals in test files.
  if (variable === undefined) return TEST_CALLEES.has(name);

  return variable.defs.some((def) => {
    if (def.type === 'ImportBinding') {
      const specifier = def.node;
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
        return TEST_CALLEES.has(specifier.imported.name);
      }
      return false;
    }
    if (def.type === 'Variable') {
      const init = def.node.type === 'VariableDeclarator' ? def.node.init : null;
      const root = rootIdentifier(init as Rule.Node | null);
      if (root === undefined) return false;
      return isTestCallee(scope, root, depth + 1);
    }
    // Parameters, function/class declarations, catch clauses: ordinary code.
    return false;
  });
}

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
        const root = rootIdentifier(node.object as Rule.Node);
        if (root === undefined) return;
        if (!isTestCallee(context.sourceCode.getScope(node), root)) return;

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
