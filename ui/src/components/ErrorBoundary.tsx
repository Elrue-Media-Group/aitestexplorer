import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="container" style={{ padding: '40px' }}>
          <div className="card">
            <h2 style={{ color: '#dc3545' }}>Something went wrong</h2>
            <p>{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button 
              className="btn btn-primary" 
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
            <details style={{ marginTop: '20px' }}>
              <summary>Error Details</summary>
              <pre style={{ 
                background: '#f8f9fa', 
                padding: '12px', 
                borderRadius: '4px',
                overflow: 'auto',
                marginTop: '10px'
              }}>
                {this.state.error?.stack}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

