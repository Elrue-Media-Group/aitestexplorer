import React, { useState, useEffect } from 'react';

interface RunDetailsProps {
  runId: string;
  onClose: () => void;
}

interface Progress {
  stage: string;
  message: string;
  timestamp?: string;
  totalTests?: number;
  completedTests?: number;
  passedTests?: number;
  failedTests?: number;
  currentTest?: string;
  error?: string;
}

const RunDetails: React.FC<RunDetailsProps> = ({ runId, onClose }) => {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'running' | 'completed' | 'error'>('running');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/status`);
        if (!response.ok) {
          // If 404, the run folder might not be created yet - keep trying
          if (response.status === 404 && status === 'running') {
            setProgress({
              stage: 'initializing',
              message: 'Waiting for test to start...'
            });
            return;
          }
          throw new Error('Failed to fetch status');
        }
        
        const data = await response.json();
        
        setProgress(data.progress || { stage: 'initializing', message: 'Starting...' });
        setLogs(data.logs || []);
        setStatus(data.status === 'completed' ? 'completed' : data.progress?.stage === 'error' ? 'error' : 'running');
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch status:', error);
        if (status === 'running') {
          // Keep showing initializing state if we can't fetch yet
          setProgress({
            stage: 'initializing',
            message: 'Waiting for test to start...'
          });
        }
        setLoading(false);
      }
    };

    // Fetch immediately
    fetchStatus();
    
    // Poll every 1 second if still running (more frequent for better UX)
    const interval = setInterval(() => {
      if (status === 'running') {
        fetchStatus();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [runId, status]);

  const getStageLabel = (stage: string) => {
    const labels: Record<string, string> = {
      initializing: 'Initializing',
      exploring: 'Exploring Website',
      analyzing: 'Analyzing with AI',
      generating_tests: 'Generating Test Cases',
      executing: 'Executing Tests',
      completed: 'Completed',
      error: 'Error'
    };
    return labels[stage] || stage;
  };

  const getProgressPercent = () => {
    if (!progress) return 0;
    if (progress.stage === 'completed') return 100;
    if (progress.stage === 'error') return 0;
    
    if (progress.totalTests && progress.completedTests !== undefined) {
      return Math.round((progress.completedTests / progress.totalTests) * 100);
    }
    
    // Estimate based on stage
    const stageProgress: Record<string, number> = {
      initializing: 5,
      exploring: 20,
      analyzing: 40,
      generating_tests: 60,
      executing: 80
    };
    return stageProgress[progress.stage] || 0;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '24px',
        maxWidth: '800px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Test Run: {runId}</h2>
          <button className="btn btn-secondary btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? (
          <div className="loading">Loading status...</div>
        ) : (
          <>
            {/* Progress Bar */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 500 }}>
                  {progress ? getStageLabel(progress.stage) : 'Initializing...'}
                </span>
                <span style={{ color: '#666' }}>{getProgressPercent()}%</span>
              </div>
              <div style={{
                width: '100%',
                height: '24px',
                background: '#f0f0f0',
                borderRadius: '12px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${getProgressPercent()}%`,
                  height: '100%',
                  background: status === 'error' ? '#dc3545' : status === 'completed' ? '#28a745' : '#667eea',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>

            {/* Current Status */}
            {progress && (
              <div style={{
                padding: '16px',
                background: status === 'error' ? '#f8d7da' : status === 'completed' ? '#d4edda' : '#e7f3ff',
                borderRadius: '4px',
                marginBottom: '20px'
              }}>
                <div style={{ fontWeight: 500, marginBottom: '8px' }}>Current Status:</div>
                <div>{progress.message}</div>
                {progress.currentTest && (
                  <div style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
                    Current Test: {progress.currentTest}
                  </div>
                )}
                {progress.totalTests && progress.completedTests !== undefined && (
                  <div style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
                    Progress: {progress.completedTests} / {progress.totalTests} tests
                    {progress.passedTests !== undefined && progress.failedTests !== undefined && (
                      <span style={{ marginLeft: '16px' }}>
                        ({progress.passedTests} passed, {progress.failedTests} failed)
                      </span>
                    )}
                  </div>
                )}
                {progress.error && (
                  <div style={{ marginTop: '8px', color: '#721c24', fontWeight: 500 }}>
                    Error: {progress.error}
                  </div>
                )}
              </div>
            )}

            {/* Logs */}
            <div>
              <h3 style={{ marginBottom: '12px' }}>Logs</h3>
              <div style={{
                background: '#1e1e1e',
                color: '#d4d4d4',
                padding: '16px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '12px',
                maxHeight: '400px',
                overflowY: 'auto'
              }}>
                {logs.length === 0 ? (
                  <div style={{ color: '#666' }}>No logs available yet...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>
                      {log}
                    </div>
                  ))
                )}
                {status === 'running' && (
                  <div style={{ color: '#666', fontStyle: 'italic' }}>
                    Waiting for updates...
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            {status === 'completed' && (
              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    onClose();
                    // Trigger a refresh in parent component
                    window.location.reload();
                  }}
                >
                  View Results
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default RunDetails;

