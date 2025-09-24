import React from 'react';
import SupabaseAnalytics from './components/SupabaseAnalytics';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {

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
