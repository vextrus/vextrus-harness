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

/**
 * The subset that may be judged on the name alone when it resolves to nothing.
 * A runner injects its callees as globals, so an unresolved `describe`/`it` is
 * still test-suite surgery — but `context` and `bench` are ordinary words, and an
 * ambient global of either name in application code is not a suite. Those two
 * count only when they resolve to a runner import or an alias of one, or when the
 * file being linted is itself a test file: there, an undeclared `context`/`bench`
 * is precisely the globals-enabled runner's injection, and `context.only(...)`
 * silently shrinks the suite — the failure Q-08 forbids. So the discrimination is
 * the file, not the name: in a domain module `bench.only` is ordinary code.
 */
const GLOBAL_TEST_CALLEES = new Set(['describe', 'it', 'test', 'suite']);

/**
 * A test file by its path: the runner's own conventions (`*.test.ts`,
 * `*.spec.ts`, `*.bench.ts`, anything under `__tests__/` or `tests/`).
 */
const TEST_FILE = /(?:^|[\\/])(?:__tests__|tests)[\\/]|\.(?:test|spec|bench)\.[cm]?[jt]sx?$/;

/**
 * Modules that hand out those callees. A namespace import of one (`import * as
 * vt from 'vitest'`) puts every callee behind a single binding, so the binding
 * itself has to count as a test callee — otherwise `vt.it` + a modifier shrinks
 * the suite with the rule watching. The module list keeps that from spreading
 * to `import * as path from 'node:path'`.
 */
const TEST_MODULES = new Set(['vitest', 'node:test', 'bun:test', 'jest', '@jest/globals', 'mocha']);

/**
 * Wrappers that are erased at emit, so the call they wrap is the call that runs:
 * `it!`, `(it as unknown as typeof it)`, `(it satisfies typeof it)`, `(<X>it)`,
 * `it?.` and the instantiation form all leave `it` as the real callee. Each keeps
 * the wrapped node under `expression`.
 */
const TRANSPARENT_WRAPPERS = new Set([
  'TSNonNullExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
  'ChainExpression',
]);

/** The identifier a member/call chain is rooted at: `it.only.each(x).y` -> `it`. */
function rootIdentifier(target: Rule.Node | null | undefined): string | undefined {
  if (!target) return undefined;
  if (target.type === 'Identifier') return target.name;
  if (target.type === 'MemberExpression') return rootIdentifier(target.object as Rule.Node);
  if (target.type === 'CallExpression') return rootIdentifier(target.callee as Rule.Node);
  if (TRANSPARENT_WRAPPERS.has(target.type)) {
    return rootIdentifier((target as unknown as { expression?: Rule.Node }).expression);
  }
  return undefined;
}

/**
 * Whether an initialiser is (an await of) a dynamic import of a runner module:
 * `await import('vitest')`, `import('node:test')`. The binding it feeds hands out
 * the runner's own openers, so a modifier taken off it is the same surgery as one
 * taken off a static import.
 */
function isRunnerImport(target: Rule.Node | null | undefined): boolean {
  if (!target) return false;
  if (target.type === 'AwaitExpression') {
    return isRunnerImport(target.argument as Rule.Node);
  }
  if (target.type === 'ImportExpression') {
    const source = target.source;
    return (
      source.type === 'Literal' && typeof source.value === 'string' && TEST_MODULES.has(source.value)
    );
  }
  return false;
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
function isTestCallee(
  scope: Scope.Scope | null,
  name: string,
  inTestFile: boolean,
  seen: Set<Scope.Variable> = new Set(),
): boolean {
  const variable = lookup(scope, name);
  // Unresolved: the runner injects its callees as globals. The unambiguous
  // openers qualify anywhere; the ordinary words `context`/`bench` qualify only
  // inside a test file — see GLOBAL_TEST_CALLEES.
  if (variable === undefined) {
    return GLOBAL_TEST_CALLEES.has(name) || (inTestFile && TEST_CALLEES.has(name));
  }

  // `const it = it` and mutually-referring bindings would otherwise walk forever.
  if (seen.has(variable)) return false;
  seen.add(variable);

  return variable.defs.some((def) => {
    if (def.type === 'ImportBinding') {
      const specifier = def.node;
      // An import is judged by the module it came from, never by its name alone.
      // A domain module is free to export a function called `test` or an object
      // called `context`, and a property of it is ordinary code — and Q-08 also
      // forbids the suppression comment, so a false report here leaves no way
      // out but renaming domain code to please a lint rule.
      const source = def.parent.source.value;
      const fromRunner = typeof source === 'string' && TEST_MODULES.has(source);
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
        // Inside a test file the module the opener arrived through proves nothing:
        // a one-line barrel (`export { describe, it } from 'vitest'`) is the
        // ordinary way a repo grows shared test helpers, the runner honours the
        // modifier through it, and the suite shrinks with the rule watching. So
        // there the imported name is the discrimination. Outside a test file it
        // stays the module, so a domain module exporting a `test` is ordinary code.
        if (!fromRunner && !inTestFile) return false;
        return TEST_CALLEES.has(specifier.imported.name);
      }
      if (!fromRunner) return false;
      // A namespace import stands in for every callee the runner exports, so a
      // modifier taken off it is the same surgery.
      return specifier.type === 'ImportNamespaceSpecifier';
    }
    if (def.type === 'Variable') {
      const init = def.node.type === 'VariableDeclarator' ? def.node.init : null;
      // `const { it } = await import('vitest')` hides the runner from the binding
      // as effectively as a barrel does: there is no import declaration to judge
      // and no identifier to follow, only the module specifier.
      if (isRunnerImport(init as Rule.Node | null)) return true;
      const root = rootIdentifier(init as Rule.Node | null);
      if (root === undefined) return false;
      // An alias chain is followed to its end, however long: `it` behind five
      // `const` hops is still the callee that runs, and a hop budget is just a
      // number the next escape writes one more line than. What must not happen
      // is looping, so the chain is walked with the bindings already visited.
      return isTestCallee(scope, root, inTestFile, seen);
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
    const inTestFile = TEST_FILE.test(context.filename);

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
        if (!isTestCallee(context.sourceCode.getScope(node), root, inTestFile)) return;

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

      /**
       * Destructuring lifts the modifier off the callee, so no MemberExpression
       * ever names it — and the suite shrinks exactly as much as the member form
       * would. The pattern is the member access.
       */
      VariableDeclarator(node): void {
        if (node.id.type !== 'ObjectPattern' || node.init === null || node.init === undefined) return;
        const root = rootIdentifier(node.init as Rule.Node);
        if (root === undefined) return;
        if (!isTestCallee(context.sourceCode.getScope(node as Rule.Node), root, inTestFile)) return;

        for (const property of node.id.properties) {
          if (property.type !== 'Property') continue;
          const key = property.key;
          const named =
            key.type === 'Identifier' && !property.computed
              ? key.name
              : key.type === 'Literal' && typeof key.value === 'string'
                ? key.value
                : undefined;
          if (named === undefined) {
            // A key this rule cannot read is how one would smuggle the modifier
            // past it, exactly as with a computed member.
            if (property.computed) context.report({ node: property, messageId: 'dynamicTestMember' });
            continue;
          }
          if (MODIFIERS.has(named)) context.report({ node: property, messageId: 'testModifier' });
        }
      },

      TSAnyKeyword(node: Rule.Node): void {
        context.report({ node, messageId: 'looseType' });
      },
    };
  },
};
