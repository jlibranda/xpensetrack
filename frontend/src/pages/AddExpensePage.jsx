// src/pages/AddExpensePage.jsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';

const CATEGORIES = ['MEALS', 'TRAVEL', 'ACCOMMODATION', 'SUPPLIES', 'COMMUNICATIONS', 'OTHER'];
const CATEGORY_ICONS = { MEALS: '🍽️', TRAVEL: '✈️', ACCOMMODATION: '🏨', SUPPLIES: '📦', COMMUNICATIONS: '📱', OTHER: '📎' };

export default function AddExpensePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const fileRef = useRef();
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptPreview, setReceiptPreview] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [aiParsing, setAiParsing] = useState(false);

  const [form, setForm] = useState({
    title: '', description: '', amount: '', currency: 'PHP',
    category: 'MEALS', expenseType: 'REIMBURSEMENT',
    expenseDate: new Date().toISOString().split('T')[0],
    costCenter: '',
  });

  useEffect(() => {
    if (id) {
      api.get(`/expenses/${id}`).then(e => {
        setForm({
          title: e.title, description: e.description || '', amount: e.amount,
          currency: e.currency, category: e.category, expenseType: e.expenseType,
          expenseDate: e.expenseDate.split('T')[0], costCenter: e.costCenter || '',
        });
        if (e.receiptUrl) { setReceiptUrl(e.receiptUrl); setReceiptPreview(e.receiptUrl); }
      }).catch(() => navigate('/expenses'));
    }
  }, [id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setReceiptPreview(preview);
    setScanning(true); setAiParsing(true); setError('');
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      const res = await api.post('/ocr/scan', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.receiptUrl) setReceiptUrl(res.receiptUrl);
      if (res.parsed) {
        setForm(f => ({
          ...f,
          title: res.parsed.title && res.parsed.title !== '' ? res.parsed.title : f.title,
          amount: res.parsed.amount?.toString() || f.amount,
          currency: res.parsed.currency || f.currency,
          category: res.parsed.category || f.category,
          expenseDate: res.parsed.date || f.expenseDate,
        }));
        if (res.parsed.title || res.parsed.amount) {
          setError('✨ AI filled in the details from your receipt. Please review and adjust if needed.');
        }
      }
    } catch (err) {
      const reader = new FileReader();
      reader.onload = (ev) => setReceiptUrl(ev.target.result);
      reader.readAsDataURL(file);
      setError('Receipt saved. AI parsing unavailable — please fill in details manually.');
    } finally { setScanning(false); setAiParsing(false); }
  };

  const handleSubmit = async (action) => {
    if (!form.title || !form.amount || !form.expenseDate) {
      setError('Description, amount, and date are required.'); return;
    }
    if (isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError('Please enter a valid amount greater than 0.'); return;
    }
    setSubmitting(true); setError('');
    try {
      let expense;
      if (id) {
        expense = await api.patch(`/expenses/${id}`, { ...form, receiptUrl: receiptUrl || null });
      } else {
        expense = await api.post('/expenses', { ...form, receiptUrl: receiptUrl || null });
      }
      if (action === 'submit') {
        await api.post(`/expenses/${expense.id}/submit`);
        setSuccess('✅ Submitted for approval! Your manager will be notified.');
      } else {
        setSuccess('💾 Draft saved! Submit when ready.');
      }
      setTimeout(() => navigate('/expenses'), 2000);
    } catch (err) {
      setError(err.error || err.message || 'Failed to save. Please try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-gray-600 mb-2 flex items-center gap-1">← Back</button>
        <h1 className="text-xl font-medium text-gray-900">{id ? 'Edit expense' : 'Add expense'}</h1>
      </div>

      {/* AI Receipt scan */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-medium text-gray-700">Receipt</h2>
          <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full">✨ AI auto-fill</span>
          <span className="text-xs text-gray-400">optional</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={handleScan} />
        {receiptPreview ? (
          <div className="flex items-center gap-3">
            <img src={receiptPreview} alt="Receipt" className="w-16 h-16 object-cover rounded-lg border border-gray-100 shrink-0" onError={e => e.target.style.display='none'} />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-700">
                {aiParsing ? '✨ AI reading receipt...' : '✓ Receipt attached'}
              </p>
              {aiParsing && <p className="text-xs text-gray-400 mt-0.5">Extracting amount, date, merchant...</p>}
              <div className="flex gap-3 mt-1">
                <button onClick={() => fileRef.current.click()} className="text-xs text-brand-400 hover:text-brand-600">Replace</button>
                <button onClick={() => { setReceiptUrl(''); setReceiptPreview(''); fileRef.current.value=''; }} className="text-xs text-gray-400 hover:text-gray-600">Remove</button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => fileRef.current.click()} disabled={scanning}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-5 text-center hover:border-brand-400 hover:bg-brand-50 transition-colors group">
            <p className="text-xl mb-1">📷</p>
            <p className="text-sm font-medium text-gray-700 group-hover:text-brand-600">Scan or upload receipt</p>
            <p className="text-xs text-gray-400 mt-0.5">AI will auto-fill the form below · Photo, image, or PDF</p>
          </button>
        )}
      </div>

      {/* Category quick select */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => set('category', c)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border transition-colors ${form.category === c ? 'bg-brand-400 text-white border-brand-400' : 'border-gray-200 text-gray-600 hover:border-brand-400'}`}>
            {CATEGORY_ICONS[c]} {c.charAt(0) + c.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Description *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. Client dinner, Grab to airport"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Amount *</label>
            <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)}
              placeholder="0.00" min="0.01" step="0.01"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Currency</label>
            <select value={form.currency} onChange={e => set('currency', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              <option value="PHP">₱ PHP</option>
              <option value="USD">$ USD</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date *</label>
            <input type="date" value={form.expenseDate} onChange={e => set('expenseDate', e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Expense type</label>
            <select value={form.expenseType} onChange={e => set('expenseType', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              <option value="REIMBURSEMENT">Reimbursement claim</option>
              <option value="CASH_ADVANCE">Cash advance liquidation</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Cost center / project</label>
            <input value={form.costCenter} onChange={e => set('costCenter', e.target.value)}
              placeholder="e.g. Q2 Marketing, Project Alpha"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Business purpose / notes</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Who was present? What was the business purpose?"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 resize-none" />
          </div>
        </div>
      </div>

      {error && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm border ${error.startsWith('✨') ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-red-50 text-red-700 border-red-100'}`}>
          {error}
        </div>
      )}
      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">{success}</div>}

      <div className="flex gap-3">
        <button onClick={() => handleSubmit('submit')} disabled={submitting}
          className="flex-1 py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60">
          {submitting ? 'Submitting...' : '📤 Submit for approval'}
        </button>
        <button onClick={() => handleSubmit('draft')} disabled={submitting}
          className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60">
          💾 Draft
        </button>
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">Your manager will be notified when you submit.</p>
    </div>
  );
}
