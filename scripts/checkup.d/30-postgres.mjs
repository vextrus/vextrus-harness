/** A raw TCP connect — the database's own driver is not a dependency of checkup. */
import { connect } from 'node:net';

import { report, summarise } from '../lib/report.mjs';

const CONTRACT_PORT = 5544;
const FACT = `postgres-${CONTRACT_PORT}`;

// An exported-but-empty override is the ordinary shell accident; it falls back
// to the contract port rather than silently probing port 0.
const override = (process.env['CHECKUP_PG_PORT'] ?? '').trim();
const port = override === '' ? CONTRACT_PORT : Number(override);
const host = process.env['CHECKUP_PG_HOST'] ?? '127.0.0.1';

const probeable = Number.isInteger(port) && port > 0 && port <= 65535;

// A target that cannot be probed is a failed fact, not a stack trace: the report
// still names it (AC-03).
const reachable = probeable
  ? await new Promise((resolve) => {
      const finish = (value) => resolve(value);
      try {
        const socket = connect({ host, port });
        const settle = (value) => {
          socket.destroy();
          finish(value);
        };
        socket.setTimeout(2000);
        socket.once('connect', () => settle(true));
        socket.once('timeout', () => settle(false));
        socket.once('error', () => settle(false));
      } catch {
        finish(false);
      }
    })
  : false;

const detail = !probeable
  ? `cannot probe ${host}:${override} — not a usable TCP port`
  : reachable
    ? `reachable at ${host}:${port}`
    : `nothing listening at ${host}:${port}`;

process.exitCode = summarise([report(FACT, reachable, detail)]);
