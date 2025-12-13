import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';

interface CollapsibleTestResultsProps {
  markdown: string;
}

interface TestCase {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration?: string;
  executedAt?: string;
  description?: string;
  expectedResult?: string;
  error?: string;
  content: string; // Full markdown content for this test case
}

const CollapsibleTestResults: React.FC<CollapsibleTestResultsProps> = ({ markdown }) => {
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());

  // Parse markdown to extract test cases
  const testCases = useMemo(() => {
    const cases: TestCase[] = [];
    const lines = markdown.split('\n');
    let currentCase: Partial<TestCase> | null = null;
    let currentContent: string[] = [];
    let inTestCase = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Detect test case header: ### ✅ TC-XXX: Name or ### ❌ TC-XXX: Name or ## TC-XXX: Name
      // Match pattern: ### [emoji] TC-XXX: Name
      const testCaseMatch = line.match(/^#{2,3}\s+([✅❌⏭️📋])?\s*(TC-\d+):\s*(.+)$/);
      if (testCaseMatch) {
        // Save previous test case if exists
        if (currentCase && inTestCase) {
          cases.push({
            ...currentCase as TestCase,
            content: currentContent.join('\n')
          });
        }
        
        // Determine status from emoji in header
        let status: 'passed' | 'failed' | 'skipped' = 'passed'; // default
        const emoji = testCaseMatch[1];
        if (emoji === '✅') status = 'passed';
        else if (emoji === '❌') status = 'failed';
        else if (emoji === '⏭️') status = 'skipped';
        
        // Start new test case
        currentCase = {
          id: testCaseMatch[2], // TC-XXX
          name: testCaseMatch[3].trim(), // Name
          status: status,
          content: ''
        };
        currentContent = [line];
        inTestCase = true;
        continue;
      }

      // Extract status - can be on same line or next line (overrides emoji if present)
      if (line.match(/^\*\*Status:\*\*/i) && currentCase) {
        const statusMatch = line.match(/(PASSED|FAILED|SKIPPED)/i) || lines[i + 1]?.match(/(PASSED|FAILED|SKIPPED)/i);
        if (statusMatch) {
          const statusText = statusMatch[1] || statusMatch[0];
          currentCase.status = statusText.toLowerCase() as 'passed' | 'failed' | 'skipped';
        }
      }

      // Extract duration
      if (line.match(/^\*\*Duration:\*\*/i) && currentCase) {
        const durationMatch = lines[i + 1]?.match(/([\d.]+ms|[\d.]+s)/);
        if (durationMatch) {
          currentCase.duration = durationMatch[1];
        }
      }

      // Extract error
      if (line.match(/^\*\*Error:\*\*/i) && currentCase) {
        const errorLine = lines[i + 1];
        if (errorLine && !errorLine.match(/^[-*]/)) {
          currentCase.error = errorLine.trim();
        }
      }

      // Extract description
      if (line.match(/^\*\*Description:\*\*/i) && currentCase) {
        const descLine = lines[i + 1];
        if (descLine && !descLine.match(/^[-*]/)) {
          currentCase.description = descLine.trim();
        }
      }

      // Extract expected result
      if (line.match(/^\*\*Expected Result:\*\*/i) && currentCase) {
        const expectedLine = lines[i + 1];
        if (expectedLine && !expectedLine.match(/^[-*]/)) {
          currentCase.expectedResult = expectedLine.trim();
        }
      }

      // Check if we're moving to next section (like summary stats)
      if (line.match(/^#\s+(Total Tests|Summary|Test Execution Results)/i) && inTestCase) {
        // Save current test case
        if (currentCase) {
          cases.push({
            ...currentCase as TestCase,
            content: currentContent.join('\n')
          });
        }
        inTestCase = false;
        currentCase = null;
        currentContent = [];
      }

      // Collect content for current test case (but not the header line - that's already added)
      if (inTestCase && currentCase && !testCaseMatch) {
        currentContent.push(line);
      }
    }

    // Don't forget the last test case
    if (currentCase && inTestCase) {
      cases.push({
        ...currentCase as TestCase,
        content: currentContent.join('\n')
      });
    }

    return cases;
  }, [markdown]);

  const expandAll = () => {
    setExpandedTests(new Set(testCases.map(tc => tc.id)));
  };

  const collapseAll = () => {
    setExpandedTests(new Set());
  };

  const toggleTest = (testId: string) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) {
        next.delete(testId);
      } else {
        next.add(testId);
      }
      return next;
    });
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'passed':
        return '#28a745';
      case 'failed':
        return '#dc3545';
      case 'skipped':
        return '#ffc107';
      default:
        return '#666';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'passed':
        return '✅';
      case 'failed':
        return '❌';
      case 'skipped':
        return '⏭️';
      default:
        return '📋';
    }
  };

  // Debug: log if no test cases found
  if (testCases.length === 0) {
    console.warn('CollapsibleTestResults: No test cases parsed from markdown. Falling back to regular markdown.');
    console.warn('Markdown length:', markdown.length);
    console.warn('Markdown preview:', markdown.substring(0, 500));
    console.warn('First 10 lines:', markdown.split('\n').slice(0, 10));
    
    // Try to find why parsing failed - check for test case headers
    const headerMatches = markdown.match(/^#{2,3}\s+[✅❌⏭️📋]?\s*TC-\d+:/gm);
    console.warn('Found test case headers:', headerMatches);
    
    return (
      <div className="markdown-content">
        <div style={{ padding: '20px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '8px', marginBottom: '20px' }}>
          <strong>⚠️ Debug Info:</strong> Component loaded but couldn't parse test cases. Check console for details.
          <br />
          Found {headerMatches?.length || 0} test case headers in markdown.
        </div>
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    );
  }


  return (
    <div style={{ padding: '0' }}>
      {/* Summary header if it exists - only show summary stats, not full content */}
      {(() => {
        const summaryEndMatch = markdown.match(/^##\s+Detailed Results/m);
        if (!summaryEndMatch) return null;
        
        const summaryText = markdown.substring(0, summaryEndMatch.index);
        if (!summaryText.trim()) return null;
        
        return (
          <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '2px solid #e0e0e0' }}>
            <ReactMarkdown>{summaryText}</ReactMarkdown>
          </div>
        );
      })()}

      {/* Controls */}
      {testCases.length > 0 && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '16px',
          padding: '12px',
          background: '#f8f9fa',
          borderRadius: '6px'
        }}>
          <div style={{ fontSize: '14px', color: '#666' }}>
            {testCases.length} test case{testCases.length !== 1 ? 's' : ''} • 
            {expandedTests.size} expanded
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={expandAll}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                background: '#fff',
                cursor: 'pointer',
                color: '#666'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#f0f0f0'}
              onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                background: '#fff',
                cursor: 'pointer',
                color: '#666'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#f0f0f0'}
              onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
            >
              Collapse All
            </button>
          </div>
        </div>
      )}

      {/* Collapsible test cases */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {testCases.length === 0 ? (
          <div style={{ padding: '20px', background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '8px' }}>
            ⚠️ No test cases to display (but parsing found {testCases.length})
          </div>
        ) : (
          testCases.map((testCase) => {
          const isExpanded = expandedTests.has(testCase.id);
          const statusColor = getStatusColor(testCase.status);
          
          return (
            <div
              key={testCase.id}
              style={{
                border: `1px solid ${statusColor}40`,
                borderRadius: '8px',
                background: '#fff',
                overflow: 'hidden',
                transition: 'all 0.2s'
              }}
            >
              {/* Collapsed header */}
              <div
                onClick={() => toggleTest(testCase.id)}
                style={{
                  padding: '16px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: isExpanded ? '#f8f9fa' : '#fff',
                  borderLeft: `4px solid ${statusColor}`,
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => {
                  if (!isExpanded) {
                    e.currentTarget.style.backgroundColor = '#f8f9fa';
                  }
                }}
                onMouseOut={(e) => {
                  if (!isExpanded) {
                    e.currentTarget.style.backgroundColor = '#fff';
                  }
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '18px' }}>{getStatusIcon(testCase.status)}</span>
                    <strong style={{ fontSize: '16px', color: '#333' }}>
                      {testCase.id}: {testCase.name}
                    </strong>
                    <span
                      style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: `${statusColor}20`,
                        color: statusColor,
                        fontWeight: '600',
                        textTransform: 'uppercase'
                      }}
                    >
                      {testCase.status}
                    </span>
                  </div>
                  {testCase.description && (
                    <div style={{ fontSize: '14px', color: '#666', marginLeft: '32px', marginTop: '4px' }}>
                      {testCase.description}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '16px', marginLeft: '32px', marginTop: '8px', fontSize: '12px', color: '#999' }}>
                    {testCase.duration && <span>⏱️ {testCase.duration}</span>}
                    {testCase.executedAt && <span>🕐 {new Date(testCase.executedAt).toLocaleString()}</span>}
                    {testCase.error && <span style={{ color: '#dc3545' }}>⚠️ Has Error</span>}
                  </div>
                </div>
                <div style={{ fontSize: '20px', color: '#999', marginLeft: '16px' }}>
                  {isExpanded ? '▼' : '▶'}
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div
                  style={{
                    padding: '20px',
                    borderTop: '1px solid #e0e0e0',
                    backgroundColor: '#fafafa'
                  }}
                >
                  <div className="markdown-content">
                    <ReactMarkdown>{testCase.content}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          );
        }))}
      </div>
    </div>
  );
};

export default CollapsibleTestResults;

