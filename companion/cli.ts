import path from 'node:path';

export interface CompanionCliOptions {
  projectRoot: string;
  port: number;
  editorUrl: string;
  allowedOrigins: string[];
  openBrowser: boolean;
  fallbackOnPortConflict: boolean;
  editorRoot: string | null;
  showHelp: boolean;
  imageProvider: 'codex' | 'oauth';
  oauthUrl: string | null;
  imageModel: string;
  imageQuality: 'low' | 'medium' | 'high' | 'auto';
  reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
}

export function companionCliHelp() {
  return `I2V 3D Scene Helper Local Companion

사용법:
  node launch.mjs [options]

옵션:
  --project-root <path>  장면 프로젝트 루트 (기본값: 현재 디렉터리)
  --editor-root <path>   빌드된 편집기 정적 파일 루트 (예: ./editor)
  --editor-url <url>     외부 개발 편집기 URL (기본값: http://127.0.0.1:5173)
  --port <number>        Companion loopback 포트 (기본값: 자동 선택)
  --origin <url>         추가로 허용할 브라우저 Origin
  --no-open              기본 브라우저를 자동으로 열지 않음
  --strict-port          지정 포트 충돌 시 빈 포트로 전환하지 않음
  --image-provider <id>  생성 경로: oauth(기본) 또는 codex
  --oauth-url <url>      이미 켜진 openai-oauth 주소. 없으면 Companion이 직접 기동
  --image-model <id>     OAuth Responses 모델 (기본값: gpt-5.4-mini)
  --image-quality <id>   OAuth image_generation quality (low|medium|high|auto)
  --reasoning-effort <id> OAuth reasoning.effort (none|low|medium|high|xhigh)
  --help, -h             이 도움말 표시
`;
}

export function parseCompanionCliOptions(args: string[]): CompanionCliOptions {
  let projectRoot = process.cwd();
  let port = 0;
  let editorUrl = 'http://127.0.0.1:5173';
  const allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
  let openBrowser = true;
  let fallbackOnPortConflict = true;
  let editorRoot: string | null = null;
  let showHelp = false;
  let imageProvider: CompanionCliOptions['imageProvider'] = 'oauth';
  let oauthUrl: string | null = null;
  let imageModel = 'gpt-5.4-mini';
  let imageQuality: CompanionCliOptions['imageQuality'] = 'medium';
  let reasoningEffort: CompanionCliOptions['reasoningEffort'] = 'none';

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
    if (flag === '--editor-root' && value !== undefined) {
      editorRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (flag === '--no-open') {
      openBrowser = false;
      continue;
    }
    if (flag === '--strict-port') {
      fallbackOnPortConflict = false;
      continue;
    }
    if (flag === '--help' || flag === '-h') {
      showHelp = true;
      continue;
    }
    if (flag === '--image-provider' && value !== undefined) {
      if (value !== 'codex' && value !== 'oauth') {
        throw new Error('--image-provider는 codex 또는 oauth여야 합니다.');
      }
      imageProvider = value;
      index += 1;
      continue;
    }
    if (flag === '--oauth-url' && value !== undefined) {
      oauthUrl = new URL(value).origin;
      index += 1;
      continue;
    }
    if (flag === '--image-model' && value !== undefined) {
      imageModel = value;
      index += 1;
      continue;
    }
    if (flag === '--image-quality' && value !== undefined) {
      if (!['low', 'medium', 'high', 'auto'].includes(value)) {
        throw new Error(
          '--image-quality는 low, medium, high, auto 중 하나여야 합니다.',
        );
      }
      imageQuality = value as CompanionCliOptions['imageQuality'];
      index += 1;
      continue;
    }
    if (flag === '--reasoning-effort' && value !== undefined) {
      if (!['none', 'low', 'medium', 'high', 'xhigh'].includes(value)) {
        throw new Error(
          '--reasoning-effort는 none, low, medium, high, xhigh 중 하나여야 합니다.',
        );
      }
      reasoningEffort = value as CompanionCliOptions['reasoningEffort'];
      index += 1;
      continue;
    }
    throw new Error(`알 수 없는 Companion 옵션입니다: ${flag}`);
  }

  return {
    projectRoot,
    port,
    editorUrl,
    allowedOrigins,
    openBrowser,
    fallbackOnPortConflict,
    editorRoot,
    showHelp,
    imageProvider,
    oauthUrl,
    imageModel,
    imageQuality,
    reasoningEffort,
  };
}
