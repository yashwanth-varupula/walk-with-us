import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level React error boundary.
 *
 * Purpose: an unexpected exception thrown while rendering must not leave the
 * user staring at a blank white page. This catches it and shows a recovery
 * screen with a way to retry.
 *
 * Scope and safety rules:
 * - It does NOT change routing, auth, data fetching, or any RLS behaviour.
 * - It never renders the raw error message, stack, or component stack to the
 *   user. Those contain internal paths and are logged to the console only,
 *   which is where support can read them from.
 * - `resetErrorBoundary` clears the error and re-renders `children`, which is
 *   what makes "Try again" actually recover instead of re-throwing forever.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Full technical detail stays in the console for developers/support.
    // The user-facing screen intentionally shows nothing about the internals.
    console.error('Unhandled application error caught by ErrorBoundary', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private readonly resetErrorBoundary = (): void => {
    this.setState({ error: null });
  };

  private readonly reloadPage = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children } = this.props;

    if (!error) {
      return children;
    }

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-white rounded-xl shadow border border-slate-200 p-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Something went wrong</h1>
          <p className="text-slate-600 mb-6">
            An unexpected error stopped this page from loading. Nothing you submitted has been sent.
            You can try again, and if the problem continues please contact support.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              className="bg-emerald-600 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-emerald-700"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.reloadPage}
              className="bg-white text-slate-900 border border-slate-300 font-semibold px-5 py-2.5 rounded-lg hover:bg-slate-50"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
