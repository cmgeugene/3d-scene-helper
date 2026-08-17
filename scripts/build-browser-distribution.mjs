import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const require = createRequire(import.meta.url);
const target = `${process.platform}-${process.arch}`;
const artifactRoot = path.join(
  repositoryRoot,
  '.artifacts',
  'browser-distribution',
  target,
);
const editorRoot = path.join(artifactRoot, 'editor');

const PLATFORM_CODEX_PACKAGES = {
  'darwin-arm64': '@openai/codex-darwin-arm64',
  'darwin-x64': '@openai/codex-darwin-x64',
  'linux-arm64': '@openai/codex-linux-arm64',
  'linux-x64': '@openai/codex-linux-x64',
  'win32-arm64': '@openai/codex-win32-arm64',
  'win32-x64': '@openai/codex-win32-x64',
};

const platformCodexPackage = PLATFORM_CODEX_PACKAGES[target];
if (platformCodexPackage === undefined) {
  throw new Error(`지원하지 않는 브라우저 배포 target입니다: ${target}`);
}

function resolvePackageRoot(packageName) {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    emptyOutDir: false,
    minify: true,
    outDir: artifactRoot,
    rollupOptions: {
      output: { entryFileNames: 'companion.mjs' },
    },
    ssr: path.join(repositoryRoot, 'companion', 'index.ts'),
    target: 'node22',
  },
});

await cp(path.join(repositoryRoot, 'dist'), editorRoot, { recursive: true });
const codexPackageRoot = path.join(artifactRoot, 'node_modules', '@openai');
await mkdir(codexPackageRoot, { recursive: true });
await cp(
  resolvePackageRoot('@openai/codex'),
  path.join(codexPackageRoot, 'codex'),
  { recursive: true },
);
await cp(
  resolvePackageRoot(platformCodexPackage),
  path.join(codexPackageRoot, platformCodexPackage.split('/')[1]),
  { recursive: true },
);

const rootPackage = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
await writeFile(
  path.join(artifactRoot, 'launch.mjs'),
  `#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

process.argv.splice(
  2,
  0,
  '--editor-root',
  fileURLToPath(new URL('./editor/', import.meta.url)),
);
await import('./companion.mjs');
`,
  { mode: 0o755 },
);
await writeFile(
  path.join(artifactRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: 'i2v-3d-scene-helper-browser-distribution',
      version: rootPackage.version,
      private: true,
      type: 'module',
      engines: rootPackage.engines,
      scripts: { start: 'node launch.mjs' },
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  path.join(artifactRoot, 'README.md'),
  `# I2V 3D Scene Helper browser distribution

이 artifact는 ${target} 전용이며 Node.js ${rootPackage.engines.node}가 필요합니다.

\`\`\`bash
node launch.mjs --project-root /absolute/path/to/project
\`\`\`

기본 브라우저를 열지 않으려면 \`--no-open\`, 고정 포트를 사용하려면
\`--port <number> --strict-port\`를 추가합니다. 전체 옵션은 \`node launch.mjs --help\`로
확인합니다.
`,
);

const editorBytes = await directorySize(editorRoot);
const runnerBytes = (await stat(path.join(artifactRoot, 'companion.mjs'))).size;
const codexBytes = await directorySize(path.join(artifactRoot, 'node_modules'));
const manifest = {
  version: 1,
  appVersion: rootPackage.version,
  platform: process.platform,
  arch: process.arch,
  nodeRange: rootPackage.engines.node,
  codexPackage: platformCodexPackage,
  payloadBytes: {
    editor: editorBytes,
    runner: runnerBytes,
    codex: codexBytes,
    total: editorBytes + runnerBytes + codexBytes,
  },
};
await writeFile(
  path.join(artifactRoot, 'distribution-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

process.stdout.write(
  `${JSON.stringify({
    type: 'browser-distribution.ready',
    artifactRoot,
    ...manifest,
  })}\n`,
);
