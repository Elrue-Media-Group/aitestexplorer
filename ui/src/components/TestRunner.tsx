import React, { useState } from 'react';
import RunDetails from './RunDetails';

interface TestRunnerProps {}

const TestRunner: React.FC<TestRunnerProps> = () => {
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(10);
  const [maxActions, setMaxActions] = useState(50);
  const [maxTestsToExecute, setMaxTestsToExecute] = useState(0);
  const [headless, setHeadless] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [showRunDetails, setShowRunDetails] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setRunId(null);

    try {
      const response = await fetch('/api/run-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          maxPages,
          maxActions,
          maxTestsToExecute,
          headless,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `Test started! Run ID: ${data.runId}` });
        setRunId(data.runId);
        setShowRunDetails(true);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start test' });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to start test',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Run Test Analysis</h2>

      {message && (
        <div className={message.type === 'success' ? 'success' : 'error'}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="url">Website URL *</label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            required
            disabled={loading}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="maxPages">Max Pages</label>
            <input
              id="maxPages"
              type="number"
              min="1"
              max="50"
              value={maxPages}
              onChange={(e) => setMaxPages(parseInt(e.target.value) || 10)}
              disabled={loading}
            />
            <small style={{ color: '#666', display: 'block', marginTop: '4px' }}>
              Maximum number of pages to visit during exploration
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="maxActions">Max Actions</label>
            <input
              id="maxActions"
              type="number"
              min="1"
              max="200"
              value={maxActions}
              onChange={(e) => setMaxActions(parseInt(e.target.value) || 50)}
              disabled={loading}
            />
            <small style={{ color: '#666', display: 'block', marginTop: '4px' }}>
              Maximum number of interactive actions to perform
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="maxTestsToExecute">Max Tests to Execute</label>
            <input
              id="maxTestsToExecute"
              type="number"
              min="0"
              max="500"
              value={maxTestsToExecute}
              onChange={(e) => setMaxTestsToExecute(parseInt(e.target.value) || 0)}
              disabled={loading}
            />
            <small style={{ color: '#666', display: 'block', marginTop: '4px' }}>
              0 = run all tests, N = run first N tests (sorted by priority)
            </small>
          </div>
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
              disabled={loading}
              style={{ marginRight: '8px' }}
            />
            Run browser in headless mode (recommended)
          </label>
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading || !url}>
          {loading ? 'Starting Test...' : 'Start Test Analysis'}
        </button>
      </form>

      {runId && !showRunDetails && (
        <div style={{ marginTop: '20px', padding: '12px', background: '#e7f3ff', borderRadius: '4px' }}>
          <strong>Test Running:</strong> {runId}
          <br />
          <button
            className="btn btn-primary btn-small"
            onClick={() => setShowRunDetails(true)}
            style={{ marginTop: '8px' }}
          >
            View Progress
          </button>
        </div>
      )}

      {showRunDetails && runId && (
        <RunDetails runId={runId} onClose={() => setShowRunDetails(false)} />
      )}
    </div>
  );
};

export default TestRunner;

