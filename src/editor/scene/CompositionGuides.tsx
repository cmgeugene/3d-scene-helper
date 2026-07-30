import { SAFE_AREA_INSETS } from '../constants';
import type { GuideVisibility } from '../types';

interface CompositionGuidesProps {
  visibility: GuideVisibility;
}

export function CompositionGuides({ visibility }: CompositionGuidesProps) {
  return (
    <div className="composition-guides" aria-hidden="true">
      {visibility.thirds ? (
        <>
          <span
            className="composition-line composition-line--vertical"
            data-testid="thirds-vertical-1"
            style={{ left: `${100 / 3}%` }}
          />
          <span
            className="composition-line composition-line--vertical"
            data-testid="thirds-vertical-2"
            style={{ left: `${200 / 3}%` }}
          />
          <span
            className="composition-line composition-line--horizontal"
            data-testid="thirds-horizontal-1"
            style={{ top: `${100 / 3}%` }}
          />
          <span
            className="composition-line composition-line--horizontal"
            data-testid="thirds-horizontal-2"
            style={{ top: `${200 / 3}%` }}
          />
        </>
      ) : null}
      {visibility.center ? (
        <>
          <span
            className="composition-line composition-line--center composition-line--vertical"
            data-testid="center-vertical"
            style={{ left: '50%' }}
          />
          <span
            className="composition-line composition-line--center composition-line--horizontal"
            data-testid="center-horizontal"
            style={{ top: '50%' }}
          />
        </>
      ) : null}
      {visibility.actionSafe ? (
        <span
          className="composition-safe composition-safe--action"
          data-testid="action-safe"
          style={{ inset: `${SAFE_AREA_INSETS.action * 100}%` }}
        />
      ) : null}
      {visibility.titleSafe ? (
        <span
          className="composition-safe composition-safe--title"
          data-testid="title-safe"
          style={{ inset: `${SAFE_AREA_INSETS.title * 100}%` }}
        />
      ) : null}
    </div>
  );
}
