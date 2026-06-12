// src/pages/TransactionsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';

const personName = (u) => u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || '—') : '—';

const STATUS_BADGE = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  REIMBURSED: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

export default function TransactionsPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const isAdmin = user?.role === 'ADMIN';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: '', ok: true });

  // filters
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // mark-processed date per row
  const [procDate, setProcDate] = useState({});

  // delete panel
  const [showDelete, setShowDelete] = useState(false);
  const [delFrom, setDelFrom] = useState('');
  const [delTo, setDelTo] = useState('');
  const [delStatus, setDelStatus] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('limit', '500');
      const d = await api.get(`/expenses?${params.toString()}`);
      setRows(d?.expenses || []);
    } catch (e) {
      setMsg({ text: e.error || 'Failed to load', ok: false });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, from, to]);

  const markProcessed = async (id) => {
    const date = procDate[id] || new Date().toISOString().slice(0, 10);
    try {
      await api.post(`/expenses/${id}/mark-processed`, { processedDate: date });
      setMsg({ text: 'Marked processed', ok: true });
      await load();
    } catch (e) { setMsg({ text: e.error || 'Failed', ok: false }); }
  };

  const unmarkProcessed = async (id) => {
    try {
      await api.post(`/expenses/${id}/unmark-processed`, {});
      await load();
    } catch (e) { setMsg({ text: e.error || 'Failed', ok: false }); }
  };

  const runDelete = async () => {
    if (!delFrom && !delTo) { setMsg({ text: 'Set a date range to delete', ok: false }); return; }
    const label = `${delFrom || '…'} to ${delTo || '…'}${delStatus ? ` (status: ${delStatus})` : ' (all statuses)'}`;
    if (!window.confirm(`PERMANENTLY delete all transactions with expense date ${label}? This cannot be undone.`)) return;
    setDeleting(true); setMsg({ text: '', ok: true });
    try {
      const r = await api.post('/expenses/bulk-delete', { from: delFrom || undefined, to: delTo || undefined, status: delStatus || undefined });
      setMsg({ text: `Deleted ${r.deleted} transaction(s)`, ok: true });
      setShowDelete(false); setDelFrom(''); setDelTo(''); setDelStatus('');
      await load();
    } catch (e) { setMsg({ text: e.error || 'Delete failed', ok: false }); }
    finally { setDeleting(false); }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">All Transactions</h1>
          <p className="text-sm text-gray-500">{rows.length} shown</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowDelete(!showDelete)}
            className="px-3 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#dc2626' }}>
            🗑 Delete by date range
          </button>
        )}
      </div>

      {msg.text && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm border ${msg.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{msg.text}</div>
      )}

      {isAdmin && showDelete && (
        <div className="mb-4 rounded-xl border p-4" style={{ borderColor: 'rgba(220,38,38,0.4)', backgroundColor: 'rgba(220,38,38,0.08)' }}>
          <h3 className="text-sm font-bold text-red-600 mb-2">Permanently delete transactions</h3>
          <p className="text-xs text-gray-500 mb-3">Deletes every transaction whose expense date falls in the range. This cannot be undone.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={delFrom} onChange={e => setDelFrom(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={delTo} onChange={e => setDelTo(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status (optional)</label>
              <select value={delStatus} onChange={e => setDelStatus(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="">All statuses</option>
                {['DRAFT','PENDING','APPROVED','REJECTED','REIMBURSED','CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={runDelete} disabled={deleting}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#dc2626' }}>
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end mb-4 bg-white rounded-xl border border-gray-100 p-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
            <option value="">All</option>
            {['DRAFT','PENDING','APPROVED','REJECTED','REIMBURSED','CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
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
        {(status || from || to) && (
          <button onClick={() => { setStatus(''); setFrom(''); setTo(''); }} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Clear</button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No transactions found.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Processed</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 text-gray-600">{fmtDate(e.expenseDate)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{personName(e.submittedBy)}</td>
                  <td className="px-4 py-3 text-gray-600">{e.merchant || e.title}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{format(e.amountPhp)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[e.status] || ''}`}>{e.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {e.processedAt
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">✓ {fmtDate(e.processedAt)}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {['APPROVED','REIMBURSED'].includes(e.status) ? (
                      e.processedAt ? (
                        <button onClick={() => unmarkProcessed(e.id)} className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">Undo</button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input type="date" value={procDate[e.id] || new Date().toISOString().slice(0,10)}
                            onChange={ev => setProcDate(p => ({ ...p, [e.id]: ev.target.value }))}
                            className="px-2 py-1 border border-gray-200 rounded-lg text-xs" />
                          <button onClick={() => markProcessed(e.id)}
                            className="text-xs px-2 py-1 rounded-lg text-white font-medium" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>
                            Mark processed
                          </button>
                        </div>
                      )
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
