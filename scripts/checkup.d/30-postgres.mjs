import { tcpReachable } from '../lib/probe.mjs';

/**
 * A raw TCP connect, not a driver: V-CHECKUP must not drag a database client
 * into the toolchain. `CHECKUP_PG_PORT` exists so failure can be simulated
 * without touching the machine.
 */
const PORT = Number(process.env.CHECKUP_PG_PORT ?? '5544');

export const facts = [
  {
    name: 'postgres-5544',
    check: () => tcpReachable('127.0.0.1', PORT),
  },
];
