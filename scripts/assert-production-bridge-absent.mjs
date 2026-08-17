import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const distDirectory = path.join(projectRoot, 'dist');
const forbiddenMarkers = [
  '__I2V_EDITOR_STORE__',
  '__I2V_PREVIEW_RESOURCE_DIAGNOSTICS__',
  'runtimeCamera',
  'runtimeTransform',
  'transformObject',
  'transformDragging',
  'transformAxis',
  'gizmoOrigin',
  'orbitEnabled',
  'facingHelper',
  'runtimeLighting',
  'runtimeDof',
  'motionGuides',
  'mannequinRig',
  'mannequinPivots',
  'mannequinBounds',
  'mannequinCinematicLandmarks',
  'ikDragging',
  'ikHandleProjections',
  'ikHandPositions',
  'i2v:e2e-surface-grid-visibility',
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (/\.(?:html|js)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

const violations = [];
for (const file of await collectFiles(distDirectory)) {
  const content = await readFile(file, 'utf8');
  for (const marker of forbiddenMarkers) {
    if (content.includes(marker)) {
      violations.push(`${path.relative(projectRoot, file)}: ${marker}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Production build contains E2E-only diagnostics:\n${violations.join('\n')}`,
  );
}

console.log('Production build excludes E2E-only editor diagnostics.');
