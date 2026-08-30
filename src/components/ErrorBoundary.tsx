import { PureComponent, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

export class ErrorBoundary extends PureComponent<Props, State> {
  override state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string }): void {
    this.setState({ stack: info.componentStack || '' });
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0a0a0f',
          color: '#e2e8f0',
          fontFamily: 'monospace',
          padding: '24px',
          textAlign: 'center',
          gap: '16px',
        }}>
          <div style={{ fontSize: '48px', opacity: 0.6 }}>⚠</div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <pre style={{
            fontSize: '11px',
            color: '#94a3b8',
            maxWidth: '600px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.5,
            margin: 0,
          }}>
            {this.state.error.message}
          </pre>
          {this.state.stack && (
            <details style={{ fontSize: '10px', color: '#64748b', maxWidth: '600px' }}>
              <summary style={{ cursor: 'pointer' }}>Stack trace</summary>
              <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left', lineHeight: 1.4 }}>
                {this.state.stack}
              </pre>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '8px',
              padding: '10px 28px',
              borderRadius: '10px',
              border: '1px solid rgba(6, 182, 212, 0.4)',
              background: 'rgba(6, 182, 212, 0.1)',
              color: '#22d3ee',
              fontSize: '13px',
              fontFamily: 'monospace',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(6, 182, 212, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)')}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
