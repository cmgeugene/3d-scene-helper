import { describe, expect, it } from 'vitest';
import {
  createRefinementDirective,
  refinementDirectiveSchema,
} from '../../shared/refinementDirective';

describe('RefinementDirective', () => {
  it('줄 단위 유지·변경 지시를 trim한 version 1 계약으로 만든다', () => {
    expect(
      createRefinementDirective(
        ' 전봇대 가림을 줄이기\n표정은 더 밝게 ',
        '카메라 구도\n 인물 의상 ',
      ),
    ).toEqual({
      version: 1,
      preserve: ['카메라 구도', '인물 의상'],
      change: ['전봇대 가림을 줄이기', '표정은 더 밝게'],
    });
  });

  it('변경 항목이 없는 지시와 추가 필드를 거부한다', () => {
    expect(() => createRefinementDirective('', '카메라 구도')).toThrow();
    expect(
      refinementDirectiveSchema.safeParse({
        version: 1,
        preserve: [],
        change: ['조명'],
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('대소문자와 공백을 정규화해 중복 및 유지·변경 충돌을 거부한다', () => {
    expect(
      refinementDirectiveSchema.safeParse({
        version: 1,
        preserve: ['Camera', ' camera '],
        change: ['조명'],
      }).success,
    ).toBe(false);
    expect(
      refinementDirectiveSchema.safeParse({
        version: 1,
        preserve: ['인물 의상'],
        change: [' 인물 의상 '],
      }).success,
    ).toBe(false);
  });
});
