// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { companionCliHelp, parseCompanionCliOptions } from './cli';

describe('Companion CLI options', () => {
  it('기본적으로 브라우저 자동 실행과 포트 fallback을 사용한다', () => {
    expect(parseCompanionCliOptions([])).toMatchObject({
      port: 0,
      editorUrl: 'http://127.0.0.1:5173',
      openBrowser: true,
      fallbackOnPortConflict: true,
      editorRoot: null,
      showHelp: false,
      imageProvider: 'oauth',
      oauthUrl: null,
      imageModel: 'gpt-5.4-mini',
      imageQuality: 'medium',
      reasoningEffort: 'none',
    });
  });

  it('headless와 strict port 옵션을 명시적으로 선택한다', () => {
    expect(
      parseCompanionCliOptions([
        '--project-root',
        '.',
        '--port',
        '61234',
        '--editor-url',
        'http://127.0.0.1:4173',
        '--editor-root',
        './dist',
        '--no-open',
        '--strict-port',
      ]),
    ).toMatchObject({
      port: 61234,
      editorUrl: 'http://127.0.0.1:4173/',
      openBrowser: false,
      fallbackOnPortConflict: false,
      editorRoot: expect.stringMatching(/dist$/),
    });
  });

  it('배포 실행기 도움말을 runtime 시작 없이 선택한다', () => {
    expect(parseCompanionCliOptions(['--help']).showHelp).toBe(true);
    expect(parseCompanionCliOptions(['-h']).showHelp).toBe(true);
    expect(companionCliHelp()).toContain('--editor-root <path>');
    expect(companionCliHelp()).toContain('--project-root <path>');
    expect(companionCliHelp()).toContain('--image-provider <id>');
    expect(companionCliHelp()).toContain('--oauth-url <url>');
  });

  it('oauth 이미지 공급자 옵션을 선택한다', () => {
    expect(
      parseCompanionCliOptions([
        '--image-provider',
        'oauth',
        '--oauth-url',
        'http://127.0.0.1:10541',
        '--image-model',
        'gpt-5.4',
        '--image-quality',
        'low',
        '--reasoning-effort',
        'high',
      ]),
    ).toMatchObject({
      imageProvider: 'oauth',
      oauthUrl: 'http://127.0.0.1:10541',
      imageModel: 'gpt-5.4',
      imageQuality: 'low',
      reasoningEffort: 'high',
    });
  });
});
