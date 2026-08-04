import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' blob: data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join('; ');

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export interface StaticEditor {
  readonly root: string;
  serve(
    pathname: string,
    response: ServerResponse,
    headOnly?: boolean,
  ): Promise<boolean>;
}

export async function createStaticEditor(
  editorRoot: string,
): Promise<StaticEditor> {
  const root = await realpath(path.resolve(editorRoot));
  const indexPath = path.join(root, 'index.html');
  const hasIndex = await stat(indexPath)
    .then((entry) => entry.isFile())
    .catch(() => false);
  if (!hasIndex) {
    throw new Error(`편집기 배포 루트에 index.html이 없습니다: ${root}`);
  }

  return {
    root,
    async serve(pathname, response, headOnly = false) {
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(pathname);
      } catch {
        return false;
      }
      const relativePath =
        decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
      if (relativePath.length === 0 || relativePath.includes('\0'))
        return false;
      const requestedPath = path.resolve(root, ...relativePath.split('/'));
      if (!isInsideRoot(root, requestedPath)) return false;

      let filePath: string;
      try {
        filePath = await realpath(requestedPath);
        if (!isInsideRoot(root, filePath) || !(await stat(filePath)).isFile()) {
          return false;
        }
      } catch {
        return false;
      }

      const extension = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[extension];
      if (contentType === undefined) return false;
      const content = await readFile(filePath);
      response.writeHead(200, {
        'Cache-Control':
          extension === '.html'
            ? 'no-store'
            : 'public, max-age=31536000, immutable',
        'Content-Length': content.byteLength,
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'Content-Type': contentType,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      response.end(headOnly ? undefined : content);
      return true;
    },
  };
}
