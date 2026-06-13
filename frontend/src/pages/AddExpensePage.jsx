// src/pages/AddExpensePage.jsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import toast from '../lib/toast';
import { useOrg } from '../context/OrgContext';

const ICONS = { MEALS:'🍽️', TRAVEL:'✈️', ACCOMMODATION:'🏨', SUPPLIES:'📦', COMMUNICATIONS:'📱', OTHER:'📎' };
const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';

export default function AddExpensePage() {
  const navigate = useNavigate();
  const { settings } = useOrg();
  const categories = settings?.categories || ['MEALS','TRAVEL','ACCOMMODATION','SUPPLIES','COMMUNICATIONS','OTHER'];
  const expenseTypes = settings?.expenseTypes || ['REIMBURSEMENT','CASH_ADVANCE'];
  const { id } = useParams();
  const fileRef = useRef();
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptId, setReceiptId] = useState('');
  const [receiptPreview, setReceiptPreview] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dupes, setDupes] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [dupAcknowledged, setDupAcknowledged] = useState(false);
  const [form, setForm] = useState({
    title:'', orNumber:'', merchant:'', amount:'', currency:'PHP',
    category: categories[0] || 'MEALS',
    expenseType: expenseTypes[0] || 'REIMBURSEMENT',
    expenseDate: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (id) {
      api.get(`/expenses/${id}`).then(e => {
        setForm({
          title: e.title, orNumber: e.orNumber||'', merchant: e.merchant||'',
          amount: e.amount, currency: e.currency, category: e.category,
          expenseType: e.expenseType, expenseDate: e.expenseDate.split('T')[0],
        });
        if (e.receipt?.id) {
          setReceiptId(e.receipt.id);
          const tok = localStorage.getItem('token');
          setReceiptPreview(`${API_BASE}/ocr/receipt/${e.receipt.id}?token=${encodeURIComponent(tok)}`);
        }
      }).catch(() => navigate('/expenses'));
    }
  }, [id]);

  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  const handleScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setReceiptPreview(URL.createObjectURL(file));
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
          title: res.parsed.title || res.parsed.merchant || f.title,
          orNumber: res.parsed.orNumber || f.orNumber,
          amount: res.parsed.amount?.toString() || f.amount,
          currency: res.parsed.currency || f.currency,
          category: res.parsed.category || f.category,
          expenseDate: res.parsed.date || f.expenseDate,
        }));
        if (res.aiUsed) setError('✨ AI filled in details from your receipt (merchant, OR number, amount, date). Please review and adjust if needed.');
        else setError('Receipt saved. AI parsing not available — please fill in details manually.');
      }
    } catch(err) {
      setError('Receipt saved. Please fill in details manually.');
    } finally { setScanning(false); }
  };

  const handleSubmit = async (action) => {
    if (submitting) return; // guard against double-press / rapid clicks
    if (!form.merchant || !form.amount || !form.expenseDate) { setError('Merchant, amount, and date are required.'); return; }
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
          <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{backgroundColor:brandColor}}>✨ AI auto-fill</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={handleScan} />
        {receiptPreview ? (
          <div className="flex items-start gap-3">
            <img src={receiptPreview} alt="Receipt"
              className="w-24 h-24 object-cover rounded-lg border border-gray-200 shrink-0 cursor-pointer"
              onClick={() => window.open(receiptPreview,'_blank')}
              onError={e => { e.target.style.display='none'; }} />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-700">{scanning ? '✨ AI reading receipt...' : '✓ Receipt attached'}</p>
              {scanning && <p className="text-xs text-gray-400 mt-0.5 animate-pulse">Extracting details...</p>}
              <div className="flex gap-3 mt-2">
                <button onClick={() => fileRef.current.click()} className="text-xs text-gray-400 hover:text-gray-600">Replace</button>
                <button onClick={() => { setReceiptId(''); setReceiptPreview(''); fileRef.current.value=''; }} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            </div>
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
      </div>

      {error && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm border ${error.startsWith('✨') ? 'border-green-200 bg-green-50 text-green-700' : 'bg-red-50 text-red-700 border-red-100'}`}>
          {error}
        </div>
      )}
      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">{success}</div>}

      <div className="flex gap-3">
        <button onClick={() => handleSubmit('submit')} disabled={submitting}
          className="flex-1 py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
          style={{backgroundColor:brandColor}}>
          {submitting ? 'Submitting...' : '📤 Submit for approval'}
        </button>
        <button onClick={() => handleSubmit('draft')} disabled={submitting}
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
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: brandColor }}>
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
