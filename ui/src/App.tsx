import React, { useState, useEffect } from 'react';
import TestRunner from './components/TestRunner';
import TestResults from './components/TestResults';
import ContextManager from './components/ContextManager';

type Tab = 'run' | 'results' | 'context';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('run');

  return (
    <div>
      <div className="header">
        <div className="container">
          <h1>🤖 QA Tool</h1>
          <p>AI-Powered Website Testing & Analysis</p>
        </div>
      </div>

      <div className="container">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'run' ? 'active' : ''}`}
            onClick={() => setActiveTab('run')}
          >
            Run Test
          </button>
          <button
            className={`tab ${activeTab === 'results' ? 'active' : ''}`}
            onClick={() => setActiveTab('results')}
          >
            Test Results
          </button>
          <button
            className={`tab ${activeTab === 'context' ? 'active' : ''}`}
            onClick={() => setActiveTab('context')}
          >
            Context Files
          </button>
        </div>

        <div className="tab-content" style={{ display: activeTab === 'run' ? 'block' : 'none' }}>
          <TestRunner />
        </div>

        <div className="tab-content" style={{ display: activeTab === 'results' ? 'block' : 'none' }}>
          <TestResults />
        </div>

        <div className="tab-content" style={{ display: activeTab === 'context' ? 'block' : 'none' }}>
          <ContextManager />
        </div>
      </div>
    </div>
  );
}

export default App;


