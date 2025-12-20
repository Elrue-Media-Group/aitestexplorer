import React, { useState, useMemo } from 'react';

interface TestCase {
  id: string;
  title: string;
  priority: string;
  category: string;
  description: string;
  page: string;
  steps: string[];
  expectedResult: string;
}

interface CollapsibleTestCasesProps {
  markdown: string;
}

const CollapsibleTestCases: React.FC<CollapsibleTestCasesProps> = ({ markdown }) => {
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set());

  // Parse markdown into test cases
  const testCases = useMemo(() => {
    const cases: TestCase[] = [];
    const lines = markdown.split('\n');

    let currentCase: Partial<TestCase> | null = null;
    let inSteps = false;
    let currentSteps: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match test case header: ## TC-001: Title
      const headerMatch = line.match(/^##\s+(TC-\d+):\s+(.+)$/);
      if (headerMatch) {
        // Save previous case if exists
        if (currentCase && currentCase.id) {
          cases.push({
            ...currentCase,
            steps: currentSteps
          } as TestCase);
        }

        // Start new case
        currentCase = {
          id: headerMatch[1],
          title: headerMatch[2],
          priority: '',
          category: '',
          description: '',
          page: '',
          steps: [],
          expectedResult: ''
        };
        currentSteps = [];
        inSteps = false;
        continue;
      }

      if (!currentCase) continue;

      // Parse metadata
      if (line.match(/^\*\*Priority:\*\*/i)) {
        const match = line.match(/^\*\*Priority:\*\*\s+(.+)$/i);
        if (match) currentCase.priority = match[1];
      } else if (line.match(/^\*\*Category:\*\*/i)) {
        const match = line.match(/^\*\*Category:\*\*\s+(.+)$/i);
        if (match) currentCase.category = match[1];
      } else if (line.match(/^\*\*Description:\*\*/i)) {
        const match = line.match(/^\*\*Description:\*\*\s+(.+)$/i);
        if (match) currentCase.description = match[1];
      } else if (line.match(/^\*\*Page:\*\*/i)) {
        const match = line.match(/^\*\*Page:\*\*\s+(.+)$/i);
        if (match) currentCase.page = match[1];
      } else if (line.match(/^\*\*Expected Result:\*\*/i)) {
        const match = line.match(/^\*\*Expected Result:\*\*\s+(.+)$/i);
        if (match) currentCase.expectedResult = match[1];
        inSteps = false;
      } else if (line.match(/^\*\*Steps:\*\*/i)) {
        inSteps = true;
      } else if (inSteps && line.match(/^\d+\.\s+/)) {
        // Parse step line
        currentSteps.push(line);
      }
    }

    // Add last case
    if (currentCase && currentCase.id) {
      cases.push({
        ...currentCase,
        steps: currentSteps
      } as TestCase);
    }

    return cases;
  }, [markdown]);

  const toggleCase = (caseId: string) => {
    setExpandedCases(prev => {
      const newSet = new Set(prev);
      if (newSet.has(caseId)) {
        newSet.delete(caseId);
      } else {
        newSet.add(caseId);
      }
      return newSet;
    });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority.toUpperCase()) {
      case 'HIGH':
        return '#dc3545';
      case 'MEDIUM':
        return '#fd7e14';
      case 'LOW':
        return '#28a745';
      default:
        return '#6c757d';
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'forms': '#667eea',
      'navigation': '#764ba2',
      'functionality': '#2196F3',
      'api': '#00bcd4',
      'ui': '#9c27b0'
    };
    return colors[category.toLowerCase()] || '#6c757d';
  };

  // Extract total count from markdown
  const totalCount = useMemo(() => {
    const match = markdown.match(/Total test cases:\s*(\d+)/i);
    return match ? parseInt(match[1]) : testCases.length;
  }, [markdown, testCases.length]);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '24px', color: '#333' }}>Generated Test Cases</h2>
        <div style={{ fontSize: '14px', color: '#666' }}>
          Total: <strong>{totalCount}</strong> test case{totalCount !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Test Cases */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {testCases.map((testCase) => {
          const isExpanded = expandedCases.has(testCase.id);

          return (
            <div
              key={testCase.id}
              style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#fff',
                transition: 'box-shadow 0.2s',
                boxShadow: isExpanded ? '0 4px 12px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)'
              }}
            >
              {/* Header */}
              <div
                onClick={() => toggleCase(testCase.id)}
                style={{
                  padding: '16px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: isExpanded ? '#f8f9ff' : '#fff',
                  borderBottom: isExpanded ? '1px solid #e0e0e0' : 'none',
                  transition: 'background 0.2s'
                }}
              >
                {/* Expand/Collapse Icon */}
                <div style={{
                  fontSize: '18px',
                  color: '#667eea',
                  transition: 'transform 0.2s',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                }}>
                  ▶
                </div>

                {/* Test ID */}
                <div style={{
                  fontWeight: '600',
                  fontSize: '14px',
                  color: '#667eea',
                  fontFamily: 'monospace',
                  minWidth: '70px'
                }}>
                  {testCase.id}
                </div>

                {/* Title */}
                <div style={{
                  flex: 1,
                  fontSize: '15px',
                  fontWeight: '500',
                  color: '#333'
                }}>
                  {testCase.title}
                </div>

                {/* Priority Badge */}
                {testCase.priority && (
                  <div style={{
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#fff',
                    background: getPriorityColor(testCase.priority),
                    textTransform: 'uppercase'
                  }}>
                    {testCase.priority}
                  </div>
                )}

                {/* Category Badge */}
                {testCase.category && (
                  <div style={{
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#fff',
                    background: getCategoryColor(testCase.category),
                    textTransform: 'capitalize'
                  }}>
                    {testCase.category}
                  </div>
                )}
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div style={{ padding: '20px', background: '#fafafa' }}>
                  {/* Description */}
                  {testCase.description && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#666',
                        marginBottom: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Description
                      </div>
                      <div style={{
                        padding: '12px',
                        background: '#fff',
                        borderLeft: '3px solid #667eea',
                        borderRadius: '4px',
                        fontSize: '14px',
                        color: '#333',
                        lineHeight: '1.6'
                      }}>
                        {testCase.description}
                      </div>
                    </div>
                  )}

                  {/* Page URL */}
                  {testCase.page && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#666',
                        marginBottom: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Page
                      </div>
                      <div style={{
                        padding: '8px 12px',
                        background: '#fff',
                        border: '1px solid #e0e0e0',
                        borderRadius: '4px',
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        color: '#667eea',
                        wordBreak: 'break-all'
                      }}>
                        {testCase.page}
                      </div>
                    </div>
                  )}

                  {/* Steps */}
                  {testCase.steps.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#666',
                        marginBottom: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Steps ({testCase.steps.length})
                      </div>
                      <div style={{
                        background: '#fff',
                        border: '1px solid #e0e0e0',
                        borderRadius: '4px',
                        overflow: 'hidden'
                      }}>
                        {testCase.steps.map((step, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '10px 12px',
                              borderBottom: idx < testCase.steps.length - 1 ? '1px solid #f0f0f0' : 'none',
                              fontSize: '13px',
                              color: '#333',
                              lineHeight: '1.6',
                              display: 'flex',
                              gap: '8px'
                            }}
                          >
                            <span style={{ color: '#667eea', fontWeight: '600', minWidth: '20px' }}>
                              {idx + 1}.
                            </span>
                            <span style={{ flex: 1 }}>
                              {step.replace(/^\d+\.\s+/, '')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expected Result */}
                  {testCase.expectedResult && (
                    <div>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#666',
                        marginBottom: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Expected Result
                      </div>
                      <div style={{
                        padding: '12px',
                        background: '#e7f3ff',
                        borderLeft: '3px solid #2196F3',
                        borderRadius: '4px',
                        fontSize: '14px',
                        color: '#333',
                        lineHeight: '1.6'
                      }}>
                        {testCase.expectedResult}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CollapsibleTestCases;
