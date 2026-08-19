/**
 * Q-08 over the module-flavoured TypeScript extensions.
 *
 * `.mts` and `.cts` are first-class compiled sources of this repo —
 * `tsconfig.json` includes `*.mts` and `eslint.config.ts` puts `**​/*.mts` under
 * the typed-linting block — but neither the interface-pinned `**​/*.ts` /
 * `**​/*.tsx` globs of `no-forbidden-escapes` nor the `.mjs`/`.cjs`/`.js` globs of
 * its JavaScript companion reach them. An extension the repo compiles with the
 * guardrail switched off over it is the escape hatch Q-08 forbids: the same
 * suppression comment that is an error in `probe.ts` would be legal in
 * `probe.mts`.
 *
 * Same rule, the extensions left over. A third registration rather than a wider
 * glob on either sibling, because the first's globs are pinned by the
 * increment's interface and the second's by its own fixture test.
 */
import { rule } from './no-forbidden-escapes';

export { rule };

/** The compiled extensions neither sibling registration covers. */
export const files = ['**/*.mts', '**/*.cts'];
export const severity = 'error' as const;
