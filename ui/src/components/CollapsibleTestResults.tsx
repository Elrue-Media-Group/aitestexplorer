import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';

interface CollapsibleTestResultsProps {
  markdown: string;
  runId?: string;
}

interface TestStep {
  stepNumber: number;
  name: string;
  status: 'passed' | 'failed' | 'unknown';
  expected?: string;
  actual?: string;
  screenshot?: string;
  metadata: Record<string, string>;
  rawContent: string;
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
  steps: TestStep[];
  content: string; // Full markdown content for this test case
}

const CollapsibleTestResults: React.FC<CollapsibleTestResultsProps> = ({ markdown, runId }) => {
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [showStepsFor, setShowStepsFor] = useState<Set<string>>(new Set());

  // Parse steps from test case content
  const parseSteps = (content: string): TestStep[] => {
    const steps: TestStep[] = [];
    const lines = content.split('\n');
    let i = 0;

    // Look for **Steps:** section
    while (i < lines.length && !lines[i].match(/^\*\*Steps:\*\*/i)) {
      i++;
    }

    if (i >= lines.length) return steps; // No steps section found

    i++; // Move past **Steps:** line

    let currentStep: Partial<TestStep> | null = null;
    let stepContent: string[] = [];

    while (i < lines.length) {
      const line = lines[i];

      // Check if we've reached the end of this test case (next test case or separator)
      if (line.match(/^#{2,3}\s+[✅❌⏭️]/i) || line.match(/^---$/)) {
        break;
      }

      // Match step header: ✅ Step 1: Description or ❌ Step 1: Description
      const stepMatch = line.match(/^([✅❌⏭️])\s*Step\s+(\d+):\s*(.+)$/i);
      if (stepMatch) {
        // Save previous step if exists
        if (currentStep) {
          steps.push({
            ...currentStep as TestStep,
            rawContent: stepContent.join('\n')
          });
        }

        // Start new step
        const status = stepMatch[1] === '✅' ? 'passed' : stepMatch[1] === '❌' ? 'failed' : 'unknown';
        currentStep = {
          stepNumber: parseInt(stepMatch[2]),
          name: stepMatch[3].trim(),
          status: status as 'passed' | 'failed' | 'unknown',
          metadata: {}
        };
        stepContent = [line];
      } else if (currentStep) {
        stepContent.push(line);

        // Extract metadata from bullet points
        const bulletMatch = line.match(/^\s*-\s*(.+?):\s*(.+)$/);
        if (bulletMatch) {
          const key = bulletMatch[1].trim();
          const value = bulletMatch[2].trim();

          if (key.toLowerCase() === 'expected') {
            currentStep.expected = value;
          } else if (key.toLowerCase() === 'actual') {
            currentStep.actual = value;
          } else if (key.toLowerCase() === 'evidence') {
            // Extract screenshot path from markdown link: [Screenshot](path)
            const screenshotMatch = value.match(/\[Screenshot\]\((.+?)\)/);
            if (screenshotMatch) {
              currentStep.screenshot = screenshotMatch[1];
            }
          } else {
            currentStep.metadata![key] = value;
          }
        }
      }

      i++;
    }

    // Don't forget the last step
    if (currentStep) {
      steps.push({
        ...currentStep as TestStep,
        rawContent: stepContent.join('\n')
      });
    }

    return steps;
  };

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
      const testCaseMatch = line.match(/^#{2,3}\s+([✅❌⏭️📋])?\s*(TC-\d+):\s*(.+)$/);
      if (testCaseMatch) {
        // Save previous test case if exists
        if (currentCase && inTestCase) {
          const content = currentContent.join('\n');
          cases.push({
            ...currentCase as TestCase,
            content: content,
            steps: parseSteps(content)
          });
        }

        // Determine status from emoji in header
        let status: 'passed' | 'failed' | 'skipped' = 'passed';
        const emoji = testCaseMatch[1];
        if (emoji === '✅') status = 'passed';
        else if (emoji === '❌') status = 'failed';
        else if (emoji === '⏭️') status = 'skipped';

        // Start new test case
        currentCase = {
          id: testCaseMatch[2],
          name: testCaseMatch[3].trim(),
          status: status,
          steps: [],
          content: ''
        };
        currentContent = [line];
        inTestCase = true;
        continue;
      }

      // Extract metadata
      if (line.match(/^\*\*Status:\*\*/i) && currentCase) {
        const statusMatch = line.match(/(PASSED|FAILED|SKIPPED)/i) || lines[i + 1]?.match(/(PASSED|FAILED|SKIPPED)/i);
        if (statusMatch) {
          currentCase.status = statusMatch[1].toLowerCase() as 'passed' | 'failed' | 'skipped';
        }
      }

      if (line.match(/^\*\*Duration:\*\*/i) && currentCase) {
        const durationMatch = lines[i + 1]?.match(/([\d.]+ms|[\d.]+s)/);
        if (durationMatch) {
          currentCase.duration = durationMatch[1];
        }
      }

      if (line.match(/^\*\*Error:\*\*/i) && currentCase) {
        const errorLine = lines[i + 1];
        if (errorLine && !errorLine.match(/^[-*]/)) {
          currentCase.error = errorLine.trim();
        }
      }

      if (line.match(/^\*\*Description:\*\*/i) && currentCase) {
        // Try to get description from same line first
        const sameLineMatch = line.match(/^\*\*Description:\*\*\s*(.+)$/i);
        if (sameLineMatch && sameLineMatch[1].trim()) {
          currentCase.description = sameLineMatch[1].trim();
        } else {
          // Fallback to next line
          const descLine = lines[i + 1];
          if (descLine && !descLine.match(/^[-*]/)) {
            currentCase.description = descLine.trim();
          }
        }
      }

      if (line.match(/^\*\*Expected Result:\*\*/i) && currentCase) {
        // Try to get expected result from same line first
        const sameLineMatch = line.match(/^\*\*Expected Result:\*\*\s*(.+)$/i);
        if (sameLineMatch && sameLineMatch[1].trim()) {
          currentCase.expectedResult = sameLineMatch[1].trim();
        } else {
          // Fallback to next line
          const expectedLine = lines[i + 1];
          if (expectedLine && !expectedLine.match(/^[-*]/)) {
            currentCase.expectedResult = expectedLine.trim();
          }
        }
      }

      // Check if we're moving to next section
      if (line.match(/^#\s+(Total Tests|Summary|Test Execution Results)/i) && inTestCase) {
        if (currentCase) {
          const content = currentContent.join('\n');
          cases.push({
            ...currentCase as TestCase,
            content: content,
            steps: parseSteps(content)
          });
        }
        inTestCase = false;
        currentCase = null;
        currentContent = [];
      }

      if (inTestCase && currentCase && !testCaseMatch) {
        currentContent.push(line);
      }
    }

    // Don't forget the last test case
    if (currentCase && inTestCase) {
      const content = currentContent.join('\n');
      cases.push({
        ...currentCase as TestCase,
        content: content,
        steps: parseSteps(content)
      });
    }

    return cases;
  }, [markdown]);

  const expandAll = () => {
    setExpandedTests(new Set(testCases.map(tc => tc.id)));
  };

  const collapseAll = () => {
    setExpandedTests(new Set());
    setShowStepsFor(new Set());
    setExpandedSteps(new Set());
  };

  const toggleTest = (testId: string) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) {
        next.delete(testId);
        // Also hide steps when collapsing test
        setShowStepsFor(prevSteps => {
          const nextSteps = new Set(prevSteps);
          nextSteps.delete(testId);
          return nextSteps;
        });
      } else {
        next.add(testId);
      }
      return next;
    });
  };

  const toggleStepsView = (testId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowStepsFor(prev => {
      const next = new Set(prev);
      if (next.has(testId)) {
        next.delete(testId);
        // Also collapse all steps when hiding
        setExpandedSteps(prevExpanded => {
          const nextExpanded = new Set(prevExpanded);
          const test = testCases.find(tc => tc.id === testId);
          test?.steps.forEach(step => {
            nextExpanded.delete(`${testId}-step-${step.stepNumber}`);
          });
          return nextExpanded;
        });
      } else {
        next.add(testId);
      }
      return next;
    });
  };

  const toggleStep = (testId: string, stepNumber: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const stepKey = `${testId}-step-${stepNumber}`;
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepKey)) {
        next.delete(stepKey);
      } else {
        next.add(stepKey);
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

  // Fallback if no test cases parsed
  if (testCases.length === 0) {
    console.warn('CollapsibleTestResults: No test cases parsed from markdown.');
    return (
      <div className="markdown-content">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div style={{ padding: '0' }}>
      {/* Summary header */}
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
        {testCases.map((testCase) => {
          const isExpanded = expandedTests.has(testCase.id);
          const showSteps = showStepsFor.has(testCase.id);
          const statusColor = getStatusColor(testCase.status);
          const passedSteps = testCase.steps.filter(s => s.status === 'passed').length;
          const totalSteps = testCase.steps.length;

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
              {/* Test case header */}
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
                    {totalSteps > 0 && <span>📋 {passedSteps}/{totalSteps} steps passed</span>}
                    {testCase.error && <span style={{ color: '#dc3545' }}>⚠️ {testCase.error}</span>}
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
                  {/* Description */}
                  {testCase.description && (
                    <div style={{ marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderLeft: '3px solid #666', borderRadius: '4px' }}>
                      <strong style={{ color: '#333', fontSize: '13px' }}>Description:</strong>
                      <div style={{ marginTop: '4px', fontSize: '14px', color: '#555' }}>{testCase.description}</div>
                    </div>
                  )}

                  {/* Expected Result */}
                  {testCase.expectedResult && (
                    <div style={{ marginBottom: '16px', padding: '12px', background: '#e7f3ff', borderLeft: '3px solid #2196F3', borderRadius: '4px' }}>
                      <strong style={{ color: '#1976D2', fontSize: '13px' }}>Expected Result:</strong>
                      <div style={{ marginTop: '4px', fontSize: '14px', color: '#333' }}>{testCase.expectedResult}</div>
                    </div>
                  )}

                  {/* Steps section */}
                  {totalSteps > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <button
                        onClick={(e) => toggleStepsView(testCase.id, e)}
                        style={{
                          padding: '8px 16px',
                          fontSize: '14px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          background: showSteps ? '#e3f2fd' : '#fff',
                          cursor: 'pointer',
                          color: '#333',
                          fontWeight: '500',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = showSteps ? '#bbdefb' : '#f5f5f5'}
                        onMouseOut={(e) => e.currentTarget.style.background = showSteps ? '#e3f2fd' : '#fff'}
                      >
                        <span>{showSteps ? '▼' : '▶'}</span>
                        <span>{showSteps ? 'Hide' : 'Show'} Steps ({passedSteps}/{totalSteps} passed)</span>
                      </button>

                      {/* Steps table */}
                      {showSteps && (
                        <div style={{ marginTop: '12px', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                              <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                                <th style={{ padding: '10px', textAlign: 'left', width: '60px' }}>Step</th>
                                <th style={{ padding: '10px', textAlign: 'left' }}>Description</th>
                                <th style={{ padding: '10px', textAlign: 'center', width: '80px' }}>Status</th>
                                <th style={{ padding: '10px', textAlign: 'center', width: '100px' }}>Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {testCase.steps.map((step) => {
                                const stepKey = `${testCase.id}-step-${step.stepNumber}`;
                                const isStepExpanded = expandedSteps.has(stepKey);

                                return (
                                  <React.Fragment key={stepKey}>
                                    <tr style={{ borderBottom: '1px solid #eee', background: step.screenshot ? '#fff5f5' : '#fff' }}>
                                      <td style={{ padding: '10px', fontWeight: '500', color: '#666' }}>
                                        {step.stepNumber}
                                      </td>
                                      <td style={{ padding: '10px' }}>
                                        {step.name}
                                        {step.screenshot && (
                                          <span style={{ marginLeft: '8px', fontSize: '14px', color: '#dc3545' }} title="Failure screenshot available">
                                            📸
                                          </span>
                                        )}
                                      </td>
                                      <td style={{ padding: '10px', textAlign: 'center' }}>
                                        <span style={{ fontSize: '16px' }}>{getStatusIcon(step.status)}</span>
                                      </td>
                                      <td style={{ padding: '10px', textAlign: 'center' }}>
                                        <button
                                          onClick={(e) => toggleStep(testCase.id, step.stepNumber, e)}
                                          style={{
                                            padding: '4px 8px',
                                            fontSize: '12px',
                                            border: '1px solid #ddd',
                                            borderRadius: '3px',
                                            background: '#fff',
                                            cursor: 'pointer',
                                            color: '#666'
                                          }}
                                          onMouseOver={(e) => e.currentTarget.style.background = '#f0f0f0'}
                                          onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                                        >
                                          {isStepExpanded ? 'Hide' : 'View'}
                                        </button>
                                      </td>
                                    </tr>
                                    {isStepExpanded && (
                                      <tr>
                                        <td colSpan={4} style={{ padding: '0', background: '#f9f9f9' }}>
                                          <div style={{ padding: '16px', borderTop: '2px solid #e0e0e0' }}>
                                            {step.expected && (
                                              <div style={{ marginBottom: '8px' }}>
                                                <strong style={{ color: '#666', fontSize: '12px' }}>Expected:</strong>
                                                <div style={{ marginTop: '2px', fontSize: '13px', color: '#333' }}>{step.expected}</div>
                                              </div>
                                            )}
                                            {step.actual && (
                                              <div style={{ marginBottom: '8px' }}>
                                                <strong style={{ color: '#666', fontSize: '12px' }}>Actual:</strong>
                                                <div style={{ marginTop: '2px', fontSize: '13px', color: '#333' }}>{step.actual}</div>
                                              </div>
                                            )}
                                            {step.screenshot && runId && (() => {
                                              // Extract filename from path like "evidence/TC-013-step-7-failure-1765997995653.png"
                                              const parts = step.screenshot.split('/');
                                              const filename = parts[parts.length - 1];
                                              const folder = parts.length > 1 ? parts[0] : 'evidence';
                                              const imageUrl = `/api/runs/${runId}/${folder}/${filename}`;

                                              return (
                                                <div style={{ marginBottom: '8px', marginTop: '12px' }}>
                                                  <strong style={{ color: '#dc3545', fontSize: '12px' }}>📸 Failure Screenshot:</strong>
                                                  <div style={{ marginTop: '8px', border: '2px solid #dc3545', borderRadius: '4px', overflow: 'hidden', maxWidth: '800px' }}>
                                                    <img
                                                      src={imageUrl}
                                                      alt="Failure screenshot"
                                                      style={{ width: '100%', display: 'block', cursor: 'pointer' }}
                                                      onClick={(e) => {
                                                        // Open in new tab on click
                                                        window.open((e.target as HTMLImageElement).src, '_blank');
                                                      }}
                                                      title="Click to open in new tab"
                                                    />
                                                  </div>
                                                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#999', fontStyle: 'italic' }}>
                                                    Click image to open in new tab
                                                  </div>
                                                </div>
                                              );
                                            })()}
                                            {Object.keys(step.metadata).length > 0 && (
                                              <div>
                                                <strong style={{ color: '#666', fontSize: '12px' }}>Additional Details:</strong>
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                  {Object.entries(step.metadata).map(([key, value]) => (
                                                    <div key={key} style={{ marginTop: '2px' }}>
                                                      <span style={{ fontWeight: '500' }}>{key}:</span> {value}
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show full content only if there are no steps or for debugging */}
                  {totalSteps === 0 && (
                    <div className="markdown-content">
                      <ReactMarkdown>{testCase.content}</ReactMarkdown>
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

export default CollapsibleTestResults;
