import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('제품명을 최상위 제목으로 표시한다', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'I2V 3D Scene Helper',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: '에셋과 장면' }),
    ).toBeInTheDocument();
  });

  it('WebGL을 사용할 수 없으면 명시적인 대체 안내를 표시한다', async () => {
    render(<App />);

    expect(
      await screen.findByText(
        'WebGL을 사용할 수 없어 기본 안내 화면을 표시합니다.',
      ),
    ).toBeInTheDocument();
  });

  it('WebGL 컨텍스트를 만들 수 있으면 사용 가능 상태를 표시한다', async () => {
    const loseContext = vi.fn();
    const context = {
      getExtension: vi.fn(() => ({ loseContext })),
    } as unknown as WebGLRenderingContext;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(
      context,
    );

    render(<App />);

    expect(
      await screen.findByText('WebGL을 사용할 수 있습니다.'),
    ).toBeInTheDocument();
    expect(loseContext).toHaveBeenCalledOnce();
  });
});
