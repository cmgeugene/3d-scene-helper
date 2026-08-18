import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { companionDevSessionPath } from './devSession';

function isLoopbackAddress(address: string | undefined) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === ':ffff:127.0.0.1' ||
    address === '::ffff:127.0.0.1'
  );
}

export function companionDevSessionPlugin(repoRoot = process.cwd()): Plugin {
  return {
    name: 'i2v-companion-dev-session',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/__i2v/companion-connection') {
          next();
          return;
        }
        if (!isLoopbackAddress(request.socket.remoteAddress)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        void readFile(companionDevSessionPath(repoRoot), 'utf8')
          .then((raw) => {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');
            response.end(raw);
          })
          .catch(() => {
            response.statusCode = 404;
            response.end();
          });
      });
    },
  };
}
