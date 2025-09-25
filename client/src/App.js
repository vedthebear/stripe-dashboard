import React, { useState } from 'react';
import SupabaseAnalytics from './components/SupabaseAnalytics';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === 'money') {
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="App">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <h1>🔐 Dashboard Access</h1>
              <p>Enter password to view analytics</p>
            </div>

            <form onSubmit={handleLogin} className="auth-form">
              <div className="input-group">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="password-input"
                  autoFocus
                />
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button type="submit" className="auth-button">
                Access Dashboard
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="App">
        <header className="App-header">
          <div className="header-left">
            <h1>Stripe Business Intelligence</h1>
          </div>
        </header>

        <main className="main-content">
          <ErrorBoundary>
            <SupabaseAnalytics />
          </ErrorBoundary>
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
