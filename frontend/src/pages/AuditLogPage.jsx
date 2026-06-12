// src/pages/AuditLogPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';

const ACTION_LABELS = {
  EXPENSE_APPROVED: { label: 'Approved expense', color: '#16a34a' },
  EXPENSE_REJECTED: { label: 'Rejected expense', color: '#dc2626' },
  EXPENSE_MARKED_PROCESSED: { label: 'Marked processed', color: '#2563eb' },
  TRANSACTION_BULK_DELETED: { label: 'Deleted transactions', color: '#dc2626' },
  USER_BULK_DELETED: { label: 'Deleted employees', color: '#dc2626' },
  USER_ROLE_CHANGED: { label: 'Changed role', color: '#d97706' },
  USER_PASSWORD_RESET: { label: 'Reset password', color: '#7c3aed' },
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const d = await api.get(`/audit?${params.toString()}`);
      setLogs(Array.isArray(d) ? d : []);
    } catch (e) { setLogs([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [action, from, to]);

  const fmt = (d) => new Date(d).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-medium text-gray-900">Audit Log</h1>
        <p className="text-sm text-gray-500">{logs.length} recent events · who did what, and when</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-4 bg-white rounded-xl border border-gray-100 p-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Action</label>
          <select value={action} onChange={e => setAction(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
        {(action || from || to) && (
          <button onClick={() => { setAction(''); setFrom(''); setTo(''); }} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Clear</button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No audit events found.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => {
                const meta = ACTION_LABELS[l.action] || { label: l.action, color: '#6b7280' };
                return (
                  <tr key={l.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(l.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800">{l.actorName}</span>
                      {l.actorRole && <span className="text-gray-400 text-xs"> ({l.actorRole})</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: meta.color }}>{meta.label}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{l.details || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
