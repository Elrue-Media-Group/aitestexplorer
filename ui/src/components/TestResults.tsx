import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface TestRun {
  runId: string;
  status: 'running' | 'completed';
  createdAt: string;
  testCount: number;
  passCount: number;
  failCount: number;
}

const TestResults: React.FC = () => {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

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
                      onClick={() => navigate(`/results/${run.runId}`)}
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
    </div>
  );
};

export default TestResults;


