import path from 'node:path';

export interface CompanionCliOptions {
  projectRoot: string;
  port: number;
  editorUrl: string;
  allowedOrigins: string[];
}

export function parseCompanionCliOptions(args: string[]): CompanionCliOptions {
  let projectRoot = process.cwd();
  let port = 0;
  let editorUrl = 'http://127.0.0.1:5173';
  const allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--project-root' && value !== undefined) {
      projectRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (flag === '--port' && value !== undefined) {
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error('--port는 0부터 65535 사이의 정수여야 합니다.');
      }
      index += 1;
      continue;
    }
    if (flag === '--origin' && value !== undefined) {
      allowedOrigins.push(new URL(value).origin);
      index += 1;
      continue;
    }
    if (flag === '--editor-url' && value !== undefined) {
      editorUrl = new URL(value).toString();
      allowedOrigins.push(new URL(editorUrl).origin);
      index += 1;
      continue;
    }
    throw new Error(`알 수 없는 Companion 옵션입니다: ${flag}`);
  }

  return { projectRoot, port, editorUrl, allowedOrigins };
}
