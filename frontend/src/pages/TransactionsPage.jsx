// src/pages/TransactionsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import toast from '../lib/toast';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useOrg } from '../context/OrgContext';

const personName = (u) => u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || '—') : '—';
// Approver(s) currently pending on an expense (only meaningful when status is PENDING).
const pendingApprovers = (e) => {
  if (e.status !== 'PENDING') return '';
  const names = (e.approvals || []).filter(a => a.status === 'PENDING').map(a => personName(a.approver));
  return [...new Set(names)].join(', ');
};

const STATUS_COLORS = {
  DRAFT:      { bg: '#6b7280', text: '#ffffff' },
  PENDING:    { bg: '#f59e0b', text: '#ffffff' },
  APPROVED:   { bg: '#16a34a', text: '#ffffff' },
  REJECTED:   { bg: '#dc2626', text: '#ffffff' },
  RETURNED: { bg: '#d97706', text: '#ffffff' },
  PROCESSED: { bg: '#2563eb', text: '#ffffff' },
  CANCELLED:  { bg: '#9ca3af', text: '#ffffff' },
};

export default function TransactionsPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const { settings } = useOrg();
  const glCodes = settings?.categoryGlCodes || {};
  // Normalize keys (uppercase, trimmed) so lookup is resilient to casing/spacing.
  const glNorm = Object.fromEntries(Object.entries(glCodes).map(([k, v]) => [String(k).trim().toUpperCase(), v]));
  const glOf = (e) => e.glCode || glNorm[String(e.category || '').trim().toUpperCase()] || '—';
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
  const [selected, setSelected] = useState([]); // ids checked for deletion

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // PROCESSED / FOR_PROCESS are defined by the processed DATE, not the enum,
      // so we fetch broadly and filter client-side (handles older processed items
      // that may still carry the APPROVED status).
      if (status && status !== 'PROCESSED' && status !== 'FOR_PROCESS') params.set('status', status);
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

  // Processed = has a processed date; For Process = approved/processed status with no date yet.
  const visibleRows = rows.filter(e => {
    if (status === 'PROCESSED') return !!e.processedAt;
    if (status === 'FOR_PROCESS') return ['APPROVED','PROCESSED'].includes(e.status) && !e.processedAt;
    return true;
  });

  const markProcessed = async (id) => {
    const date = procDate[id] || new Date().toISOString().slice(0, 10);
    try {
      await api.post(`/expenses/${id}/mark-processed`, { processedDate: date });
      setMsg({ text: 'Marked processed', ok: true }); toast.success('Marked as processed');
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
      setMsg({ text: `Deleted ${r.deleted} transaction(s)`, ok: true }); toast.success(`Deleted ${r.deleted} transaction(s)`);
      setShowDelete(false); setDelFrom(''); setDelTo(''); setDelStatus('');
      await load();
    } catch (e) { setMsg({ text: e.error || 'Delete failed', ok: false }); }
    finally { setDeleting(false); }
  };

  const deleteSelected = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`PERMANENTLY delete ${selected.length} selected transaction(s)? This cannot be undone.`)) return;
    setDeleting(true); setMsg({ text: '', ok: true });
    try {
      const r = await api.post('/expenses/delete-selected', { ids: selected });
      setMsg({ text: `Deleted ${r.deleted} transaction(s)`, ok: true }); toast.success(`Deleted ${r.deleted} transaction(s)`);
      setSelected([]);
      await load();
    } catch (e) { setMsg({ text: e.error || 'Delete failed', ok: false }); }
    finally { setDeleting(false); }
  };

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(e => selected.includes(e.id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) setSelected(s => s.filter(id => !visibleRows.some(e => e.id === id)));
    else setSelected(s => [...new Set([...s, ...visibleRows.map(e => e.id)])]);
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const exportExcel = () => {
    const base = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ token });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status === 'PROCESSED') params.set('processed', 'yes');
    else if (status === 'FOR_PROCESS') { params.set('status', 'APPROVED'); params.set('processed', 'no'); }
    else if (status) params.set('status', status);
    window.open(`${base}/reports/export?${params.toString()}`, '_blank');
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">All Transactions</h1>
          <p className="text-sm text-gray-500">{visibleRows.length} shown</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && selected.length > 0 && (
            <button onClick={deleteSelected} disabled={deleting}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#dc2626' }}>
              {deleting ? 'Deleting…' : `🗑 Delete selected (${selected.length})`}
            </button>
          )}
          <button onClick={exportExcel}
            className="px-3 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#16a34a' }}>
            ⬇ Export Excel
          </button>
          {isAdmin && (
            <button onClick={() => setShowDelete(!showDelete)}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: '#dc2626' }}>
              🗑 Delete by date range
            </button>
          )}
        </div>
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
                {['DRAFT','PENDING','APPROVED','RETURNED','REJECTED','PROCESSED','CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
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
            <option value="DRAFT">DRAFT</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="FOR_PROCESS">FOR PROCESS</option>
            <option value="PROCESSED">PROCESSED</option>
            <option value="RETURNED">RETURNED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="CANCELLED">CANCELLED</option>
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
      ) : visibleRows.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No transactions found.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                {isAdmin && (
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll}
                      title="Select all" className="w-4 h-4 cursor-pointer" />
                  </th>
                )}
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">GL Code</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pending With</th>
                <th className="px-4 py-3">Processed</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  {isAdmin && (
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggleSelect(e.id)}
                        className="w-4 h-4 cursor-pointer" />
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-600">{fmtDate(e.expenseDate)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{personName(e.submittedBy)}</td>
                  <td className="px-4 py-3 text-gray-600">{e.merchant || e.title}</td>
                  <td className="px-4 py-3 text-gray-500">{glOf(e)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{format(e.amountPhp)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold"
                      style={{ backgroundColor: (STATUS_COLORS[e.status]||STATUS_COLORS.DRAFT).bg, color: (STATUS_COLORS[e.status]||STATUS_COLORS.DRAFT).text }}>{e.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {pendingApprovers(e)
                      ? <span className="text-amber-600 text-xs font-medium">{pendingApprovers(e)}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {e.processedAt
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">✓ {fmtDate(e.processedAt)}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {['APPROVED','PROCESSED'].includes(e.status) ? (
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
