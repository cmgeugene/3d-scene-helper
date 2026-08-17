// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createCompanionLaunchUrl } from './launchUrl';

describe('createCompanionLaunchUrl', () => {
  it('연결 정보를 query가 아닌 fragment에 넣는다', () => {
    const launchUrl = new URL(
      createCompanionLaunchUrl('http://127.0.0.1:5173/editor?mode=dev', {
        url: 'http://127.0.0.1:61234',
        token: 'a'.repeat(43),
      }),
    );

    expect(launchUrl.search).toBe('?mode=dev');
    expect(launchUrl.search).not.toContain('token');
    expect(launchUrl.hash).toMatch(/^#companion=/);

    const encoded = launchUrl.hash.slice('#companion='.length);
    expect(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    ).toEqual({
      version: 1,
      url: 'http://127.0.0.1:61234',
      token: 'a'.repeat(43),
    });
  });
});
