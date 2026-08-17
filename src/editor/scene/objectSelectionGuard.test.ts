import { describe, expect, it } from 'vitest';
import {
  consumeObjectSelectionSuppression,
  suppressNextObjectSelection,
} from './objectSelectionGuard';

describe('objectSelectionGuard', () => {
  it('suppresses the first object selection after a gizmo or IK drag', () => {
    expect(consumeObjectSelectionSuppression()).toBe(false);

    suppressNextObjectSelection();
    expect(consumeObjectSelectionSuppression()).toBe(true);
    expect(consumeObjectSelectionSuppression()).toBe(false);
  });
});
