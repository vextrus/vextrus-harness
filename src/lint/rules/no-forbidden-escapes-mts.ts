/**
 * Q-08 over the explicit-module TypeScript surface.
 *
 * `tsconfig.json` includes `*.mts` and `eslint.config.ts` puts `**​/*.mts` under
 * the typed-linting block, so an `.mts` file is a first-class compiled source
 * file of this repo — and between the `.ts`/`.tsx` registration next door and
 * the JavaScript one beside it, `.mts` and `.cts` were the two extensions no
 * Q-08 registration lint. An extension the repo compiles but the guardrail
 * cannot see is where the next suppression comment goes: a file `pnpm verify`
 * typechecks, `pnpm test` may execute, and `eslint .` waves through.
 *
 * Same rule, third surface — a registration rather than a wider `files` glob for
 * the reason the JavaScript companion gives: the surfaces are separate so a
 * later change to one cannot silently move another.
 */
import { rule } from './no-forbidden-escapes';

export { rule };

/** The two module-explicit TypeScript extensions; `.ts`/`.tsx` are next door. */
export const files = ['**/*.mts', '**/*.cts'];
export const severity = 'error' as const;
