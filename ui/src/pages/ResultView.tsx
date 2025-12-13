import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import CollapsibleTestResults from '../components/CollapsibleTestResults';

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

const ResultView: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [resultData, setResultData] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('test-cases');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runId) {
      loadResult();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const loadResult = async () => {
    if (!runId) return;
    
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/runs/${runId}`);
      if (!response.ok) {
        throw new Error('Failed to load result');
      }
      const data = await response.json();
      setResultData(data);
      
      // Set first available tab
      const tabs: Tab[] = [];
      if (data.results['test-cases.md']) tabs.push('test-cases');
      if (data.results['test-results.md']) tabs.push('test-results');
      if (data.results['site-analysis.md']) tabs.push('site-analysis');
      if (data.results['ai-reasoning.md']) tabs.push('ai-reasoning');
      if (data.screenshots && data.screenshots.length > 0) tabs.push('screenshots');
      
      if (tabs.length > 0) {
        setActiveTab(tabs[0]);
      }
    } catch (err) {
      console.error('Failed to load result:', err);
      setError('Failed to load test results. Please try again.');
    } finally {
      setLoading(false);
    }
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
          <div style={{ 
            padding: '24px',
            background: '#fff',
            borderRadius: '8px',
            maxWidth: '100%'
          }} className="markdown-content">
            <ReactMarkdown>{resultData.results['test-cases.md']}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            Test cases not available
          </div>
        );

      case 'test-results':
        return resultData.results['test-results.md'] ? (
          <div style={{ 
            padding: '24px',
            background: '#fff',
            borderRadius: '8px',
            maxWidth: '100%'
          }}>
            <CollapsibleTestResults markdown={resultData.results['test-results.md']} />
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            Test results not available
          </div>
        );

      case 'site-analysis':
        return resultData.results['site-analysis.md'] ? (
          <div style={{ 
            padding: '24px',
            background: '#fff',
            borderRadius: '8px',
            maxWidth: '100%'
          }} className="markdown-content">
            <ReactMarkdown>{resultData.results['site-analysis.md']}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            Site analysis not available
          </div>
        );

      case 'ai-reasoning':
        return resultData.results['ai-reasoning.md'] ? (
          <div style={{ 
            padding: '24px',
            background: '#fff',
            borderRadius: '8px',
            maxWidth: '100%'
          }} className="markdown-content">
            <ReactMarkdown>{resultData.results['ai-reasoning.md']}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            AI reasoning not available
          </div>
        );

      case 'screenshots':
        return resultData.screenshots && resultData.screenshots.length > 0 ? (
          <div style={{ 
            padding: '24px',
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', 
            gap: '20px'
          }}>
            {resultData.screenshots.map((screenshot, idx) => (
              <div key={idx} style={{ 
                border: '1px solid #ddd', 
                borderRadius: '8px',
                overflow: 'hidden',
                background: 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
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
                  padding: '12px', 
                  fontSize: '14px', 
                  color: '#666',
                  textAlign: 'center',
                  borderTop: '1px solid #eee'
                }}>
                  Screenshot {idx + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            No screenshots available
          </div>
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
  if (resultData && resultData.screenshots && resultData.screenshots.length > 0) availableTabs.push('screenshots');

  return (
    <div>
      {/* Header */}
      <div className="header">
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button 
              className="btn btn-secondary btn-small"
              onClick={() => navigate('/')}
              style={{ marginRight: 'auto' }}
            >
              ← Back to Results
            </button>
            <h1 style={{ margin: 0, fontSize: '24px' }}>Test Run Details</h1>
            <code style={{ fontSize: '14px', color: '#666', background: '#f5f5f5', padding: '4px 8px', borderRadius: '4px' }}>
              {runId}
            </code>
          </div>
        </div>
      </div>

      <div className="container" style={{ marginTop: '20px' }}>
        {loading ? (
          <div className="card">
            <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>
              Loading test results...
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <div style={{ padding: '40px', textAlign: 'center', color: '#dc3545' }}>
              {error}
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            {availableTabs.length > 0 && (
              <div className="card" style={{ marginBottom: '20px', padding: '0' }}>
                <div style={{
                  display: 'flex',
                  borderBottom: '1px solid #e0e0e0',
                  overflowX: 'auto'
                }}>
                  {availableTabs.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      style={{
                        padding: '16px 24px',
                        border: 'none',
                        background: 'transparent',
                        borderBottom: activeTab === tab ? '3px solid #667eea' : '3px solid transparent',
                        color: activeTab === tab ? '#667eea' : '#666',
                        fontWeight: activeTab === tab ? '600' : '400',
                        cursor: 'pointer',
                        fontSize: '15px',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s',
                        backgroundColor: activeTab === tab ? '#f8f9ff' : 'transparent'
                      }}
                      onMouseOver={(e) => {
                        if (activeTab !== tab) {
                          e.currentTarget.style.backgroundColor = '#f5f5f5';
                        }
                      }}
                      onMouseOut={(e) => {
                        if (activeTab !== tab) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      {getTabLabel(tab)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Content */}
            <div className="card" style={{ minHeight: '500px' }}>
              {renderTabContent()}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResultView;

