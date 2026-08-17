import { CodexAppServerClient } from './appServerClient';
import { startCompanionServer, type CompanionServerHandle } from './server';

const runtime = new CodexAppServerClient({ cwd: process.cwd() });
let server: CompanionServerHandle | null = null;

try {
  await runtime.start();
  server = await startCompanionServer({
    runtime,
    projectRoot: process.cwd(),
    allowedOrigins: ['http://127.0.0.1:5173'],
  });
  const healthResponse = await fetch(`${server.url}/healthz`);
  const runtimeResponse = await fetch(`${server.url}/api/runtime`, {
    headers: {
      Authorization: `Bearer ${server.token}`,
      Origin: 'http://127.0.0.1:5173',
    },
  });
  if (!healthResponse.ok || !runtimeResponse.ok) {
    throw new Error('Companion loopback API smoke 검사가 실패했습니다.');
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      companionApi: true,
      state: runtime.status.state,
      version: runtime.status.version,
      accountType: runtime.status.account?.type ?? null,
      requiresOpenaiAuth: runtime.status.requiresOpenaiAuth,
    })}\n`,
  );
} finally {
  await server?.close();
  await runtime.stop();
}
