import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const help = `I2V 개발 편집기와 Local Companion을 함께 실행합니다.

사용법:
  npm run dev:all
  npm run dev:all -- [Companion options]

기본값:
  editor       http://127.0.0.1:5173
  project root 현재 디렉터리

dev:all 옵션:
  --editor-port <port>  Vite 개발 서버 포트

나머지 옵션은 Companion으로 전달됩니다. 예:
  npm run dev:all -- --project-root /absolute/path --no-open
`;

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  process.stdout.write(help);
  process.exit(0);
}
let editorPort = 5173;
const companionArgs = [];
for (let index = 0; index < rawArgs.length; index += 1) {
  const argument = rawArgs[index];
  if (argument === '--editor-port') {
    const value = Number(rawArgs[index + 1]);
    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
      throw new Error('--editor-port는 1부터 65535 사이의 정수여야 합니다.');
    }
    editorPort = value;
    index += 1;
    continue;
  }
  companionArgs.push(argument);
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const vitePackageRoot = path.dirname(
  fileURLToPath(import.meta.resolve('vite/package.json')),
);
const viteCli = path.join(vitePackageRoot, 'bin', 'vite.js');
const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
const editorUrl = `http://127.0.0.1:${editorPort}`;
const projectRoot = process.cwd();
const children = [];
let stopping = false;

function start(command, args) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function childExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
  }
  await Promise.all(children.map(childExit));
}

function failWhenChildExits(child, label) {
  child.once('exit', (code, signal) => {
    if (stopping) return;
    const exitCode = code ?? (signal === null ? 1 : 128);
    process.stderr.write(
      `${label} 프로세스가 종료되었습니다 (${code ?? signal ?? 'unknown'}).\n`,
    );
    void stop().finally(() => process.exit(exitCode));
  });
}

async function waitForEditor(vite) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null || vite.signalCode !== null) {
      throw new Error('Vite가 준비 전에 종료되었습니다.');
    }
    try {
      const response = await fetch(editorUrl);
      if (response.ok) return;
    } catch {
      // Vite가 listen을 시작할 때까지 다시 확인한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Vite 개발 서버 준비 시간이 초과되었습니다.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void stop(signal).finally(() => process.exit(0)));
}

try {
  const vite = start(process.execPath, [
    viteCli,
    '--host',
    '127.0.0.1',
    '--port',
    String(editorPort),
    '--strictPort',
  ]);
  failWhenChildExits(vite, 'Vite');
  await waitForEditor(vite);

  const companion = start(process.execPath, [
    tsxCli,
    path.join(repositoryRoot, 'companion', 'index.ts'),
    '--project-root',
    projectRoot,
    '--editor-url',
    editorUrl,
    ...companionArgs,
  ]);
  failWhenChildExits(companion, 'Companion');
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'dev:all 시작에 실패했습니다.'}\n`,
  );
  await stop();
  process.exitCode = 1;
}
