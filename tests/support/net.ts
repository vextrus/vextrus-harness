import { createServer, type Server } from 'node:net';

/** Opens a listening TCP socket, standing in for a reachable service. */
export const listenOn = (port: number): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });

export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });

/** A port nothing is listening on: bind it, read the number, release it. */
export const closedPort = async (): Promise<number> => {
  const server = await listenOn(0);
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await closeServer(server);
  return port;
};
