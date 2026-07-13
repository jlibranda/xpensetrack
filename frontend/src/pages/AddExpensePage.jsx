// src/pages/AddExpensePage.jsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import toast from '../lib/toast';
import { useOrg } from '../context/OrgContext';
import ReceiptImage from '../components/ReceiptImage';
import useUnsavedChanges from '../hooks/useUnsavedChanges';

const ICONS = { MEALS:'🍽️', TRAVEL:'✈️', ACCOMMODATION:'🏨', SUPPLIES:'📦', COMMUNICATIONS:'📱', OTHER:'📎' };
const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';

export default function AddExpensePage() {
  const navigate = useNavigate();
  const { settings } = useOrg();
  const _catTypes = settings?.categoryTypes || {};
  const categories = (settings?.categories || ['MEALS','TRAVEL','ACCOMMODATION','SUPPLIES','COMMUNICATIONS','OTHER'])
    .filter(c => ['EXPENSE','BOTH'].includes(_catTypes[c] || 'BOTH'))
    .slice().sort((a, b) => String(a).localeCompare(String(b)));
  const expenseTypes = (settings?.expenseTypes || ['REIMBURSEMENT','CASH_ADVANCE'])
    .slice().sort((a, b) => String(a).localeCompare(String(b)));
  const { id } = useParams();
  const fileRef = useRef();
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptId, setReceiptId] = useState('');
  const [receiptPreview, setReceiptPreview] = useState('');
  const [receiptIsPdf, setReceiptIsPdf] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dupes, setDupes] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [dupAcknowledged, setDupAcknowledged] = useState(false);
  const [form, setForm] = useState({
    title:'', orNumber:'', merchant:'', amount:'', currency:'PHP',
    category: '',
    expenseType: expenseTypes.includes('REIMBURSEMENT') ? 'REIMBURSEMENT' : (expenseTypes[0] || 'REIMBURSEMENT'),
    expenseDate: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (id) {
      api.get(`/expenses/${id}`).then(e => {
        const loaded = {
          // Legacy expenses (created before merchant was persisted) only have the
          // name in `title`; fall back to it so the required Merchant field isn't blank.
          title: e.title, orNumber: e.orNumber||'', merchant: e.merchant || e.title || '',
          amount: e.amount, currency: e.currency, category: e.category,
          expenseType: e.expenseType, expenseDate: e.expenseDate.split('T')[0],
        };
        setForm(loaded);
        if (e.receipt?.id) {
          setReceiptId(e.receipt.id);
          const tok = localStorage.getItem('token');
          setReceiptPreview(`${API_BASE}/ocr/receipt/${e.receipt.id}?token=${encodeURIComponent(tok)}`);
        }
        initialRef.current = JSON.stringify({ form: loaded, receiptId: e.receipt?.id || '' });
      }).catch(() => navigate('/expenses'));
    }
  }, [id]);

  // Baseline for unsaved-changes detection: for a NEW expense capture the blank form once.
  const initialRef = useRef(null);
  useEffect(() => { if (!id) initialRef.current = JSON.stringify({ form, receiptId }); /* eslint-disable-next-line */ }, []);
  const dirty = initialRef.current !== null && !submitting && JSON.stringify({ form, receiptId }) !== initialRef.current;
  useUnsavedChanges(dirty);

  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  const removeReceipt = async () => {
    const idToDelete = receiptId;
    setReceiptId(''); setReceiptPreview(''); setReceiptIsPdf(false);
    if (fileRef.current) fileRef.current.value = '';
    // Clear the details that were auto-filled from the receipt.
    setForm(f => ({
      ...f,
      orNumber: '', merchant: '', amount: '', currency: 'PHP',
      category: '', title: '',
      expenseDate: new Date().toISOString().split('T')[0],
    }));
    setError('');
    // Best-effort: actually delete the uploaded image if it's not yet attached to
    // a saved expense (the backend only deletes orphans), so removed uploads don't
    // pile up in storage.
    if (idToDelete) { try { await api.delete(`/receipts/${idToDelete}`); } catch (e) { /* ignore */ } }
  };

  const handleScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setReceiptPreview(URL.createObjectURL(file));
    setReceiptIsPdf(file.type === 'application/pdf' || (file.name || '').toLowerCase().endsWith('.pdf'));
    setScanning(true); setError('');
    try {
      const fd = new FormData();
      fd.append('receipt', file);
      const res = await api.post('/ocr/scan', fd, { headers:{'Content-Type':'multipart/form-data'} });
      if (res.receiptId) {
        setReceiptId(res.receiptId);
        const token = localStorage.getItem('token');
        setReceiptPreview(`${API_BASE}/ocr/receipt/${res.receiptId}?token=${encodeURIComponent(token)}`);
      }
      if (res.parsed) {
        setForm(f => ({
          ...f,
          merchant: res.parsed.merchant || res.parsed.title || f.merchant,
          // Leave Purpose/Notes (title) for the user — don't dump the merchant text into it.
          title: f.title,
          orNumber: res.parsed.orNumber || f.orNumber,
          amount: res.parsed.amount?.toString() || f.amount,
          currency: f.currency || 'PHP',
          // Reflect the scanned category on the dropdown only if it's a valid system category.
          category: (res.parsed.category && categories.includes(res.parsed.category)) ? res.parsed.category : f.category,
          expenseDate: res.parsed.date || f.expenseDate,
        }));
        if (res.aiUsed) setError('✨ AI filled in details from your receipt (merchant, OR number, amount, date). Please review and adjust if needed.');
        else if (res.ocrConfigured === false) setError('Receipt saved. Automatic receipt reading isn\u2019t set up yet — please enter the details manually. (Ask your admin to enable it.)');
        else setError('Receipt saved, but the details couldn\u2019t be read automatically — please enter them manually.');
      }
    } catch(err) {
      setError('Receipt saved. Please fill in details manually.');
    } finally { setScanning(false); }
  };

  const handleSubmit = async (action) => {
    if (submitting) return; // guard against double-press / rapid clicks
    if (!form.merchant || !form.amount || !form.expenseDate) { setError('Merchant, amount, and date are required.'); return; }
    if (!form.category) { setError('Please select a category.'); return; }
    if (isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) { setError('Enter a valid amount.'); return; }

    setSubmitting(true); setError('');

    // Duplicate detection — warn (don't block) if a similar expense already exists.
    if (!dupAcknowledged) {
      try {
        const { duplicates } = await api.post('/expenses/check-duplicate', {
          amount: parseFloat(form.amount),
          expenseDate: form.expenseDate,
          orNumber: form.orNumber,
          merchant: form.merchant,
          excludeId: id || undefined,
        });
        if (duplicates && duplicates.length > 0) {
          setDupes(duplicates);
          setPendingAction(action);
          setSubmitting(false); // re-enable so user can choose in the modal
          return; // pause and show the warning modal
        }
      } catch (e) { /* if the check fails, don't block submission */ }
    }
    try {
      const payload = { ...form, title: form.title || form.merchant, receiptId: receiptId || null };
      let expense;
      if (id) {
        expense = await api.patch(`/expenses/${id}`, payload);
      } else {
        expense = await api.post('/expenses', payload);
      }
      if (action === 'submit') {
        await api.post(`/expenses/${expense.id}/submit`);
        setSuccess('✅ Submitted for approval!'); toast.success('Expense submitted for approval');
      } else {
        setSuccess('💾 Saved as draft!'); toast.success('Saved as draft');
      }
      setTimeout(() => navigate('/expenses'), 1800);
    } catch(err) {
      setError(err.error || err.message || 'Failed to save. Please try again.');
    } finally { setSubmitting(false); setDupes([]); setPendingAction(null); }
  };

  const brandColor = settings?.primaryColor || '#1D9E75';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-gray-600 mb-2">← Back</button>
        <h1 className="text-xl font-medium text-gray-900">{id ? 'Edit expense' : 'Add expense'}</h1>
      </div>

      {/* Receipt */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-medium text-gray-700">Receipt</h2>
          <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{backgroundColor:brandColor, color:'var(--brand-contrast,#fff)'}}>✨ AI auto-fill</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={handleScan} />
        {receiptPreview ? (
          <div className="space-y-2">
            {receiptId ? (
              <ReceiptImage receiptId={receiptId} className="w-full max-h-56 object-contain rounded-lg border border-gray-100" />
            ) : receiptIsPdf ? (
              <div onClick={() => setPdfOpen(true)}
                className="w-full h-40 rounded-lg border border-gray-100 cursor-pointer flex flex-col items-center justify-center bg-gray-50 text-gray-500">
                <span className="text-3xl">📄</span>
                <span className="text-xs mt-1 font-medium">PDF receipt — tap to view</span>
              </div>
            ) : (
              <img src={receiptPreview} alt="Receipt"
                className="w-full max-h-56 object-contain rounded-lg border border-gray-100 bg-gray-50"
                onError={e => { e.target.style.display='none'; }} />
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-green-700">{scanning ? '✨ AI reading receipt...' : '✓ Receipt attached'}</p>
              <div className="flex items-center gap-3">
                <button onClick={() => fileRef.current.click()} disabled={scanning} className="text-xs hover:underline disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: brandColor }}>Replace</button>
                <button onClick={removeReceipt} disabled={scanning} className="text-xs hover:underline disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: brandColor }}>Remove</button>
              </div>
            </div>
            {scanning && <p className="text-xs text-gray-400 animate-pulse">Extracting details...</p>}
          </div>
        ) : (
          <button onClick={() => fileRef.current.click()}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-5 text-center hover:bg-gray-50 transition-colors group">
            <p className="text-xl mb-1">📷</p>
            <p className="text-sm font-medium text-gray-700">Scan or upload receipt</p>
            <p className="text-xs text-gray-400 mt-0.5">AI fills in the form automatically</p>
          </button>
        )}
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <fieldset disabled={scanning} className={scanning ? 'opacity-50 pointer-events-none' : ''}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">OR Number</label>
              <input value={form.orNumber} onChange={e=>set('orNumber',e.target.value)} placeholder="e.g. OR-2024-001"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Merchant *</label>
              <input value={form.merchant} onChange={e=>set('merchant',e.target.value)} placeholder="e.g. Jollibee, Grab, SM"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount *</label>
              <input type="number" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="0.00" min="0.01" step="0.01"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Currency</label>
              <select value={form.currency} onChange={e=>set('currency',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="PHP">₱ PHP</option>
                <option value="USD">$ USD</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date *</label>
              <input type="date" value={form.expenseDate} onChange={e=>set('expenseDate',e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expense type</label>
              <select value={form.expenseType} onChange={e=>set('expenseType',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                {expenseTypes.map(t => (
                  <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase().replace('_',' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Category *</label>
            <select value={form.category} onChange={e=>set('category',e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              <option value="">— Select category —</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Purpose / Notes</label>
            <textarea value={form.title} onChange={e=>set('title',e.target.value)} rows={2}
              placeholder="Brief description of this expense..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 resize-none" />
          </div>
        </div>
        </fieldset>
      </div>

      {error && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm border ${error.startsWith('✨') ? 'border-green-200 bg-green-50 text-green-700' : 'bg-red-50 text-red-700 border-red-100'}`}>
          {error}
        </div>
      )}
      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">{success}</div>}

      <div className="flex gap-3">
        <button onClick={() => handleSubmit("submit")} disabled={submitting || scanning || !String(form.merchant || '').trim() || !(parseFloat(form.amount) > 0)}
          className="flex-1 py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{backgroundColor:brandColor, color:'var(--brand-contrast,#fff)'}}>
          {submitting ? 'Submitting...' : '📤 Submit for approval'}
        </button>
        <button onClick={() => handleSubmit("draft")} disabled={submitting || scanning}
          className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60">
          💾 Draft
        </button>
      </div>

      {dupes.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setDupes([]); setPendingAction(null); }}>
          <div className="bg-white rounded-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-amber-600 mb-1">⚠️ Possible duplicate</h3>
            <p className="text-sm text-gray-600 mb-3">You already have {dupes.length === 1 ? 'an expense' : 'expenses'} with the same amount and date{dupes.some(d=>d.orNumber)?' / OR number':''}:</p>
            <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
              {dupes.map(d => (
                <div key={d.id} className="text-sm border border-gray-100 rounded-lg p-2.5">
                  <div className="font-medium text-gray-800">{d.merchant || d.title}</div>
                  <div className="text-xs text-gray-500">
                    {d.currency} {Number(d.amount).toLocaleString()} · {new Date(d.expenseDate).toLocaleDateString()}
                    {d.orNumber ? ` · OR: ${d.orNumber}` : ''} · {d.status}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setDupes([]); setPendingAction(null); }}
                className="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancel & review
              </button>
              <button onClick={() => { const a = pendingAction; setDupAcknowledged(true); setDupes([]); setPendingAction(null); setTimeout(() => handleSubmit(a), 0); }}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: brandColor, color: 'var(--brand-contrast,#fff)' }}>
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Receipt zoom modal */}
      {zoomOpen && receiptPreview && !receiptIsPdf && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col"
          onClick={() => setZoomOpen(false)}>
          <div className="flex items-center justify-between p-3 text-white text-sm">
            <span>Receipt</span>
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <button onClick={() => setZoomScale(s => Math.max(1, +(s - 0.5).toFixed(1)))}
                className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-lg leading-none">−</button>
              <span className="w-12 text-center">{Math.round(zoomScale * 100)}%</span>
              <button onClick={() => setZoomScale(s => Math.min(3, +(s + 0.5).toFixed(1)))}
                className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-lg leading-none">+</button>
              <button onClick={() => setZoomOpen(false)}
                className="ml-3 px-4 h-10 rounded-lg bg-white text-gray-900 font-semibold text-sm flex items-center gap-1.5 shadow-lg hover:bg-gray-100">
                ✕ Close
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 flex items-start justify-center" onClick={e => e.stopPropagation()}>
            <img src={receiptPreview} alt="Receipt full"
              onClick={() => setZoomScale(s => (s >= 2.5 ? 1 : +(s + 0.5).toFixed(1)))}
              style={{ transform: `scale(${zoomScale})`, transformOrigin: 'top center', transition: 'transform 0.15s', cursor: zoomScale >= 2.5 ? "zoom-out" : "zoom-in" }}
              className="max-w-full max-h-[70vh] object-contain rounded-lg" />
          </div>
          <p className="text-center text-white/60 text-xs pb-3">Tap image to zoom · tap outside to close</p>
        </div>
      )}

      {/* In-app PDF viewer for uploaded PDF receipts */}
      {pdfOpen && receiptPreview && receiptIsPdf && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex flex-col" onClick={() => setPdfOpen(false)}>
          <div className="flex items-center justify-between p-3 text-white text-sm">
            <span>Receipt (PDF)</span>
            <button onClick={() => setPdfOpen(false)}
              className="px-4 h-10 rounded-lg bg-white text-gray-900 font-semibold text-sm flex items-center gap-1.5 shadow-lg hover:bg-gray-100">
              ✕ Close
            </button>
          </div>
          <div className="flex-1 px-3 pb-3" onClick={e => e.stopPropagation()}>
            <iframe src={receiptPreview} title="Receipt PDF full" className="w-full h-full rounded-lg bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
