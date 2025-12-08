import React, { useState, useEffect } from 'react';
import ContextEditor from './ContextEditor';

interface ContextFile {
  domain: string;
  filename: string;
}

const ContextManager: React.FC = () => {
  const [files, setFiles] = useState<ContextFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    loadFiles();
  }, []);

  useEffect(() => {
    if (selectedFile) {
      loadFile(selectedFile);
    }
  }, [selectedFile]);

  const loadFiles = async () => {
    try {
      const response = await fetch('/api/context');
      const data = await response.json();
      setFiles(data);
    } catch (error) {
      console.error('Failed to load context files:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFile = async (domain: string) => {
    try {
      const response = await fetch(`/api/context/${domain}`);
      const data = await response.json();
      setContent(data);
    } catch (error) {
      console.error('Failed to load context file:', error);
      setMessage({ type: 'error', text: 'Failed to load context file' });
    }
  };

  const handleSave = async (data: any) => {
    if (!selectedFile) return;

    setMessage(null);

    try {
      const response = await fetch(`/api/context/${selectedFile}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Context file saved successfully' });
        setContent(data);
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || 'Failed to save context file' });
        throw new Error(data.error || 'Failed to save');
      }
    } catch (error) {
      throw error;
    }
  };

  const handleDelete = async (domain: string) => {
    if (!confirm(`Are you sure you want to delete the context file for ${domain}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/context/${domain}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Context file deleted successfully' });
        loadFiles();
        if (selectedFile === domain) {
          setSelectedFile(null);
          setContent(null);
        }
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || 'Failed to delete context file' });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to delete context file',
      });
    }
  };

  const handleCreate = async () => {
    if (!newDomain) {
      setMessage({ type: 'error', text: 'Domain is required' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const defaultContent = {
        siteName: newDomain,
        domain: newDomain,
        siteDescription: '',
        importantTests: [],
      };

      const response = await fetch(`/api/context/${newDomain}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(defaultContent),
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Context file created successfully' });
        setNewDomain('');
        setShowNewForm(false);
        loadFiles();
        setSelectedFile(newDomain);
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || 'Failed to create context file' });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to create context file',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0 }}>Context Files</h2>
            <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '14px' }}>
              Provide site descriptions and important tests to improve test generation
            </p>
          </div>
          <button
            className="btn btn-primary btn-small"
            onClick={() => setShowNewForm(!showNewForm)}
          >
            {showNewForm ? 'Cancel' : 'New Context File'}
          </button>
        </div>

        {message && (
          <div className={message.type === 'success' ? 'success' : 'error'} style={{ marginBottom: '20px' }}>
            {message.text}
          </div>
        )}

        {showNewForm && (
          <div style={{ marginBottom: '20px', padding: '16px', background: '#f8f9fa', borderRadius: '4px' }}>
            <div className="form-group">
              <label htmlFor="newDomain">Domain (e.g., example.com)</label>
              <input
                id="newDomain"
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
                disabled={saving}
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !newDomain}>
              {saving ? 'Creating...' : 'Create Context File'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading">Loading context files...</div>
        ) : files.length === 0 ? (
          <div className="loading">No context files found. Create one to get started.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Filename</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.domain}>
                  <td>
                    <code>{file.domain}</code>
                  </td>
                  <td>{file.filename}</td>
                  <td>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => setSelectedFile(file.domain)}
                      style={{ marginRight: '8px' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleDelete(file.domain)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedFile && content && (
        <ContextEditor
          domain={selectedFile}
          initialData={content}
          onSave={handleSave}
          onCancel={() => {
            setSelectedFile(null);
            setContent(null);
          }}
        />
      )}
    </div>
  );
};

export default ContextManager;


