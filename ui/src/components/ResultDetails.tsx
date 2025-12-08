import React, { useState, useEffect } from 'react';

interface ResultDetailsProps {
  runId: string;
  onClose: () => void;
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

type Tab = 'test-cases' | 'test-results' | 'site-analysis' | 'ai-reasoning' | 'screenshots';

const ResultDetails: React.FC<ResultDetailsProps> = ({ runId, onClose }) => {
  const [resultData, setResultData] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('test-cases');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadResult();
  }, [runId]);

  const loadResult = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/runs/${runId}`);
      if (!response.ok) {
        throw new Error('Failed to load result');
      }
      const data = await response.json();
      setResultData(data);
    } catch (err) {
      console.error('Failed to load result:', err);
      setError('Failed to load test results. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderMarkdown = (content: string) => {
    // Simple markdown rendering with better formatting
    const lines = content.split('\n');
    return (
      <div className="markdown-content" style={{ 
        lineHeight: '1.6',
        color: '#333'
      }}>
        {lines.map((line, idx) => {
          // Headers
          if (line.startsWith('# ')) {
            return <h1 key={idx} style={{ fontSize: '24px', marginTop: '24px', marginBottom: '12px', fontWeight: 'bold' }}>{line.substring(2)}</h1>;
          }
          if (line.startsWith('## ')) {
            return <h2 key={idx} style={{ fontSize: '20px', marginTop: '20px', marginBottom: '10px', fontWeight: 'bold' }}>{line.substring(3)}</h2>;
          }
          if (line.startsWith('### ')) {
            return <h3 key={idx} style={{ fontSize: '16px', marginTop: '16px', marginBottom: '8px', fontWeight: '600' }}>{line.substring(4)}</h3>;
          }
          // Code blocks
          if (line.startsWith('```')) {
            return null; // Skip code block markers for now
          }
          // List items
          if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
            return <div key={idx} style={{ marginLeft: '20px', marginBottom: '4px' }}>• {line.trim().substring(2)}</div>;
          }
          // Empty lines
          if (line.trim() === '') {
            return <br key={idx} />;
          }
          // Regular text
          return <div key={idx} style={{ marginBottom: '8px' }}>{line}</div>;
        })}
      </div>
    );
  };

  const getTabLabel = (tab: Tab) => {
    const labels: Record<Tab, string> = {
      'test-cases': 'Test Cases',
      'test-results': 'Test Results',
      'site-analysis': 'Site Analysis',
      'ai-reasoning': 'AI Reasoning',
      'screenshots': 'Screenshots'
    };
    return labels[tab];
  };

  const renderTabContent = () => {
    if (!resultData) return null;

    switch (activeTab) {
      case 'test-cases':
        return resultData.results['test-cases.md'] ? (
          <div className="code-block" style={{ 
            maxHeight: 'calc(90vh - 200px)', 
            overflowY: 'auto',
            padding: '20px',
            background: '#f8f9fa',
            borderRadius: '4px'
          }}>
            {renderMarkdown(resultData.results['test-cases.md'])}
          </div>
        ) : (
          <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>Test cases not available</div>
        );

      case 'test-results':
        return resultData.results['test-results.md'] ? (
          <div className="code-block" style={{ 
            maxHeight: 'calc(90vh - 200px)', 
            overflowY: 'auto',
            padding: '20px',
            background: '#f8f9fa',
            borderRadius: '4px'
          }}>
            {renderMarkdown(resultData.results['test-results.md'])}
          </div>
        ) : (
          <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>Test results not available</div>
        );

      case 'site-analysis':
        return resultData.results['site-analysis.md'] ? (
          <div className="code-block" style={{ 
            maxHeight: 'calc(90vh - 200px)', 
            overflowY: 'auto',
            padding: '20px',
            background: '#f8f9fa',
            borderRadius: '4px'
          }}>
            {renderMarkdown(resultData.results['site-analysis.md'])}
          </div>
        ) : (
          <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>Site analysis not available</div>
        );

      case 'ai-reasoning':
        return resultData.results['ai-reasoning.md'] ? (
          <div className="code-block" style={{ 
            maxHeight: 'calc(90vh - 200px)', 
            overflowY: 'auto',
            padding: '20px',
            background: '#f8f9fa',
            borderRadius: '4px'
          }}>
            {renderMarkdown(resultData.results['ai-reasoning.md'])}
          </div>
        ) : (
          <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>AI reasoning not available</div>
        );

      case 'screenshots':
        return resultData.screenshots.length > 0 ? (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
            gap: '16px',
            padding: '20px'
          }}>
            {resultData.screenshots.map((screenshot, idx) => (
              <div key={idx} style={{ 
                border: '1px solid #ddd', 
                borderRadius: '8px',
                overflow: 'hidden',
                background: 'white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}>
                <a href={screenshot} target="_blank" rel="noopener noreferrer">
                  <img
                    src={screenshot}
                    alt={`Screenshot ${idx + 1}`}
                    style={{ 
                      width: '100%', 
                      height: 'auto', 
                      display: 'block',
                      cursor: 'pointer'
                    }}
                  />
                </a>
                <div style={{ 
                  padding: '8px', 
                  fontSize: '12px', 
                  color: '#666',
                  textAlign: 'center'
                }}>
                  Screenshot {idx + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>No screenshots available</div>
        );

      default:
        return null;
    }
  };

  const availableTabs: Tab[] = [];
  if (resultData?.results['test-cases.md']) availableTabs.push('test-cases');
  if (resultData?.results['test-results.md']) availableTabs.push('test-results');
  if (resultData?.results['site-analysis.md']) availableTabs.push('site-analysis');
  if (resultData?.results['ai-reasoning.md']) availableTabs.push('ai-reasoning');
  if (resultData && resultData.screenshots.length > 0) availableTabs.push('screenshots');

  // Set first available tab as active if current tab is not available
  useEffect(() => {
    if (resultData) {
      const tabs: Tab[] = [];
      if (resultData.results['test-cases.md']) tabs.push('test-cases');
      if (resultData.results['test-results.md']) tabs.push('test-results');
      if (resultData.results['site-analysis.md']) tabs.push('site-analysis');
      if (resultData.results['ai-reasoning.md']) tabs.push('ai-reasoning');
      if (resultData.screenshots.length > 0) tabs.push('screenshots');
      
      if (tabs.length > 0 && !tabs.includes(activeTab)) {
        setActiveTab(tabs[0]);
      }
    }
  }, [resultData, activeTab]);

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
        padding: '0',
        maxWidth: '1200px',
        width: '100%',
        maxHeight: '95vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '20px 24px',
          borderBottom: '1px solid #e0e0e0'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>Test Run Details</h2>
            <code style={{ fontSize: '12px', color: '#666' }}>{runId}</code>
          </div>
          <button 
            className="btn btn-secondary btn-small" 
            onClick={onClose}
            style={{ marginLeft: '16px' }}
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        {!loading && !error && availableTabs.length > 0 && (
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #e0e0e0',
            padding: '0 24px',
            overflowX: 'auto'
          }}>
            {availableTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '12px 20px',
                  border: 'none',
                  background: 'transparent',
                  borderBottom: activeTab === tab ? '2px solid #667eea' : '2px solid transparent',
                  color: activeTab === tab ? '#667eea' : '#666',
                  fontWeight: activeTab === tab ? '600' : '400',
                  cursor: 'pointer',
                  fontSize: '14px',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  if (activeTab !== tab) {
                    e.currentTarget.style.background = '#f5f5f5';
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== tab) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {getTabLabel(tab)}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '0'
        }}>
          {loading ? (
            <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>
              Loading test results...
            </div>
          ) : error ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#dc3545' }}>
              {error}
            </div>
          ) : (
            renderTabContent()
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultDetails;

