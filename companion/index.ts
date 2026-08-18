import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CodexAppServerClient } from './appServerClient';
import { openBrowser } from './browserLauncher';
import {
  companionCliHelp,
  parseCompanionCliOptions,
  type CompanionCliOptions,
} from './cli';
import { acquireCompanionInstanceLock } from './instanceLock';
import { createCompanionLaunchUrl } from './launchUrl';
import { startCompanionServerWithPortFallback } from './serverLifecycle';
import {
  clearCompanionDevSession,
  writeCompanionDevSession,
} from './devSession';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const options = parseCompanionCliOptions(process.argv.slice(2));
if (options.showHelp) {
  process.stdout.write(companionCliHelp());
} else {
  await runCompanion(options);
}

async function runCompanion(options: CompanionCliOptions) {
  const instanceLock = await acquireCompanionInstanceLock(options.projectRoot);
  const runtime = new CodexAppServerClient({ cwd: options.projectRoot });
  let shuttingDown = false;
  let server:
    | Awaited<ReturnType<typeof startCompanionServerWithPortFallback>>['server']
    | null = null;

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await server?.close();
    await runtime.stop();
    await clearCompanionDevSession(repoRoot);
    await instanceLock.release();
  }

  try {
    await runtime.start();
    const started = await startCompanionServerWithPortFallback({
      runtime,
      projectRoot: options.projectRoot,
      allowedOrigins: options.allowedOrigins,
      port: options.port,
      fallbackOnPortConflict: options.fallbackOnPortConflict,
      imageProvider: options.imageProvider,
      oauthUrl: options.oauthUrl,
      imageModel: options.imageModel,
      imageQuality: options.imageQuality,
      reasoningEffort: options.reasoningEffort,
      ...(options.editorRoot === null
        ? {}
        : { editorRoot: options.editorRoot }),
    });
    server = started.server;
    await instanceLock.updateUrl(server.url);
    await writeCompanionDevSession(repoRoot, {
      url: server.url,
      token: server.token,
    });
    const launchUrl = createCompanionLaunchUrl(
      options.editorRoot === null ? options.editorUrl : server.url,
      {
        url: server.url,
        token: server.token,
      },
    );

    process.stdout.write(
      `${JSON.stringify({
        type: 'companion.ready',
        url: server.url,
        token: server.token,
        launchUrl,
        runtime: runtime.status,
        lifecycle: {
          pid: process.pid,
          requestedPort: started.requestedPort,
          usedFallbackPort: started.usedFallbackPort,
          browserOpened: options.openBrowser,
          editorMode:
            options.editorRoot === null ? 'external' : 'bundled-static',
        },
      })}\n`,
    );

    if (started.usedFallbackPort) {
      process.stderr.write(
        `${JSON.stringify({
          type: 'companion.portFallback',
          requestedPort: started.requestedPort,
          actualUrl: server.url,
        })}\n`,
      );
    }

    if (options.openBrowser) {
      try {
        await openBrowser(launchUrl);
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            type: 'companion.browserOpenFailed',
            message:
              error instanceof Error
                ? error.message
                : '기본 브라우저를 열지 못했습니다.',
            launchUrl,
          })}\n`,
        );
      }
    }
  } catch (error) {
    await shutdown();
    throw error;
  }

  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
}
