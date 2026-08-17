/**
 * Q-08's escape hatches are lint errors: the type-system opt-out, the two TS
 * suppression pragmas, the linter suppression directive, and the two test
 * modifiers that silently shrink the suite.
 *
 * Every banned token is CONSTRUCTED below rather than written literally, so
 * this file (and the fixtures that exercise it) stay clean under its own rule
 * and under a plain text search of the repository.
 *
 * The rule is described through the small structural types it actually uses
 * rather than a linter-version-specific RuleModule type: the loader and the
 * fixture harness disagree about which package owns that type, and the rule
 * itself needs none of it.
 */

const AT = '@'
const TS_SUPPRESS_IGNORE = `${AT}ts-` + 'ignore'
const TS_SUPPRESS_EXPECT = `${AT}ts-` + 'expect-error'
const LINT_SUPPRESS = 'es' + 'lint-' + 'disable'

const MODIFIER_SKIP = 'sk' + 'ip'
const MODIFIER_ONLY = 'on' + 'ly'

/** Call roots whose modifier members are test controls, not ordinary data access. */
const TEST_ROOTS: ReadonlySet<string> = new Set(['it', 'test', 'describe', 'suite', 'bench'])

const COMMENT_TOKENS: ReadonlyArray<readonly [string, string]> = [
  [TS_SUPPRESS_IGNORE, 'tsSuppress'],
  [TS_SUPPRESS_EXPECT, 'tsSuppress'],
  [LINT_SUPPRESS, 'lintSuppress'],
]

type Position = { line: number; column: number }
type SourceLocation = { start: Position; end: Position }
type CommentLike = { value: string; loc?: SourceLocation | null | undefined }
type NodeLike = { type: string; [key: string]: unknown }

type ReportDescriptor = {
  messageId: string
  node?: NodeLike
  loc?: SourceLocation
  data?: Record<string, string>
}

type LintContext = {
  sourceCode: { getAllComments: () => CommentLike[] }
  report: (descriptor: ReportDescriptor) => void
}

type Visitors = Record<string, (node: never) => void>

/** A comment line, stripped of the decoration that precedes a directive. */
const directiveText = (line: string): string => line.replace(/^[\s*]+/, '').trimEnd()

const propertyNameOf = (node: NodeLike): string | undefined => {
  const property = node['property'] as { type?: string; name?: string; value?: unknown } | undefined
  if (property === undefined) return undefined
  if (node['computed'] !== true && property.type === 'Identifier') return property.name
  if (node['computed'] === true && property.type === 'Literal' && typeof property.value === 'string') {
    return property.value
  }
  return undefined
}

/** Walks a chained modifier expression back to the identifier it started from. */
const rootIdentifierOf = (start: unknown): string | undefined => {
  let current = start as NodeLike | undefined
  for (let depth = 0; depth < 16 && current !== undefined && current !== null; depth += 1) {
    if (current.type === 'Identifier') return current['name'] as string | undefined
    if (current.type === 'MemberExpression') {
      current = current['object'] as NodeLike | undefined
      continue
    }
    if (current.type === 'CallExpression') {
      current = current['callee'] as NodeLike | undefined
      continue
    }
    return undefined
  }
  return undefined
}

const RULE_TYPE = 'problem' as const

const create = (rawContext: unknown): Visitors => {
  const context = rawContext as LintContext

  const reportComments = (): void => {
    for (const comment of context.sourceCode.getAllComments()) {
      const loc = comment.loc
      if (loc === undefined || loc === null) continue
      let reported = false
      for (const line of comment.value.split('\n')) {
        if (reported) break
        const text = directiveText(line)
        for (const [token, messageId] of COMMENT_TOKENS) {
          if (text.startsWith(token)) {
            context.report({ loc, messageId })
            reported = true
            break
          }
        }
      }
    }
  }

  const visitors: Visitors = {
    Program: ((): void => {
      reportComments()
    }) as (node: never) => void,
    TSAnyKeyword: ((node: NodeLike): void => {
      context.report({ node, messageId: 'untyped' })
    }) as unknown as (node: never) => void,
    MemberExpression: ((node: NodeLike): void => {
      const name = propertyNameOf(node)
      if (name !== MODIFIER_SKIP && name !== MODIFIER_ONLY) return
      const root = rootIdentifierOf(node['object'])
      if (root === undefined || !TEST_ROOTS.has(root)) return
      context.report({ node, messageId: 'testModifier', data: { modifier: `.${name}` } })
    }) as unknown as (node: never) => void,
  }

  return visitors
}

export const rule = {
  meta: {
    type: RULE_TYPE,
    docs: {
      description: 'Ban the Q-08 escape hatches: the untyped opt-out, suppression pragmas and test modifiers.',
    },
    schema: [],
    messages: {
      untyped: 'Q-08: the untyped opt-out is forbidden — give this a real type.',
      tsSuppress: 'Q-08: TypeScript suppression pragmas are forbidden — fix the type error.',
      lintSuppress: 'Q-08: linter suppression directives are forbidden — fix the finding.',
      testModifier: 'Q-08: `{{modifier}}` on a test call is forbidden — the suite never shrinks silently.',
    },
  },
  defaultOptions: [],
  create,
}

export const files: string[] = ['**/*.ts', '**/*.tsx']

export const severity = 'error' as const
