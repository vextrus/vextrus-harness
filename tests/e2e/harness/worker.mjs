#!/usr/bin/env node
/**
 * The lane's worker process — a no-op, on purpose.
 *
 * V-E2E says the lane starts "web (3211) + worker": the journeys of later
 * milestones wait on jobs, and a job queue that only exists in CI is a queue the
 * lane cannot prove. M1 puts the real loop behind this entry point; until then
 * it does the two things the lane actually depends on — it announces itself on
 * stdout, so the runner can order its stage lines against a process rather than
 * against a sleep, and it stays up until the runner takes it down.
 *
 *   MODEL_TRANSPORT=fixture node tests/e2e/harness/worker.mjs
 */

// V-E2E: "Model calls use fixture transport." That is a property of the lane,
// not a request the environment gets to make, so the entry pins fixture whatever
// it was asked for and says so on stderr — the announcement below is always the
// same line.
const requested = (process.env.MODEL_TRANSPORT ?? '').trim();

if (requested && requested !== 'fixture') {
  process.stderr.write(`e2e: worker ignoring MODEL_TRANSPORT=${requested}, pinning fixture\n`);
}

process.env.MODEL_TRANSPORT = 'fixture';

process.stdout.write('e2e: worker ready (noop) transport=fixture\n');

// Nothing to do, and nothing to poll: hold the event loop with a handle the
// signal handlers can clear, so SIGTERM ends the process rather than orphaning it.
const idle = setInterval(() => undefined, 60_000);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    clearInterval(idle);
    process.exitCode = 0;
  });
}
