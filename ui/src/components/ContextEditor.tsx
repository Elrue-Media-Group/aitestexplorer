import React, { useState } from 'react';

interface ImportantTest {
  name: string;
  description: string;
  page?: string;
  priority?: 'high' | 'medium' | 'low';
}

interface ContextData {
  siteName: string;
  domain: string;
  siteDescription: string;
  importantTests: ImportantTest[];
  testingNotes?: string;
  [key: string]: any; // Allow other fields for backward compatibility
}

interface ContextEditorProps {
  domain: string;
  initialData: ContextData;
  onSave: (data: ContextData) => Promise<void>;
  onCancel: () => void;
}

const ContextEditor: React.FC<ContextEditorProps> = ({ domain, initialData, onSave, onCancel }) => {
  const [siteName, setSiteName] = useState(initialData.siteName || '');
  const [siteDescription, setSiteDescription] = useState(initialData.siteDescription || initialData.description || '');
  const [importantTests, setImportantTests] = useState<ImportantTest[]>(
    initialData.importantTests || initialData.customTestCases || []
  );
  const [testingNotes, setTestingNotes] = useState(initialData.testingNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddTest = () => {
    setImportantTests([...importantTests, { name: '', description: '', priority: 'medium' }]);
  };

  const handleRemoveTest = (index: number) => {
    setImportantTests(importantTests.filter((_, i) => i !== index));
  };

  const handleTestChange = (index: number, field: keyof ImportantTest, value: string) => {
    const updated = [...importantTests];
    updated[index] = { ...updated[index], [field]: value };
    setImportantTests(updated);
  };

  const handleSave = async () => {
    if (!siteName.trim()) {
      setError('Site name is required');
      return;
    }

    if (!siteDescription.trim()) {
      setError('Site description is required');
      return;
    }

    setError(null);
    setSaving(true);

    try {
      // Build simplified context file
      const contextData: ContextData = {
        siteName: siteName.trim(),
        domain: domain,
        siteDescription: siteDescription.trim(),
        importantTests: importantTests.filter(t => t.name.trim() && t.description.trim()),
        testingNotes: testingNotes.trim() || undefined,
        // Keep backward compatibility - also set customTestCases for old code
        customTestCases: importantTests.filter(t => t.name.trim() && t.description.trim()).map(t => ({
          name: t.name,
          description: t.description,
          page: t.page,
          priority: t.priority || 'medium'
        })),
        // Keep other fields from original for backward compatibility
        ...Object.fromEntries(
          Object.entries(initialData).filter(([key]) => 
            !['siteName', 'domain', 'siteDescription', 'description', 'importantTests', 'customTestCases', 'testingNotes'].includes(key)
          )
        )
      };

      await onSave(contextData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>Edit Context: {domain}</h2>
        <button className="btn btn-secondary btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error && (
        <div className="error" style={{ marginBottom: '20px' }}>
          {error}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="siteName">Site Name *</label>
        <input
          id="siteName"
          type="text"
          value={siteName}
          onChange={(e) => setSiteName(e.target.value)}
          placeholder="My Website"
          disabled={saving}
        />
      </div>

      <div className="form-group">
        <label htmlFor="siteDescription">Site Description *</label>
        <textarea
          id="siteDescription"
          rows={6}
          value={siteDescription}
          onChange={(e) => setSiteDescription(e.target.value)}
          placeholder="Describe what your website does, its primary purpose, content nature (static/dynamic), update patterns, and any special behaviors the AI should know about when generating tests."
          disabled={saving}
        />
        <small style={{ color: '#666', display: 'block', marginTop: '4px' }}>
          This helps the AI understand your site's context and generate more relevant tests.
        </small>
      </div>

      <div style={{ marginTop: '30px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '18px' }}>Important Tests</h3>
          <button
            className="btn btn-secondary btn-small"
            onClick={handleAddTest}
            disabled={saving}
          >
            + Add Test
          </button>
        </div>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
          List specific test scenarios you want to ensure are always generated. Describe them in plain English - the AI will convert them into structured test cases.
        </p>

        {importantTests.length === 0 ? (
          <div style={{ 
            padding: '20px', 
            background: '#f8f9fa', 
            borderRadius: '4px', 
            textAlign: 'center',
            color: '#666'
          }}>
            No tests added yet. Click "Add Test" to add important test scenarios.
          </div>
        ) : (
          importantTests.map((test, index) => (
            <div
              key={index}
              style={{
                padding: '16px',
                background: '#f8f9fa',
                borderRadius: '4px',
                marginBottom: '12px',
                border: '1px solid #e0e0e0'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <strong style={{ fontSize: '14px' }}>Test #{index + 1}</strong>
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => handleRemoveTest(index)}
                  disabled={saving}
                >
                  Remove
                </button>
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label htmlFor={`test-name-${index}`} style={{ fontSize: '13px' }}>Test Name *</label>
                <input
                  id={`test-name-${index}`}
                  type="text"
                  value={test.name}
                  onChange={(e) => handleTestChange(index, 'name', e.target.value)}
                  placeholder="e.g., User Login Flow"
                  disabled={saving}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label htmlFor={`test-description-${index}`} style={{ fontSize: '13px' }}>Description *</label>
                <textarea
                  id={`test-description-${index}`}
                  rows={3}
                  value={test.description}
                  onChange={(e) => handleTestChange(index, 'description', e.target.value)}
                  placeholder="Describe in plain English what this test should verify. Be specific about what should be tested and expected behavior."
                  disabled={saving}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor={`test-page-${index}`} style={{ fontSize: '13px' }}>Page (optional)</label>
                  <input
                    id={`test-page-${index}`}
                    type="text"
                    value={test.page || ''}
                    onChange={(e) => handleTestChange(index, 'page', e.target.value)}
                    placeholder="/login or /dashboard"
                    disabled={saving}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor={`test-priority-${index}`} style={{ fontSize: '13px' }}>Priority</label>
                  <select
                    id={`test-priority-${index}`}
                    value={test.priority || 'medium'}
                    onChange={(e) => handleTestChange(index, 'priority', e.target.value)}
                    disabled={saving}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '30px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>Testing Notes (Optional)</h3>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <textarea
            rows={4}
            value={testingNotes}
            onChange={(e) => setTestingNotes(e.target.value)}
            placeholder="Add any general testing guidance, notes about what NOT to test, or special considerations..."
            disabled={saving}
          />
          <small style={{ color: '#666', display: 'block', marginTop: '4px' }}>
            Use this for general testing guidance (e.g., 'Do not test specific content that changes frequently')
          </small>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !siteName.trim() || !siteDescription.trim()}
        >
          {saving ? 'Saving...' : 'Save Context File'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ContextEditor;

