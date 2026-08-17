import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const artifactRoot = path.join(
  repositoryRoot,
  '.artifacts',
  'browser-distribution',
  `${process.platform}-${process.arch}`,
);
const launchPath = path.join(artifactRoot, 'launch.mjs');
await access(launchPath).catch(() => {
  throw new Error(
    '브라우저 배포 artifact가 없습니다. npm run build:browser-distribution을 먼저 실행하세요.',
  );
});

const projectRoot = await mkdtemp(path.join(tmpdir(), 'i2v-browser-smoke-'));
const child = spawn(
  process.execPath,
  [launchPath, '--project-root', projectRoot, '--no-open'],
  { cwd: artifactRoot, stdio: ['ignore', 'pipe', 'pipe'] },
);
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4_000);
});

const exit = new Promise((resolve) => {
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
const ready = new Promise((resolve, reject) => {
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'companion.ready') resolve(event);
    } catch {
      // Ignore non-JSON child diagnostics without printing possible credentials.
    }
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    reject(
      new Error(
        `브라우저 배포 실행기가 준비 전에 종료되었습니다 (${code ?? signal}). ${stderr}`,
      ),
    );
  });
});

let result;
let lockRemained;
let browser;
try {
  let timeout;
  let event;
  try {
    event = await Promise.race([
      ready,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error('브라우저 배포 실행기 준비 시간이 초과되었습니다.'),
            ),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  const index = await fetch(event.url);
  const runtime = await fetch(`${event.url}/api/runtime`, {
    headers: { Authorization: `Bearer ${event.token}` },
  });
  const runtimeStatus = await runtime.json();
  if (!index.ok || !(await index.text()).includes('I2V 3D Scene Helper')) {
    throw new Error('bundle된 production 편집기를 읽지 못했습니다.');
  }
  if (!runtime.ok || runtimeStatus.state !== 'ready') {
    throw new Error(
      `bundle된 Companion runtime이 ready가 아닙니다: ${runtimeStatus.state ?? runtime.status}`,
    );
  }
  const { chromium } = await import('@playwright/test');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--use-gl=angle',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.goto(event.launchUrl);
  const connectionStatus = page.getByRole('status', {
    name: 'Companion 연결 상태',
  });
  await connectionStatus.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () =>
      globalThis.document
        .querySelector('[role="status"][aria-label="Companion 연결 상태"]')
        ?.textContent?.trim() === '연결됨',
    undefined,
    { timeout: 10_000 },
  );
  if ((await connectionStatus.textContent()) !== '연결됨') {
    throw new Error(
      'bundle된 편집기가 Companion 연결 상태를 복구하지 못했습니다.',
    );
  }
  if (browserErrors.length > 0) {
    throw new Error(
      `bundle된 편집기 브라우저 오류: ${browserErrors.join(' | ')}`,
    );
  }
  result = {
    type: 'browser-distribution.smokePassed',
    platform: process.platform,
    arch: process.arch,
    runtimeVersion: runtimeStatus.version,
    editorMode: event.lifecycle?.editorMode,
    browserConnected: true,
  };
} finally {
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null)
    child.kill('SIGTERM');
  await exit;
  lockRemained = await access(
    path.join(projectRoot, '.i2v-companion.lock'),
  ).then(
    () => true,
    () => false,
  );
  await rm(projectRoot, { recursive: true, force: true });
}

if (lockRemained) {
  throw new Error('브라우저 배포 실행기가 종료 후 project lock을 남겼습니다.');
}
process.stdout.write(`${JSON.stringify(result)}\n`);
