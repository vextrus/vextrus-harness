/**
 * The typegen stage wrote this run's route types into its own scratch directory,
 * and `tsconfig.json` names no such directory: a `run-*` glob in the committed
 * config would feed every run's types — and every killed run's leftovers — to
 * both `pnpm verify` and a bare `pnpm typecheck`. So the types this run wrote are
 * added to a scratch config that lives and dies with this stage.
 */
import { runBin, verifyRunDir, withScratchTsconfig } from '../lib/stage.mjs';

process.exitCode = withScratchTsconfig(
  (_env, configName) => runBin('tsc', ['--noEmit', '-p', configName]),
  [`${verifyRunDir()}/typegen/types/**/*.ts`],
);
