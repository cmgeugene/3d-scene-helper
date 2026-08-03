import { CodexAppServerClient } from './appServerClient';
import { parseCompanionCliOptions } from './cli';
import { createCompanionLaunchUrl } from './launchUrl';
import { startCompanionServer } from './server';

const options = parseCompanionCliOptions(process.argv.slice(2));
const runtime = new CodexAppServerClient({ cwd: options.projectRoot });

await runtime.start();
const server = await startCompanionServer({
  runtime,
  projectRoot: options.projectRoot,
  allowedOrigins: options.allowedOrigins,
  port: options.port,
});
const launchUrl = createCompanionLaunchUrl(options.editorUrl, {
  url: server.url,
  token: server.token,
});

process.stdout.write(
  `${JSON.stringify({
    type: 'companion.ready',
    url: server.url,
    token: server.token,
    launchUrl,
    runtime: runtime.status,
  })}\n`,
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  await runtime.stop();
}

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
