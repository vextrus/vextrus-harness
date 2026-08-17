import type { Rule } from 'eslint';

/**
 * Q-08 — the six forbidden escapes are lint errors:
 *   unspecified type annotations, the two compiler-suppression comments,
 *   every lint-disable comment variant, and exclusive/skipped test modifiers.
 *
 * Every forbidden token is assembled by concatenation (AC-13). Written
 * literally, this file's own comments would trip the rule it defines and the
 * repo's `eslint .` would go red on its own guardrail.
 */
const SUPPRESSION_TOKENS = [
  `@ts-${'ignore'}`,
  `@ts-${'expect'}-error`,
  `eslint-${'disable'}`,
] as const;

const TEST_MODIFIERS = new Set([`s${'kip'}`, `o${'nly'}`]);

/** Callees whose `.skip`/`.only` are test-runner modifiers rather than data. */
const TEST_CALLEES = new Set(['it', 'test', 'describe', 'suite', 'bench', 'xit', 'xdescribe']);

interface NodeLike {
  readonly type: string;
  readonly name?: string;
  readonly object?: NodeLike;
  readonly property?: NodeLike;
  readonly callee?: NodeLike;
  readonly computed?: boolean;
}

interface InlineConfigAware {
  readonly getInlineConfigNodes?: () => readonly unknown[];
}

/** Walk `a.b().c` back to the identifier it hangs off, or undefined. */
function rootIdentifier(node: NodeLike | undefined): string | undefined {
  let current = node;
  for (let hop = 0; current !== undefined && hop < 16; hop += 1) {
    if (current.type === 'Identifier') return current.name;
    if (current.type === 'MemberExpression') {
      current = current.object;
      continue;
    }
    if (current.type === 'CallExpression') {
      current = current.callee;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/**
 * When `noInlineConfig` is in force ESLint already reports, on its own, every
 * comment it recognises as a directive — so by default this rule stays quiet on
 * those and a single comment is reported exactly once. A host that would rather
 * see the guardrail name itself in the transcript sets
 * `settings.vextrus.reportLinterDirectives`.
 */
function wantsLinterDirectives(settings: Rule.RuleContext['settings']): boolean {
  const namespace: unknown = settings['vextrus'];
  if (typeof namespace !== 'object' || namespace === null) return false;
  return (namespace as Record<string, unknown>)['reportLinterDirectives'] === true;
}

export const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid the Q-08 escape hatches: unspecified type annotations, compiler-suppression comments, lint-disable comments and exclusive/skipped test modifiers.',
    },
    schema: [],
    messages: {
      unspecifiedType: 'Q-08: the unspecified type annotation is forbidden — name the real type.',
      suppressionComment: 'Q-08: the suppression comment "{{token}}" is forbidden — fix the cause.',
      testModifier: 'Q-08: "{{callee}}.{{modifier}}" is forbidden — every test runs, every time.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const reportLinterDirectives = wantsLinterDirectives(context.settings);

    const listener = {
      TSAnyKeyword(node: NodeLike): void {
        context.report({ node: node as unknown as Rule.Node, messageId: 'unspecifiedType' });
      },
      MemberExpression(node: NodeLike): void {
        if (node.computed === true) return;
        const property = node.property;
        if (property?.type !== 'Identifier') return;
        const modifier = property.name;
        if (modifier === undefined || !TEST_MODIFIERS.has(modifier)) return;
        const callee = rootIdentifier(node.object);
        if (callee === undefined || !TEST_CALLEES.has(callee)) return;
        context.report({
          node: node as unknown as Rule.Node,
          messageId: 'testModifier',
          data: { callee, modifier },
        });
      },
      Program(): void {
        const sourceCode = context.sourceCode;
        // `getInlineConfigNodes` is present on ESLint's JS source code but is
        // not in the published `SourceCode` surface, so it is read defensively.
        const inlineConfigNodes = (sourceCode as unknown as InlineConfigAware)
          .getInlineConfigNodes;
        const alreadyReported = reportLinterDirectives
          ? new Set<unknown>()
          : new Set<unknown>(inlineConfigNodes?.call(sourceCode) ?? []);

        for (const comment of sourceCode.getAllComments()) {
          if (alreadyReported.has(comment)) continue;
          const found = SUPPRESSION_TOKENS.find((token) => comment.value.includes(token));
          if (found === undefined) continue;
          const loc = comment.loc;
          if (loc === null || loc === undefined) continue;
          context.report({ loc, messageId: 'suppressionComment', data: { token: found } });
        }
      },
    };
    return listener as unknown as Rule.RuleListener;
  },
};

export const files: string[] = ['**/*.ts', '**/*.tsx'];

export const severity: 'error' | 'warn' = 'error';
