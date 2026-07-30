import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GuideVisibility } from '../types';
import { CompositionGuides } from './CompositionGuides';

const allVisible: GuideVisibility = {
  thirds: true,
  center: true,
  actionSafe: true,
  titleSafe: true,
  motion: false,
};

describe('CompositionGuides', () => {
  it('thirds, center, action-safe 5%, title-safe 10% geometry를 DOM overlay로 그린다', () => {
    render(<CompositionGuides visibility={allVisible} />);

    expect(screen.getByTestId('thirds-vertical-1')).toHaveStyle({
      left: '33.333333333333336%',
    });
    expect(screen.getByTestId('thirds-vertical-2')).toHaveStyle({
      left: '66.66666666666667%',
    });
    expect(screen.getByTestId('thirds-horizontal-1')).toHaveStyle({
      top: '33.333333333333336%',
    });
    expect(screen.getByTestId('thirds-horizontal-2')).toHaveStyle({
      top: '66.66666666666667%',
    });
    expect(screen.getByTestId('center-vertical')).toHaveStyle({ left: '50%' });
    expect(screen.getByTestId('center-horizontal')).toHaveStyle({ top: '50%' });
    expect(screen.getByTestId('action-safe')).toHaveStyle({ inset: '5%' });
    expect(screen.getByTestId('title-safe')).toHaveStyle({ inset: '10%' });
  });

  it('hide-all visibility에서는 guide geometry를 모두 제거한다', () => {
    const { rerender } = render(<CompositionGuides visibility={allVisible} />);

    rerender(
      <CompositionGuides
        visibility={{
          thirds: false,
          center: false,
          actionSafe: false,
          titleSafe: false,
          motion: false,
        }}
      />,
    );

    expect(screen.queryByTestId(/^thirds-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^center-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-safe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('title-safe')).not.toBeInTheDocument();
  });
});
