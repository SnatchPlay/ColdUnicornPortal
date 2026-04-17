import { Component, type ErrorInfo, type ReactNode } from "react";
import { Banner, InlineLinkButton, Surface } from "./app-ui";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Protected app render failure", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="space-y-6">
        <Surface
          title="Workspace recovery required"
          subtitle="The protected application hit an unexpected rendering failure."
        >
          <div className="space-y-4">
            <Banner tone="danger">
              Reload the workspace. If the issue persists, verify the deployed build and runtime configuration before
              reopening access.
            </Banner>
            <InlineLinkButton
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload workspace
            </InlineLinkButton>
          </div>
        </Surface>
      </div>
    );
  }
}
