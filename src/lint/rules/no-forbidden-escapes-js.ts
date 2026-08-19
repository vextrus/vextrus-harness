/**
 * Q-08 over the plain-JavaScript surface.
 *
 * The drop-in runners are `.mjs` — `scripts/verify.mjs`, `scripts/checkup.mjs`,
 * `scripts/lib/*.mjs` and every stage and fact file a later increment drops in —
 * and they belong to no tsconfig project, so the TypeScript-scoped registration
 * next door cannot see them. That would leave the extension seam this increment
 * exists to create as the one place in the repo where a suppression comment is
 * legal: exactly the hole Q-08 names, widening with every increment.
 *
 * Same rule, different surface. It is a second registration rather than a wider
 * `files` glob on the first because the first's globs are pinned by the
 * increment's interface, and because the two surfaces are parsed by different
 * parsers — keeping them apart means a later change to one cannot silently move
 * the other. `.mts`/`.cts` are the sibling registration beside this one.
 */
import { rule } from './no-forbidden-escapes';

export { rule };

/** Everything JavaScript in the tree; the ignores in `eslint.config.ts` scope it. */
export const files = ['**/*.mjs', '**/*.cjs', '**/*.js'];
export const severity = 'error' as const;
