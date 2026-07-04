// src/pages/TransactionsPage.jsx
import { useState, useEffect, useMemo } from 'react';
import api from '../lib/api';
import toast from '../lib/toast';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useOrg } from '../context/OrgContext';
import ReceiptImage from '../components/ReceiptImage';

const personName = (u) => u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || '—') : '—';
const pendingApprovers = (e) => {
  if (e.status !== 'PENDING') return '';
  const names = (e.approvals || [])
    .filter(a => a.status === 'PENDING')
    .sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0)) // show in approval-step sequence
    .map(a => personName(a.approver));
  return [...new Set(names)].join(', ');
};

const STATUS_COLORS = {
  DRAFT:      { bg: '#6b7280', text: '#ffffff' },
  PENDING:    { bg: '#f59e0b', text: '#ffffff' },
  APPROVED:   { bg: '#16a34a', text: '#ffffff' },
  REJECTED:   { bg: '#dc2626', text: '#ffffff' },
  RETURNED:   { bg: '#d97706', text: '#ffffff' },
  PROCESSED:  { bg: '#2563eb', text: '#ffffff' },
  CANCELLED:  { bg: '#9ca3af', text: '#ffffff' },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function TransactionsPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const { settings } = useOrg();
  const glCodes = settings?.categoryGlCodes || {};
  const glNorm = Object.fromEntries(Object.entries(glCodes).map(([k, v]) => [String(k).trim().toUpperCase(), v]));
  const glOf = (e) => e.glCode || glNorm[String(e.category || '').trim().toUpperCase()] || '—';
  const isAdmin = user?.role === 'ADMIN';
  const canProcess = ['FINANCE', 'ADMIN'].includes(user?.role);
  // Only Admins or users in the org's payout-reversal list may Undo.
  const reversalIds = Array.isArray(settings?.payoutReversalUserIds) ? settings.payoutReversalUserIds : [];
  const canUndo = isAdmin || reversalIds.includes(user?.id);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: '', ok: true });

  // filters
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payoutFilter, setPayoutFilter] = useState('');
  const [activeRange, setActiveRange] = useState('all'); // 'all' = no date filter (default = all dates)

  // payout / processing controls
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
  const [payoutDate, setPayoutDate] = useState(todayStr);
  const [processing, setProcessing] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState(null);


  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
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

  // Quick date-range presets for the Filter. Setting from/to re-triggers load().
  const setQuickRange = (mode) => {
    setActiveRange(mode);
    if (mode === 'all') { setFrom(''); setTo(''); return; }
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    let end = new Date(); let start;
    if (mode === 'week') { start = new Date(); start.setDate(start.getDate() - start.getDay()); end = new Date(start); end.setDate(start.getDate() + 6); }
    else if (mode === 'year') { start = new Date(end.getFullYear(), 0, 1); }
    else { start = new Date(); start.setMonth(start.getMonth() - mode + 1); start.setDate(1); }
    setFrom(ymd(start)); setTo(ymd(end));
  };

  const visibleRows = rows.filter(e => {
    if (from && new Date(e.expenseDate) < new Date(from + 'T00:00:00')) return false;
    if (to && new Date(e.expenseDate) > new Date(to + 'T23:59:59')) return false;
    if (payoutFilter) {
      const pd = e.payoutDate || e.processedAt;
      if (!pd || new Date(pd).toISOString().slice(0, 10) !== payoutFilter) return false;
    }
    if (status === 'PROCESSED') return !!e.processedAt;
    if (status === 'FOR_PROCESS') return ['APPROVED', 'PROCESSED'].includes(e.status) && !e.processedAt;
    return true;
  });

  // Distinct payout dates that have actually been processed (within the selected year),
  // used to populate the "Pay out date" filter dropdown. Most recent first.
  const payoutDateOptions = useMemo(() => {
    const set = new Set();
    for (const e of rows) {
      const pd = e.payoutDate || e.processedAt;
      if (pd) set.add(new Date(pd).toISOString().slice(0, 10));
    }
    return [...set].sort().reverse();
  }, [rows]);

  // If the selected payout date is no longer in the list (e.g. year changed), clear it.
  useEffect(() => {
    if (payoutFilter && !payoutDateOptions.includes(payoutFilter)) setPayoutFilter('');
  }, [payoutDateOptions]); // eslint-disable-line

  const selectedEligible = visibleRows.filter(e => selected.includes(e.id) && e.status === 'APPROVED' && !e.processedAt);

  const bulkMarkProcessed = async () => {
    if (selectedEligible.length === 0) { setMsg({ text: 'Select approved expenses that are not yet processed.', ok: false }); return; }
    if (!payoutDate) { setMsg({ text: 'Choose a pay out date first.', ok: false }); return; }
    setProcessing(true); setMsg({ text: '', ok: true });
    try {
      const r = await api.post('/expenses/bulk-mark-processed', { ids: selectedEligible.map(e => e.id), payoutDate });
      setMsg({ text: `Marked ${r.count} processed`, ok: true });
      toast.success(`Marked ${r.count} processed`);
      setSelected([]);
      await load();
    } catch (e) { setMsg({ text: e.error || 'Failed', ok: false }); }
    finally { setProcessing(false); }
  };

  const unmarkProcessed = async (id) => {
    try { await api.post(`/expenses/${id}/unmark-processed`, {}); await load(); }
    catch (e) { setMsg({ text: e.error || 'Failed', ok: false }); }
  };

  const saveRemarks = async (id, val) => {
    try { await api.patch(`/expenses/${id}/remarks`, { remarks: val }); }
    catch (e) { setMsg({ text: 'Failed to save remarks', ok: false }); }
  };

  const [uploadingProof, setUploadingProof] = useState(false);
  const uploadProof = async (expenseId, file) => {
    if (!file) return;
    setUploadingProof(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/ocr/proof-of-payment/${expenseId}`, fd);
      toast.success('Proof of payment uploaded');
      setDetail(d => (d && d.id === expenseId) ? { ...d, proofOfPayment: { id: r.id, mimeType: r.mimeType } } : d);
      await load();
    } catch (e) {
      setMsg({ text: e.error || e.message || 'Upload failed', ok: false });
    } finally { setUploadingProof(false); }
  };

  const deleteSelected = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`PERMANENTLY delete ${selected.length} selected transaction(s)? This cannot be undone.`)) return;
    setDeleting(true); setMsg({ text: '', ok: true });
    try {
      const r = await api.post('/expenses/delete-selected', { ids: selected });
      setMsg({ text: `Deleted ${r.deleted} transaction(s)`, ok: true }); toast.success(`Deleted ${r.deleted} transaction(s)`);
      setSelected([]); await load();
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
    if (payoutFilter) params.set('payoutDate', payoutFilter);
    if (status === 'PROCESSED') params.set('processed', 'yes');
    else if (status === 'FOR_PROCESS') { params.set('status', 'APPROVED'); params.set('processed', 'no'); }
    else if (status) params.set('status', status);
    window.open(`${base}/reports/export?${params.toString()}`, '_blank');
  };

  const showChecks = canProcess; // Finance/Admin can select rows

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">All Transactions</h1>
          <p className="text-sm text-gray-500">{visibleRows.length} shown</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={deleteSelected} disabled={deleting || selected.length === 0}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#dc2626' }}>
              {deleting ? 'Deleting…' : `🗑 Delete selected${selected.length ? ` (${selected.length})` : ''}`}
            </button>
          )}
          <button onClick={exportExcel} className="px-3 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: '#16a34a' }}>
            ⬇ Export Excel
          </button>
        </div>
      </div>

      {msg.text && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm border ${msg.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{msg.text}</div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end mb-4 bg-white rounded-xl border border-gray-100 p-3">
        <p className="w-full text-xs font-semibold text-gray-500 uppercase tracking-wide">Filter</p>
        <div className="w-full flex flex-wrap gap-2">
          {[['This week','week'],['This month',1],['Last 3 months',3],['Last 6 months',6],['This year','year'],['All dates','all']].map(([label,m]) => {
            const active = activeRange === m;
            return (
              <button key={label} onClick={() => { if (m !== 'all' && activeRange === m) setQuickRange('all'); else setQuickRange(m); }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${active ? 'bg-brand-400 text-white border-brand-400 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            );
          })}
        </div>
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
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setActiveRange(null); }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setActiveRange(null); }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Pay out date</label>
          <select value={payoutFilter} onChange={e => setPayoutFilter(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
            <option value="">All</option>
            {payoutDateOptions.map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
        </div>
        {(status || from || to || payoutFilter) && (
          <button onClick={() => { setStatus(''); setFrom(''); setTo(''); setPayoutFilter(''); setActiveRange('all'); }} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Clear</button>
        )}
      </div>

      {/* Process payout bar */}
      {canProcess && (
        <div className="flex flex-wrap gap-3 items-end mb-4 bg-violet-50 rounded-xl border border-violet-200 p-3">
          <p className="w-full text-xs font-semibold text-violet-700 uppercase tracking-wide">Process payout</p>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Pay out date</label>
            <input type="date" value={payoutDate} onChange={e => setPayoutDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" />
          </div>
          <button onClick={bulkMarkProcessed} disabled={processing || selectedEligible.length === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>
            {processing ? 'Processing…' : `Mark processed${selectedEligible.length ? ` (${selectedEligible.length})` : ''}`}
          </button>
          <p className="text-xs text-gray-500 self-center">Tick approved expenses, choose the pay out date, then mark processed.</p>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : visibleRows.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No transactions found.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                {showChecks && (
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} title="Select all" className="w-4 h-4 cursor-pointer" />
                  </th>
                )}
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">GL Code</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pending With</th>
                <th className="px-4 py-3">Pay out date</th>
                <th className="px-4 py-3">Remarks</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  {showChecks && (
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggleSelect(e.id)} className="w-4 h-4 cursor-pointer" />
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-600">{fmtDate(e.expenseDate)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{personName(e.submittedBy)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setDetail(e)} className="text-left text-gray-600 hover:text-gray-900 hover:underline">{e.merchant || e.title}</button>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{glOf(e)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{format(e.amountPhp)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold"
                      style={{ backgroundColor: (STATUS_COLORS[e.status] || STATUS_COLORS.DRAFT).bg, color: (STATUS_COLORS[e.status] || STATUS_COLORS.DRAFT).text }}>{e.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {pendingApprovers(e) ? <span className="text-amber-600 text-xs font-medium">{pendingApprovers(e)}</span> : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {(e.payoutDate || e.processedAt)
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">✓ {fmtDate(e.payoutDate || e.processedAt)}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {canProcess ? (
                      <input type="text" defaultValue={e.remarks || ''} placeholder="Add remarks"
                        onBlur={ev => { if ((ev.target.value || '') !== (e.remarks || '')) saveRemarks(e.id, ev.target.value); }}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs w-36" />
                    ) : (
                      <span className="text-xs text-gray-600">{e.remarks || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canUndo && e.processedAt && ['APPROVED', 'PROCESSED'].includes(e.status)
                      ? <button onClick={() => unmarkProcessed(e.id)} className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">Undo</button>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Expense details modal (read-only) */}
      {detail && (() => {
        const e = detail;
        const row = (label, val) => val ? (
          <div className="flex justify-between py-1.5 border-b border-gray-50">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-800 text-right max-w-[60%]">{val}</span>
          </div>
        ) : null;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
            <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={ev => ev.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm font-medium text-gray-900">Expense details</p>
                <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
              </div>
              {e.receipt?.id ? (
                <div className="mb-4"><ReceiptImage receiptId={e.receipt.id} className="w-full max-h-56 object-contain rounded-lg" /></div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-6 text-center mb-4">
                  <p className="text-2xl mb-1">🧾</p>
                  <p className="text-xs text-gray-400">No receipt attached</p>
                </div>
              )}
              <div className="mb-3">
                <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: (STATUS_COLORS[e.status] || STATUS_COLORS.DRAFT).bg, color: (STATUS_COLORS[e.status] || STATUS_COLORS.DRAFT).text }}>{e.status}</span>
              </div>
              <div className="space-y-0.5 text-xs">
                {row('Submitted by', personName(e.submittedBy))}
                {row('Department', e.submittedBy?.department)}
                {row('Merchant', e.merchant)}
                {row('Description', e.title)}
                {row('Amount', format(e.amountPhp))}
                {row('OR / Invoice no.', e.orNumber)}
                {row('Type', e.expenseType ? e.expenseType.toLowerCase().replace('_', ' ') : '')}
                {row('Category', e.category)}
                {row('GL code', glOf(e))}
                {row('Cost center', e.costCenter || e.submittedBy?.costCenter)}
                {row('Date', fmtDate(e.expenseDate))}
                {row('Pending with', pendingApprovers(e))}
                {row('Pay out date', e.payoutDate ? fmtDate(e.payoutDate) : '')}
                {row('Processed on', e.processedAt ? fmtDate(e.processedAt) : '')}
                {row('Remarks', e.remarks)}
                {e.description && e.description !== e.title ? row('Notes', e.description) : null}
              </div>

              {/* Proof of payment */}
              <div className="mt-4 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-700 mb-2">Proof of payment</p>
                {e.proofOfPayment?.id ? (
                  <div className="space-y-2">
                    <ReceiptImage receiptId={e.proofOfPayment.id} className="w-full max-h-56 object-contain rounded-lg border border-gray-100" />
                    {canProcess && (
                      <label className={`inline-block text-xs px-3 py-1.5 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 ${uploadingProof ? 'opacity-50 pointer-events-none' : ''}`}>
                        {uploadingProof ? 'Uploading…' : 'Replace proof of payment'}
                        <input type="file" accept="image/*,application/pdf" className="hidden"
                          onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; uploadProof(e.id, f); }} />
                      </label>
                    )}
                  </div>
                ) : canProcess ? (
                  <label className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed border-gray-200 rounded-lg p-4 cursor-pointer hover:border-brand-400 hover:bg-gray-50 ${uploadingProof ? 'opacity-50 pointer-events-none' : ''}`}>
                    <span className="text-2xl">📎</span>
                    <span className="text-xs text-gray-600">{uploadingProof ? 'Uploading…' : 'Upload proof of payment'}</span>
                    <span className="text-[10px] text-gray-400">Image or PDF</span>
                    <input type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; uploadProof(e.id, f); }} />
                  </label>
                ) : (
                  <p className="text-xs text-gray-400">No proof of payment uploaded</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
