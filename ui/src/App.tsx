import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import TestRunner from './components/TestRunner';
import TestResults from './components/TestResults';
import ContextManager from './components/ContextManager';
import ResultView from './pages/ResultView';
import ErrorBoundary from './components/ErrorBoundary';

type Tab = 'run' | 'results' | 'context';

function MainApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const isResultView = location.pathname.startsWith('/results/');
  
  const getActiveTab = (): Tab => {
    if (isResultView) return 'results';
    const path = location.pathname;
    if (path === '/results' || path === '/') return 'results';
    if (path === '/context') return 'context';
    if (path === '/run') return 'run';
    return 'results'; // default
  };

  const [activeTab, setActiveTab] = useState<Tab>('results');

  React.useEffect(() => {
    const tab = getActiveTab();
    setActiveTab(tab);
  }, [location.pathname]);

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'run') {
      navigate('/run');
    } else if (tab === 'results') {
      navigate('/results');
    } else if (tab === 'context') {
      navigate('/context');
    }
  };

  return (
    <div>
      <div className="header">
        <div className="container">
          <h1>🤖 QA Tool</h1>
          <p>AI-Powered Website Testing & Analysis</p>
        </div>
      </div>

      {!isResultView && (
        <div className="container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'run' ? 'active' : ''}`}
              onClick={() => handleTabClick('run')}
            >
              Run Test
            </button>
            <button
              className={`tab ${activeTab === 'results' ? 'active' : ''}`}
              onClick={() => handleTabClick('results')}
            >
              Test Results
            </button>
            <button
              className={`tab ${activeTab === 'context' ? 'active' : ''}`}
              onClick={() => handleTabClick('context')}
            >
              Context Files
            </button>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/results/:runId" element={<ResultView />} />
        <Route path="/results" element={
          <div className="container">
            <TestResults />
          </div>
        } />
        <Route path="/context" element={
          <div className="container">
            <ContextManager />
          </div>
        } />
        <Route path="/run" element={
          <div className="container">
            <TestRunner />
          </div>
        } />
        <Route path="/" element={
          <div className="container">
            <TestResults />
          </div>
        } />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <MainApp />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;


