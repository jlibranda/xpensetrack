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
  // Only the approver(s) it is CURRENTLY waiting on — i.e. the earliest step that
  // still has a pending approval. Later-step approvers are not shown, since the
  // form hasn't reached them yet.
  const pending = (e.approvals || []).filter(a => a.status === 'PENDING');
  if (!pending.length) return '';
  const currentStep = Math.min(...pending.map(a => a.stepOrder ?? a.level ?? 0));
  const names = pending
    .filter(a => (a.stepOrder ?? a.level ?? 0) === currentStep)
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
  // Auto-dismiss success (green) messages so they don't linger on screen.
  useEffect(() => {
    if (msg.text && msg.ok) {
      const t = setTimeout(() => setMsg({ text: '', ok: true }), 3500);
      return () => clearTimeout(t);
    }
  }, [msg]);

  // filters
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payoutFilter, setPayoutFilter] = useState('');
  const [search, setSearch] = useState(''); // live payee/merchant/keyword filter (client-side)
  const [source, setSource] = useState('expense'); // 'expense' | 'ledger' (AP/AR)
  const [activeRange, setActiveRange] = useState('all'); // 'all' = no date filter (default = all dates)

  // payout / processing controls
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
  const [payoutDate, setPayoutDate] = useState(todayStr);
  const [processing, setProcessing] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState(null);
  const [gen2307, setGen2307] = useState(null);
  const [gen2307Data, setGen2307Data] = useState(null);
  const [gen2307Loading, setGen2307Loading] = useState(false);
  const [ewtDraft, setEwtDraft] = useState(null);
  const atcList = settings?.atcCodes || [];
  useEffect(() => {
    if (detail && detail._isLedger) setEwtDraft({ atcCode: detail.atcCode || '', ewtRate: detail.ewtRate ?? '', ewtBase: detail.ewtBase ?? '', ewtAmount: detail.ewtAmount ?? '' });
    else setEwtDraft(null);
  }, [detail]);
  const setEwtField = (patch) => setEwtDraft(prev => {
    const next = { ...(prev || {}), ...patch };
    if (!('ewtAmount' in patch)) {
      const base = Number(next.ewtBase), rate = Number(next.ewtRate);
      if (!isNaN(base) && !isNaN(rate) && next.ewtBase !== '' && next.ewtRate !== '') next.ewtAmount = +((base * rate) / 100).toFixed(2);
    }
    return next;
  });
  const saveEwt = async (id) => {
    try {
      await api.patch(`/ledger/${id}`, {
        atcCode: ewtDraft.atcCode || null,
        ewtRate: ewtDraft.ewtRate === '' ? null : Number(ewtDraft.ewtRate),
        ewtBase: ewtDraft.ewtBase === '' ? null : Number(ewtDraft.ewtBase),
        ewtAmount: ewtDraft.ewtAmount === '' ? null : Number(ewtDraft.ewtAmount),
      });
      toast.success('Withholding tax saved');
      await load();
      setDetail(d => d ? { ...d, ...ewtDraft } : d);
    } catch (e) { toast.error('Failed to save'); }
  };


  const load = async () => {
    setLoading(true);
    try {
      if (source === 'ledger') {
        const d = await api.get('/ledger');
        const arr = Array.isArray(d) ? d : (d?.docs || []);
        // Normalize AP/AR docs into the expense shape this table expects.
        setRows(arr.map(doc => ({
          id: doc.id,
          _isLedger: true,
          merchant: doc.vendorName || 'AP/AR document',
          vendorName: doc.vendorName || '',
          vendorTin: doc.vendorTin || '',
          atcCode: doc.atcCode || '',
          ewtRate: doc.ewtRate,
          ewtBase: doc.ewtBase,
          ewtAmount: doc.ewtAmount,
          docDate: doc.docDate,
          title: doc.docNumber ? `${doc.vendorName || 'AP/AR'} — ${doc.docNumber}` : (doc.vendorName || 'AP/AR document'),
          description: doc.notes || '',
          amountPhp: doc.amountPhp != null ? doc.amountPhp : doc.amount,
          category: doc.category || '',
          status: doc.status,
          expenseDate: doc.docDate || doc.createdAt,
          processedAt: doc.processedAt,
          payoutDate: doc.payoutDate,
          remarks: doc.remarks || '',
          submittedBy: doc.createdBy || null,
          approvals: doc.approvals || [],
          receipt: doc.receipt || null,
          proofOfPayment: doc.proofOfPayment || null,
          paymentNotifiedAt: doc.paymentNotifiedAt || null,
          orNumber: doc.docNumber || '',
        })));
      } else {
        const params = new URLSearchParams();
        if (status && status !== 'PROCESSED' && status !== 'FOR_PROCESS') params.set('status', status);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        params.set('limit', '500');
        const d = await api.get(`/expenses?${params.toString()}`);
        setRows(d?.expenses || []);
      }
    } catch (e) {
      setMsg({ text: e.error || 'Failed to load', ok: false });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, from, to, source]);

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

  const kw = search.trim().toLowerCase();
  const visibleRows = rows.filter(e => {
    if (from && new Date(e.expenseDate) < new Date(from + 'T00:00:00')) return false;
    if (to && new Date(e.expenseDate) > new Date(to + 'T23:59:59')) return false;
    if (payoutFilter) {
      const pd = e.payoutDate || e.processedAt;
      if (!pd || new Date(pd).toISOString().slice(0, 10) !== payoutFilter) return false;
    }
    if (status === 'PROCESSED' && !e.processedAt) return false;
    if (status === 'FOR_PROCESS' && !(['APPROVED', 'PROCESSED'].includes(e.status) && !e.processedAt)) return false;
    if (kw) {
      const hay = [e.merchant, e.vendorName, e.title, e.description, e.category, e.vendorTin, e.orNumber, e.atcCode, personName(e.submittedBy)]
        .map(v => String(v || '').toLowerCase());
      if (!hay.some(h => h.includes(kw))) return false;
    }
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
    if (selectedEligible.length === 0) { setMsg({ text: 'Select approved items that are not yet processed.', ok: false }); return; }
    if (!payoutDate) { setMsg({ text: 'Choose a pay out date first.', ok: false }); return; }
    setProcessing(true); setMsg({ text: '', ok: true });
    try {
      const url = source === 'ledger' ? '/ledger/bulk-mark-processed' : '/expenses/bulk-mark-processed';
      const r = await api.post(url, { ids: selectedEligible.map(e => e.id), payoutDate });
      setMsg({ text: `Marked ${r.count} processed`, ok: true });
      toast.success(`Marked ${r.count} processed`);
      setSelected([]);
      await load();
    } catch (e) { setMsg({ text: e.error || 'Failed', ok: false }); }
    finally { setProcessing(false); }
  };

  const unmarkProcessed = async (id) => {
    try { await api.post(source === 'ledger' ? `/ledger/${id}/unmark-processed` : `/expenses/${id}/unmark-processed`, {}); await load(); }
    catch (e) { setMsg({ text: e.error || 'Failed', ok: false }); }
  };

  const saveRemarks = async (id, val) => {
    try { if (source === 'ledger') await api.patch(`/ledger/${id}`, { remarks: val }); else await api.patch(`/expenses/${id}/remarks`, { remarks: val }); }
    catch (e) { setMsg({ text: 'Failed to save remarks', ok: false }); }
  };

  const [uploadingProof, setUploadingProof] = useState(false);
  const [notifying, setNotifying] = useState(false);

  // ✉️ Email vendor (POP + 2307): { vendorName, ids: [docId,...] } — supports
  // several invoices in one email (one/many POPs + one combined 2307).
  const [vendorMail, setVendorMail] = useState(null);
  const [vendorMailSending, setVendorMailSending] = useState(false);
  const vendorRec = (name) => (Array.isArray(settings?.vendors) ? settings.vendors : []).find(v => String(v.name||'').trim().toLowerCase() === String(name||'').trim().toLowerCase());
  const sendVendorMail = async () => {
    if (!vendorMail?.ids?.length) return;
    setVendorMailSending(true);
    try {
      const v = vendorRec(vendorMail.vendorName);
      const email = (vendorMail.email ?? (v?.email || '')).trim();
      const contactPerson = (vendorMail.contactPerson ?? (v?.contactPerson || '')).trim();
      const r = await api.post('/ledger/email-vendor', {
        ids: vendorMail.ids,
        email,
        contactPerson,
        saveVendor: vendorMail.saveVendor !== false, // default: save manual email for next time
        attachPop: vendorMail.attachPop !== false,
        attach2307: vendorMail.attach2307 !== false,
      });
      toast.success(r.message || 'Sent to vendor');
      setVendorMail(null);
    } catch (e2) { toast.error(e2.error || 'Failed to email vendor'); }
    finally { setVendorMailSending(false); }
  };
  const notifyPayment = async (id) => {
    setNotifying(true);
    try {
      const endpoint = source === 'ledger' ? `/ledger/${id}/notify-payment` : `/expenses/${id}/notify-payment`;
      const r = await api.post(endpoint, {});
      toast.success('Payment notification email sent');
      setDetail(d => (d && d.id === id) ? { ...d, paymentNotifiedAt: r.paymentNotifiedAt || new Date().toISOString() } : d);
      await load();
    } catch (e) {
      const msg = e.error || e.message || 'Failed to send notification';
      toast.error(msg);
      if (/already sent/i.test(msg)) {
        setDetail(d => (d && d.id === id) ? { ...d, paymentNotifiedAt: e.paymentNotifiedAt || new Date().toISOString() } : d);
      }
    } finally { setNotifying(false); }
  };
  const uploadProof = async (id, file) => {
    if (!file) return;
    setUploadingProof(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const endpoint = source === 'ledger' ? `/ocr/ledger-proof-of-payment/${id}` : `/ocr/proof-of-payment/${id}`;
      const r = await api.post(endpoint, fd);
      toast.success('Proof of payment uploaded');
      setDetail(d => (d && d.id === id) ? { ...d, proofOfPayment: { id: r.id, mimeType: r.mimeType } } : d);
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
      const r = await api.post(source === 'ledger' ? '/ledger/delete-selected' : '/expenses/delete-selected', { ids: selected });
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
    if (selected.length === 0) { toast.error('Please tick the row(s) you want to export first.'); return; }
    const base = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ token });
    params.set('ids', selected.join(','));
    window.open(`${base}/${source === 'ledger' ? 'ledger' : 'reports'}/export?${params.toString()}`, '_blank');
  };

  const generate2307Pdf = async () => {
    const base = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${base}/ledger/2307/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(gen2307Data),
      });
      if (!res.ok) { toast.error('Failed to generate PDF'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const vn = (gen2307Data.payee?.name || 'payee').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      a.download = `2307-${vn}-Q${gen2307Data.scopeQuarter || ''}-${gen2307Data.scopeYear || ''}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast.success('2307 generated');
    } catch (e) { toast.error('Failed to generate PDF'); }
  };
  const setRow2307 = (i, patch) => setGen2307Data(d => ({ ...d, rows: d.rows.map((r, idx) => {
    if (idx !== i) return r;
    const next = { ...r, ...patch };
    if (!('tax' in patch)) {
      const rate = Number(next.rate);
      if (!isNaN(rate) && rate) {
        const total = (Number(next.m1) || 0) + (Number(next.m2) || 0) + (Number(next.m3) || 0);
        next.tax = +((total * rate) / 100).toFixed(2);
      }
    }
    return next;
  }) }));
  const openGen2307Selected = async () => {
    if (!selected.length) return;
    setGen2307Loading(true);
    try {
      const data = await api.get(`/ledger/2307/prepare?ids=${encodeURIComponent(selected.join(','))}`);
      if (!data.rows || !data.rows.length) data.rows = [{ desc: '', atc: '', rate: '', m1: 0, m2: 0, m3: 0, tax: 0 }];
      const first = visibleRows.find(r => selected.includes(r.id)) || {};
      setGen2307Data(data);
      setGen2307(first); // open only once data is ready → form shows directly, no intermediate window
    } catch (e) { toast.error(e?.response?.data?.error || 'Cannot prepare 2307'); }
    finally { setGen2307Loading(false); }
  };
  const setField2307 = (path, val) => setGen2307Data(d => {
    const nd = { ...d };
    if (path.startsWith('payee.')) nd.payee = { ...d.payee, [path.slice(6)]: val };
    else if (path.startsWith('payor.')) nd.payor = { ...d.payor, [path.slice(6)]: val };
    else nd[path] = val;
    return nd;
  });

  const showChecks = canProcess; // Finance/Admin can select rows

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">All Transactions</h1>
          <p className="text-sm text-gray-500">{visibleRows.length} shown</p>
        </div>
        <div className="flex items-center gap-2">
          {source === 'ledger' && (
            <button onClick={openGen2307Selected} disabled={selected.length === 0 || gen2307Loading}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#dc2626' }}>
              {gen2307Loading ? 'Preparing…' : `📄 Generate 2307${selected.length ? ` (${selected.length})` : ''}`}
            </button>
          )}
          {isAdmin && (
            <button onClick={deleteSelected} disabled={deleting || selected.length === 0}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#dc2626' }}>
              {deleting ? 'Deleting…' : `🗑 Delete selected${selected.length ? ` (${selected.length})` : ''}`}
            </button>
          )}
          <button onClick={exportExcel}
            className="px-3 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#16a34a' }}>
            ⬇ {selected.length > 0 ? `Export selected (${selected.length})` : 'Export Excel'}
          </button>
        </div>
      </div>

      {/* Source toggle: Expenses vs AP & AR invoices */}
      <div className="seg-group mb-4">
        <button onClick={() => { setSource('expense'); setSelected([]); }}
          className={`seg-btn ${source === 'expense' ? 'active' : ''}`}>
          Expenses
        </button>
        <button onClick={() => { setSource('ledger'); setSelected([]); }}
          className={`seg-btn ${source === 'ledger' ? 'active' : ''}`}>
          AP &amp; AR
        </button>
      </div>

      {msg.text && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm border flex items-start justify-between gap-3 ${msg.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg({ text: '', ok: true })} className="opacity-60 hover:opacity-100 leading-none">✕</button>
        </div>
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
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">{source === 'ledger' ? 'Search payee / vendor / keyword' : 'Search merchant / employee / keyword'}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={source === 'ledger' ? 'vendor, doc #, TIN, ATC, notes…' : 'merchant, employee, category, notes…'}
            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
        </div>
        {(status || from || to || payoutFilter || search) && (
          <button onClick={() => { setStatus(''); setFrom(''); setTo(''); setPayoutFilter(''); setSearch(''); setActiveRange('all'); }} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Clear</button>
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
            style={{ backgroundColor: 'var(--brand-color,#1D9E75)', color: 'var(--brand-contrast,#fff)' }}>
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
                <th className="px-4 py-3">Proof</th>
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
                    {e.proofOfPayment?.id
                      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>✓ Proof</span>
                      : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>None</span>}
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
                    <div className="flex items-center gap-1">
                      {canUndo && e.processedAt && ['APPROVED', 'PROCESSED'].includes(e.status)
                        ? <button onClick={() => unmarkProcessed(e.id)} className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">Undo</button>
                        : (source === 'ledger' && e.processedAt ? null : <span className="text-xs text-gray-300">—</span>)}
                    </div>
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
                <p className="text-sm font-medium text-gray-900">{source === 'ledger' ? 'AP/AR invoice details' : 'Expense details'}</p>
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

              {/* Proof of payment (expenses and AP/AR) — only for PROCESSED transactions */}
              {(source === 'expense' || source === 'ledger') && (() => {
              const canUploadProof = canProcess && e.status === 'PROCESSED';
              return (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-700 mb-2">Proof of payment</p>
                {e.proofOfPayment?.id ? (
                  <div className="space-y-2">
                    <ReceiptImage receiptId={e.proofOfPayment.id} className="w-full max-h-56 object-contain rounded-lg border border-gray-100" />
                    {canUploadProof && (
                      <label className={`inline-block text-xs px-3 py-1.5 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 btn-like ${uploadingProof ? 'opacity-50 pointer-events-none' : ''}`}>
                        {uploadingProof ? 'Uploading…' : 'Replace proof of payment'}
                        <input type="file" accept="image/*,application/pdf" className="hidden"
                          onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; uploadProof(e.id, f); }} />
                      </label>
                    )}
                  </div>
                ) : canUploadProof ? (
                  <label className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed border-gray-200 rounded-lg p-4 cursor-pointer hover:border-brand-400 hover:bg-gray-50 ${uploadingProof ? 'opacity-50 pointer-events-none' : ''}`}>
                    <span className="text-2xl">📎</span>
                    <span className="text-xs text-gray-600">{uploadingProof ? 'Uploading…' : 'Upload proof of payment'}</span>
                    <span className="text-[10px] text-gray-400">Image or PDF</span>
                    <input type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; uploadProof(e.id, f); }} />
                  </label>
                ) : canProcess ? (
                  <p className="text-xs text-gray-400">Proof of payment can be uploaded once this transaction is <span className="font-medium">Processed</span>.</p>
                ) : (
                  <p className="text-xs text-gray-400">No proof of payment uploaded</p>
                )}
                {e.proofOfPayment?.id && canProcess && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {e.paymentNotifiedAt ? (
                      <p className="text-xs font-medium flex items-center gap-1" style={{ color: '#16a34a' }}>
                        ✓ Payment notification sent · {new Date(e.paymentNotifiedAt).toLocaleDateString()}
                      </p>
                    ) : (
                      <button onClick={() => notifyPayment(e.id)} disabled={notifying}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-60"
                        style={{ backgroundColor: 'var(--brand-color)', color: 'var(--brand-contrast,#fff)' }}>
                        {notifying ? 'Sending…' : '✉️ Send payment notification'}
                      </button>
                    )}
                    {e._isLedger && (
                      <button onClick={() => setVendorMail({ vendorName: e.vendorName, ids: [e.id] })}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium border border-gray-200 hover:bg-gray-50">
                        ✉️ Email vendor (POP + 2307)
                      </button>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">Emails the filer that this {source === 'ledger' ? 'AP/AR invoice' : 'expense'} has been paid/credited. Sent once only.</p>
                  </div>
                )}
              </div>
              );
              })()}
              {/* (Expanded Withholding Tax editor removed per request) */}

            </div>
          </div>
        );
      })()}

      {/* BIR 2307 generator chooser */}
      {gen2307 && (() => {
        const close = () => { setGen2307(null); setGen2307Data(null); };
        const d = gen2307Data;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={close}>
            <div className="bg-white rounded-2xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-gray-900">Generate BIR Form 2307</p>
                <button onClick={close} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
              </div>
              <p className="text-xs text-gray-500 mb-4">Payee: <span className="font-medium text-gray-700">{gen2307.vendorName || gen2307.merchant}</span></p>

              {!d ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-gray-400">Preparing 2307…</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Period — editable */}
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-1">Period covered</p>
                    <div className="flex items-center gap-2">
                      <div>
                        <label className="block text-[11px] text-gray-500">From</label>
                        <input type="date" value={d.periodFrom || ''} onChange={e => setField2307('periodFrom', e.target.value)}
                          className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500">To</label>
                        <input type="date" value={d.periodTo || ''} onChange={e => setField2307('periodTo', e.target.value)}
                          className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
                      </div>
                    </div>
                  </div>

                  {/* Payee / Payor — editable, prefilled */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="border border-gray-100 rounded-lg p-2 space-y-1">
                      <p className="text-[11px] font-semibold text-gray-600">PAYEE</p>
                      <input value={d.payee?.name || ''} onChange={e => setField2307('payee.name', e.target.value)} placeholder="Name" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                      <input value={d.payee?.tin || ''} onChange={e => setField2307('payee.tin', e.target.value)} placeholder="TIN" className="w-full px-2 py-1 border border-gray-200 rounded text-xs font-mono" />
                      <input value={d.payee?.address || ''} onChange={e => setField2307('payee.address', e.target.value)} placeholder="Address" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                      <input value={d.payee?.zip || ''} onChange={e => setField2307('payee.zip', e.target.value)} placeholder="ZIP" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                    </div>
                    <div className="border border-gray-100 rounded-lg p-2 space-y-1">
                      <p className="text-[11px] font-semibold text-gray-600">PAYOR</p>
                      <input value={d.payor?.name || ''} onChange={e => setField2307('payor.name', e.target.value)} placeholder="Name" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                      <input value={d.payor?.tin || ''} onChange={e => setField2307('payor.tin', e.target.value)} placeholder="TIN" className="w-full px-2 py-1 border border-gray-200 rounded text-xs font-mono" />
                      <input value={d.payor?.address || ''} onChange={e => setField2307('payor.address', e.target.value)} placeholder="Address" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                      <input value={d.payor?.zip || ''} onChange={e => setField2307('payor.zip', e.target.value)} placeholder="ZIP" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                      <div className="pt-1 mt-1 border-t border-gray-100">
                        <p className="text-[10px] text-gray-400 mb-1">Authorized signatory (reflects on the form)</p>
                        <input value={d.payor?.signatory || ''} onChange={e => setField2307('payor.signatory', e.target.value)} placeholder="Signatory name" className="w-full px-2 py-1 border border-gray-200 rounded text-xs mb-1" />
                        <input value={d.payor?.title || ''} onChange={e => setField2307('payor.title', e.target.value)} placeholder="Title / designation" className="w-full px-2 py-1 border border-gray-200 rounded text-xs mb-1" />
                        <input value={d.payor?.signatoryTin || ''} onChange={e => setField2307('payor.signatoryTin', e.target.value)} placeholder="Signatory TIN" className="w-full px-2 py-1 border border-gray-200 rounded text-xs font-mono" />
                      </div>
                    </div>
                  </div>

                  {/* Income payments subject to EWT — editable */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-gray-700">Income Payments Subject to Expanded Withholding Tax</p>
                      <button onClick={() => setGen2307Data(x => ({ ...x, rows: [...x.rows, { desc: '', atc: '', rate: '', m1: 0, m2: 0, m3: 0, tax: 0 }] }))}
                        className="text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">+ Row</button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-gray-400">
                          <th className="text-left font-medium p-1">Income payment (description)</th>
                          <th className="text-left font-medium p-1">ATC</th>
                          <th className="text-right font-medium p-1">1st Month</th>
                          <th className="text-right font-medium p-1">2nd Month</th>
                          <th className="text-right font-medium p-1">3rd Month</th>
                          <th className="text-right font-medium p-1">Tax withheld</th>
                          <th></th>
                        </tr></thead>
                        <tbody>
                          {d.rows.map((r, i) => {
                            const codes = atcList.map(a => a.code);
                            const opts = r.atc && !codes.includes(r.atc) ? [r.atc, ...codes] : codes;
                            return (
                            <tr key={i}>
                              <td className="p-1"><input value={r.desc || ''} onChange={e => setRow2307(i, { desc: e.target.value })} placeholder="Nature of income payment" className="w-52 px-1 py-1 border border-gray-200 rounded" /></td>
                              <td className="p-1">
                                <select value={r.atc || ''} className="w-24 px-1 py-1 border border-gray-200 rounded bg-white font-mono"
                                  onChange={e => { const code = e.target.value; const a = atcList.find(x => x.code === code); setRow2307(i, { atc: code, rate: a ? a.rate : (r.rate || ''), desc: r.desc || (a ? a.description : '') }); }}>
                                  <option value="">—</option>
                                  {opts.map(code => <option key={code} value={code}>{code}</option>)}
                                </select>
                              </td>
                              <td className="p-1"><input type="number" step="0.01" value={r.m1 ?? ''} onChange={e => setRow2307(i, { m1: e.target.value === '' ? '' : Number(e.target.value) })} className="w-24 px-1 py-1 border border-gray-200 rounded text-right" /></td>
                              <td className="p-1"><input type="number" step="0.01" value={r.m2 ?? ''} onChange={e => setRow2307(i, { m2: e.target.value === '' ? '' : Number(e.target.value) })} className="w-24 px-1 py-1 border border-gray-200 rounded text-right" /></td>
                              <td className="p-1"><input type="number" step="0.01" value={r.m3 ?? ''} onChange={e => setRow2307(i, { m3: e.target.value === '' ? '' : Number(e.target.value) })} className="w-24 px-1 py-1 border border-gray-200 rounded text-right" /></td>
                              <td className="p-1"><input type="number" step="0.01" value={r.tax ?? ''} onChange={e => setRow2307(i, { tax: e.target.value === '' ? '' : Number(e.target.value) })} className="w-24 px-1 py-1 border border-gray-200 rounded text-right" title="Auto-computes from amount × rate; editable" /></td>
                              <td className="p-1"><button onClick={() => setGen2307Data(x => ({ ...x, rows: x.rows.filter((_, idx) => idx !== i) }))} className="text-red-400 hover:text-red-600">✕</button></td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Max 10 ATC rows fit on the form. Amounts auto-total on the PDF.</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setGen2307Data(null)} className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">← Back</button>
                    <button onClick={generate2307Pdf} className="flex-1 py-2 text-white rounded-lg text-xs font-medium hover:opacity-90" style={{ backgroundColor: '#dc2626' }}>📄 Generate PDF</button>
                  </div>
                  <p className="text-[11px] text-gray-400">Fills the official BIR 2307 (Jan 2018 ENCS). Verify figures before issuing to the payee.</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ✉️ Email vendor (POP + 2307) modal — pick which PROCESSED invoices of the
          same vendor to include; one email, POP file(s) + one combined 2307. */}
      {vendorMail && (() => {
        const v = vendorRec(vendorMail.vendorName);
        const candidates = rows.filter(r => r._isLedger && ['PROCESSED','PAID'].includes(r.status) && String(r.vendorName||'').trim().toLowerCase() === String(vendorMail.vendorName||'').trim().toLowerCase());
        const toggle = (id) => setVendorMail(m => ({ ...m, ids: m.ids.includes(id) ? m.ids.filter(x => x !== id) : [...m.ids, id] }));
        const total = candidates.filter(c => vendorMail.ids.includes(c.id)).reduce((s, c) => s + Number(c.amountPhp ?? c.amount ?? 0), 0);
        const emailVal = vendorMail.email ?? (v?.email || '');
        const contactVal = vendorMail.contactPerson ?? (v?.contactPerson || '');
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !vendorMailSending && setVendorMail(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-gray-800">Email vendor — {vendorMail.vendorName}</h3>
                <button onClick={() => setVendorMail(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
              </div>
              {!v && (
                <p className="text-[11px] text-amber-600 mb-2">This vendor is not in Settings → Vendors/Payees ("others"). Type the email below — you can save it for next time.</p>
              )}
              <div className="space-y-2 mb-3">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-0.5">To — email(s), separate multiple with ";"</label>
                  <input value={emailVal} onChange={ev => setVendorMail(m => ({ ...m, email: ev.target.value }))}
                    placeholder="accounting@vendor.com; owner@vendor.com"
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-0.5">Contact person (for the "Dear ..." greeting)</label>
                  <input value={contactVal} onChange={ev => setVendorMail(m => ({ ...m, contactPerson: ev.target.value }))}
                    placeholder={vendorMail.vendorName}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-brand-400" />
                </div>
                {(!v || !v.email || (vendorMail.email !== undefined && vendorMail.email !== (v?.email || ''))) && emailVal.trim() && (
                  <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={vendorMail.saveVendor !== false}
                      onChange={ev => setVendorMail(m => ({ ...m, saveVendor: ev.target.checked }))} />
                    Save this email to Vendors/Payees for next time
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-2">Select the processed invoice(s) to include — one email with your chosen attachment(s):</p>
              <div className="flex gap-4 mb-2 text-xs text-gray-700">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={vendorMail.attachPop !== false}
                    onChange={ev => setVendorMail(m => ({ ...m, attachPop: ev.target.checked }))} />
                  Attach POP
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={vendorMail.attach2307 !== false}
                    onChange={ev => setVendorMail(m => ({ ...m, attach2307: ev.target.checked }))} />
                  Attach 2307
                </label>
              </div>
              <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 mb-3 max-h-48 overflow-y-auto">
                {candidates.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={vendorMail.ids.includes(c.id)} onChange={() => toggle(c.id)} />
                    <span className="flex-1">{c.orNumber || c.title}</span>
                    <span className="font-medium">{format(c.amountPhp ?? c.amount)}</span>
                    {!c.proofOfPayment?.id && <span className="text-[10px] text-amber-600">no POP</span>}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-600 mb-3">Total: <span className="font-semibold">{format(total)}</span> · {vendorMail.ids.length} invoice(s)</p>
              <button onClick={sendVendorMail} disabled={vendorMailSending || !vendorMail.ids.length || !emailVal.trim() || (vendorMail.attachPop === false && vendorMail.attach2307 === false)}
                className="w-full py-2.5 rounded-lg text-xs font-medium disabled:opacity-60"
                style={{ backgroundColor: 'var(--brand-color)', color: 'var(--brand-contrast,#fff)' }}>
                {vendorMailSending ? 'Sending…' : `✉️ Send ${vendorMail.attachPop !== false && vendorMail.attach2307 !== false ? 'POP + 2307' : vendorMail.attach2307 === false ? 'POP only' : '2307 only'} (${vendorMail.ids.length})`}
              </button>
              <p className="text-[11px] text-gray-400 mt-2">The email wording can be customized in Settings → Email Templates → AP & AR.</p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
