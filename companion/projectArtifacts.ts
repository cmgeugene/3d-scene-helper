import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export async function resolveProjectArtifact(
  projectRoot: string,
  artifactPath: string,
) {
  if (artifactPath.trim() === '' || path.isAbsolute(artifactPath)) {
    throw new Error(
      'artifact 경로는 프로젝트 assets 내부의 상대 경로여야 합니다.',
    );
  }

  const requestedAssetsRoot = path.resolve(projectRoot, 'assets');
  const requestedPath = path.resolve(requestedAssetsRoot, artifactPath);
  const requestedRelative = path.relative(requestedAssetsRoot, requestedPath);
  if (
    requestedRelative.startsWith('..') ||
    path.isAbsolute(requestedRelative)
  ) {
    throw new Error('프로젝트 assets 외부의 파일에는 접근할 수 없습니다.');
  }

  const assetsRoot = await realpath(requestedAssetsRoot);
  const resolved = await realpath(requestedPath);
  const relative = path.relative(assetsRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      '프로젝트 assets 외부를 가리키는 파일에는 접근할 수 없습니다.',
    );
  }

  const metadata = await stat(resolved);
  if (!metadata.isFile()) {
    throw new Error('artifact가 파일이 아닙니다.');
  }

  return resolved;
}
