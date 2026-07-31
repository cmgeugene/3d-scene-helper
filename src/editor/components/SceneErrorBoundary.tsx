import { Component, type ReactNode } from 'react';

interface SceneErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface SceneErrorBoundaryState {
  failed: boolean;
}

export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  state: SceneErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="viewport-placeholder" role="alert">
          <p className="eyebrow">3D 표시 오류</p>
          <h2>장면 데이터는 안전합니다</h2>
          <p>
            3D 뷰포트를 표시하지 못했습니다. 직렬화된 장면 데이터는
            보존되었습니다.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
