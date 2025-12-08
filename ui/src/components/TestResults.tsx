import React, { useState, useEffect } from 'react';

interface TestRun {
  runId: string;
  status: 'running' | 'completed';
  createdAt: string;
  testCount: number;
  passCount: number;
  failCount: number;
}

interface TestResult {
  runId: string;
  results: {
    'test-cases.md'?: string;
    'test-results.md'?: string;
    'site-analysis.md'?: string;
    'ai-reasoning.md'?: string;
  };
  screenshots: string[];
}

const TestResults: React.FC = () => {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [resultData, setResultData] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedRun) {
      loadResult(selectedRun);
    }
  }, [selectedRun]);

  const loadRuns = async () => {
    try {
      const response = await fetch('/api/runs');
      const data = await response.json();
      setRuns(data);
    } catch (error) {
      console.error('Failed to load runs:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadResult = async (runId: string) => {
    try {
      const response = await fetch(`/api/runs/${runId}`);
      const data = await response.json();
      setResultData(data);
    } catch (error) {
      console.error('Failed to load result:', error);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadRuns();
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const renderMarkdown = (content: string) => {
    // Simple markdown rendering (you could use a library like react-markdown)
    return (
      <div className="markdown-content">
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{content}</pre>
      </div>
    );
  };

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Test Results</h2>
          <button className="btn btn-secondary btn-small" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {loading ? (
          <div className="loading">Loading test runs...</div>
        ) : runs.length === 0 ? (
          <div className="loading">No test runs found. Run a test to see results here.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Status</th>
                <th>Created</th>
                <th>Tests</th>
                <th>Passed</th>
                <th>Failed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td>
                    <code style={{ fontSize: '12px' }}>{run.runId}</code>
                  </td>
                  <td>
                    <span className={`status-badge status-${run.status}`}>
                      {run.status}
                    </span>
                  </td>
                  <td>{formatDate(run.createdAt)}</td>
                  <td>{run.testCount}</td>
                  <td style={{ color: '#28a745' }}>{run.passCount}</td>
                  <td style={{ color: '#dc3545' }}>{run.failCount}</td>
                  <td>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => setSelectedRun(run.runId)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedRun && resultData && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>Run Details: {selectedRun}</h2>
            <button className="btn btn-secondary btn-small" onClick={() => setSelectedRun(null)}>
              Close
            </button>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '10px' }}>Test Cases</h3>
            {resultData.results['test-cases.md'] ? (
              <div className="code-block" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {renderMarkdown(resultData.results['test-cases.md'])}
              </div>
            ) : (
              <div className="loading">Test cases not available</div>
            )}
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '10px' }}>Test Results</h3>
            {resultData.results['test-results.md'] ? (
              <div className="code-block" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {renderMarkdown(resultData.results['test-results.md'])}
              </div>
            ) : (
              <div className="loading">Test results not available</div>
            )}
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '10px' }}>Site Analysis</h3>
            {resultData.results['site-analysis.md'] ? (
              <div className="code-block" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {renderMarkdown(resultData.results['site-analysis.md'])}
              </div>
            ) : (
              <div className="loading">Site analysis not available</div>
            )}
          </div>

          {resultData.screenshots.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '10px' }}>Screenshots</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {resultData.screenshots.map((screenshot, idx) => (
                  <a key={idx} href={screenshot} target="_blank" rel="noopener noreferrer">
                    <img
                      src={screenshot}
                      alt={`Screenshot ${idx + 1}`}
                      style={{ width: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #ddd' }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TestResults;


