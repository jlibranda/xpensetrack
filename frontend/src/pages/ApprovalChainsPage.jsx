// src/pages/ApprovalChainsPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

const fullName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;

export default function ApprovalChainsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [chains, setChains] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: '', ok: true });

  // editor state
  const [editing, setEditing] = useState(null); // null = list view, {} = new, {...} = edit
  const [name, setName] = useState('');
  const [mode, setMode] = useState('SEQUENTIAL');
  const [steps, setSteps] = useState([{ approverIds: [] }]); // array of {approverIds:[]}
  const [saving, setSaving] = useState(false);

  // assignment
  const [assignChainId, setAssignChainId] = useState('');
  const [assignUserIds, setAssignUserIds] = useState([]);

  // bulk
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);

  const isAdmin = user?.role === 'ADMIN';

  const load = async () => {
    setLoading(true);
    try {
      const [c, u] = await Promise.all([api.get('/chains'), api.get('/users')]);
      setChains(Array.isArray(c) ? c : []);
      setUsers(Array.isArray(u) ? u : []);
    } catch (e) {
      setMsg({ text: e.error || 'Failed to load', ok: false });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const startNew = () => {
    setEditing({});
    setName(''); setMode('SEQUENTIAL'); setSteps([{ approverIds: [] }]);
    setMsg({ text: '', ok: true });
  };

  const startEdit = (chain) => {
    setEditing(chain);
    setName(chain.name);
    setMode(chain.mode);
    setSteps(chain.steps.map(s => ({ approverIds: s.approvers.map(a => a.approver.id) })));
    setMsg({ text: '', ok: true });
  };

  const addStep = () => {
    if (steps.length >= 5) { setMsg({ text: 'Maximum of 5 steps', ok: false }); return; }
    setSteps([...steps, { approverIds: [] }]);
  };
  const removeStep = (i) => setSteps(steps.filter((_, idx) => idx !== i));

  const toggleApprover = (stepIdx, userId) => {
    setSteps(steps.map((s, idx) => {
      if (idx !== stepIdx) return s;
      const has = s.approverIds.includes(userId);
      return { approverIds: has ? s.approverIds.filter(id => id !== userId) : [...s.approverIds, userId] };
    }));
  };

  const save = async () => {
    if (!name.trim()) { setMsg({ text: 'Chain name is required', ok: false }); return; }
    if (steps.length < 1 || steps.length > 5) { setMsg({ text: 'Between 1 and 5 steps required', ok: false }); return; }
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].approverIds.length < 1) { setMsg({ text: `Step ${i + 1} needs at least one approver`, ok: false }); return; }
    }
    setSaving(true); setMsg({ text: '', ok: true });
    try {
      const payload = { name: name.trim(), mode, steps };
      if (editing && editing.id) await api.patch(`/chains/${editing.id}`, payload);
      else await api.post('/chains', payload);
      setEditing(null);
      await load();
      setMsg({ text: 'Saved!', ok: true });
    } catch (e) {
      setMsg({ text: e.error || 'Failed to save', ok: false });
    } finally { setSaving(false); }
  };

  const del = async (chain) => {
    if (!window.confirm(`Delete chain "${chain.name}"?`)) return;
    try { await api.delete(`/chains/${chain.id}`); await load(); }
    catch (e) { setMsg({ text: e.error || 'Failed to delete', ok: false }); }
  };

  const doAssign = async () => {
    if (!assignChainId || assignUserIds.length === 0) { setMsg({ text: 'Pick a chain and at least one user', ok: false }); return; }
    try {
      await api.post('/chains/assign', { chainId: assignChainId, userIds: assignUserIds });
      setAssignUserIds([]); setAssignChainId('');
      await load();
      setMsg({ text: 'Chain assigned!', ok: true });
    } catch (e) { setMsg({ text: e.error || 'Failed to assign', ok: false }); }
  };

  // Bulk format (one chain per line):
  //   ChainName | SEQUENTIAL | step1email1,step1email2 ; step2email1 ; ...
  const parseBulk = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length < 3) continue;
      const [cName, cMode, ...rest] = parts;
      const stepsRaw = rest.join('|'); // in case of stray pipes
      const stepChunks = stepsRaw.split(';').map(s => s.trim()).filter(Boolean);
      const stepsArr = stepChunks.map(chunk => ({
        approverEmails: chunk.split(',').map(e => e.trim()).filter(Boolean),
      }));
      out.push({ name: cName, mode: (cMode.toUpperCase() === 'ANY_ORDER' ? 'ANY_ORDER' : 'SEQUENTIAL'), steps: stepsArr });
    }
    return out;
  };

  const runBulk = async () => {
    const chainsPayload = parseBulk(bulkText);
    if (chainsPayload.length === 0) { setMsg({ text: 'Nothing to upload — check the format', ok: false }); return; }
    try {
      const result = await api.post('/chains/bulk', { chains: chainsPayload });
      setBulkResult(result);
      await load();
    } catch (e) { setMsg({ text: e.error || 'Bulk upload failed', ok: false }); }
  };

  if (!isAdmin) {
    return <div className="p-6 text-sm text-gray-500">Only admins can manage approval chains.</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Approval Chains</h1>
          <p className="text-sm text-gray-500">Build reusable approval flows (1–5 steps). Each step can list multiple approvers as an "any one of" group.</p>
        </div>
        {!editing && (
          <div className="flex gap-2">
            <button onClick={() => setShowBulk(!showBulk)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Bulk upload</button>
            <button onClick={startNew} className="px-3 py-2 text-white rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>+ New chain</button>
          </div>
        )}
      </div>

      {msg.text && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${msg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {showBulk && !editing && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Bulk upload chains</h3>
          <p className="text-xs text-gray-500 mb-2">One chain per line. Format:<br />
            <code className="bg-gray-100 px-1 rounded">Name | SEQUENTIAL | email1,email2 ; email3 ; email4</code><br />
            Steps are separated by <b>;</b> — commas within a step form an "any one of" group. Mode is SEQUENTIAL or ANY_ORDER.</p>
          <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={5}
            placeholder={"Standard | SEQUENTIAL | manager@co.com ; finance@co.com\nFast Track | ANY_ORDER | jose@co.com,maria@co.com ; cfo@co.com"}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={runBulk} className="px-3 py-2 text-white rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>Upload</button>
          </div>
          {bulkResult && (
            <div className="mt-3 text-xs text-gray-600 space-y-1">
              <div className="text-green-700">Created: {bulkResult.created.length}</div>
              {bulkResult.skipped.length > 0 && <div className="text-amber-600">Skipped: {bulkResult.skipped.map(s => `${s.name} (${s.reason})`).join(', ')}</div>}
              {bulkResult.errors.length > 0 && <div className="text-red-600">Errors: {bulkResult.errors.map(e => `${e.name}: ${e.reason}`).join('; ')}</div>}
            </div>
          )}
        </div>
      )}

      {editing ? (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-medium text-gray-700">{editing.id ? `Edit: ${editing.name}` : 'New chain'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Chain name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="SEQUENTIAL">Sequential (one step after another)</option>
                <option value="ANY_ORDER">Any order (all steps open at once)</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {steps.map((s, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-700">Step {i + 1} {s.approverIds.length > 1 && <span className="text-gray-400">(any one of these approves)</span>}</span>
                  {steps.length > 1 && <button onClick={() => removeStep(i)} className="text-xs text-red-500 hover:underline">Remove step</button>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {users.filter(u => ['MANAGER', 'FINANCE', 'ADMIN'].includes(u.role)).map(u => {
                    const sel = s.approverIds.includes(u.id);
                    return (
                      <button key={u.id} onClick={() => toggleApprover(i, u.id)}
                        className={`text-xs px-2 py-1 rounded-lg border ${sel ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                        style={sel ? { backgroundColor: 'var(--brand-color,#1D9E75)' } : {}}>
                        {fullName(u)} <span className="opacity-60">({u.role})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {steps.length < 5 && <button onClick={addStep} className="text-sm text-gray-600 hover:underline">+ Add step</button>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditing(null)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
            <button onClick={save} disabled={saving} className="px-3 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-60" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>
              {saving ? 'Saving…' : 'Save chain'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
            <div className="space-y-2 mb-8">
              {chains.length === 0 && <p className="text-sm text-gray-400">No chains yet. Create one to get started.</p>}
              {chains.map(c => (
                <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{c.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{c.mode === 'ANY_ORDER' ? 'Any order' : 'Sequential'}</span>
                      <span className="text-xs text-gray-400">{c._count?.assignees || 0} user(s)</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {c.steps.map((s, idx) => (
                        <span key={s.id}>
                          {idx > 0 && <span className="mx-1">→</span>}
                          <span>Step {s.order}: {s.approvers.map(a => fullName(a.approver)).join(' OR ')}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => startEdit(c)} className="text-xs px-2 py-1 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50">Edit</button>
                    <button onClick={() => del(c)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Assignment panel */}
          {chains.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Assign a chain to users</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Chain</label>
                  <select value={assignChainId} onChange={e => setAssignChainId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    <option value="">Select a chain…</option>
                    {chains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Users ({assignUserIds.length} selected)</label>
                  <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto flex flex-wrap gap-1.5">
                    {users.map(u => {
                      const sel = assignUserIds.includes(u.id);
                      return (
                        <button key={u.id} onClick={() => setAssignUserIds(sel ? assignUserIds.filter(id => id !== u.id) : [...assignUserIds, u.id])}
                          className={`text-xs px-2 py-1 rounded-lg border ${sel ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                          style={sel ? { backgroundColor: 'var(--brand-color,#1D9E75)' } : {}}>
                          {fullName(u)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <button onClick={doAssign} className="px-3 py-2 text-white rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>Assign</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
