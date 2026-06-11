// src/pages/AddExpensePage.jsx
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

const CATEGORIES = ['MEALS', 'TRAVEL', 'ACCOMMODATION', 'SUPPLIES', 'COMMUNICATIONS', 'OTHER'];

export default function AddExpensePage() {
  const navigate = useNavigate();
  const fileRef = useRef();
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptPreview, setReceiptPreview] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    title: '', description: '', amount: '', currency: 'PHP',
    category: 'MEALS', expenseType: 'REIMBURSEMENT',
    expenseDate: new Date().toISOString().split('T')[0],
    costCenter: '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show local preview immediately
    setReceiptPreview(URL.createObjectURL(file));
    setScanning(true); setError('');

    try {
      const formData = new FormData();
      formData.append('receipt', file);
      const res = await api.post('/ocr/scan', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.receiptUrl) setReceiptUrl(res.receiptUrl);
      if (res.parsed) {
        setForm(f => ({
          ...f,
          title: res.parsed.title || f.title,
          amount: res.parsed.amount?.toString() || f.amount,
          currency: res.parsed.currency || f.currency,
          category: res.parsed.category || f.category,
          expenseDate: res.parsed.date || f.expenseDate,
        }));
      }
    } catch (err) {
      // OCR failed but we still have the preview — store as base64 fallback
      setError('OCR service unavailable. Receipt saved locally. Please fill in the form manually.');
      // Convert to base64 for storage fallback
      const reader = new FileReader();
      reader.onload = (ev) => setReceiptUrl(ev.target.result);
      reader.readAsDataURL(file);
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (action) => {
    if (!form.title || !form.amount || !form.expenseDate) {
      setError('Description, amount, and date are required.'); return;
    }
    if (isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError('Please enter a valid amount.'); return;
    }
    setSubmitting(true); setError('');
    try {
      const expense = await api.post('/expenses', { ...form, receiptUrl: receiptUrl || undefined });
      if (action === 'submit') {
        await api.post(`/expenses/${expense.id}/submit`);
        setSuccess('✅ Expense submitted for approval! Your manager will be notified.');
      } else {
        setSuccess('💾 Draft saved! You can submit it later from My Expenses.');
      }
      setTimeout(() => navigate('/expenses'), 2000);
    } catch (err) {
      setError(err.error || 'Failed to save expense. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-gray-600 mb-2">← Back</button>
        <h1 className="text-xl font-medium text-gray-900">Add expense</h1>
      </div>

      {/* Receipt scan */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Receipt <span className="text-xs text-gray-400 font-normal">(optional but recommended)</span></h2>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={handleScan} />
        {receiptPreview ? (
          <div className="flex items-center gap-3">
            <img src={receiptPreview} alt="Receipt preview" className="w-16 h-16 object-cover rounded-lg border border-gray-100" />
            <div>
              <p className="text-sm font-medium text-green-700">{scanning ? '🔍 Scanning receipt...' : '✓ Receipt attached'}</p>
              {scanning && <p className="text-xs text-gray-400 mt-0.5">Auto-filling form from receipt...</p>}
              <button onClick={() => { setReceiptUrl(''); setReceiptPreview(''); fileRef.current.value = ''; }}
                className="text-xs text-gray-400 hover:text-gray-600 mt-1">Remove</button>
            </div>
          </div>
        ) : (
          <button onClick={() => fileRef.current.click()} disabled={scanning}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 text-center hover:border-brand-400 hover:bg-brand-50 transition-colors">
            <p className="text-2xl mb-1">📷</p>
            <p className="text-sm font-medium text-gray-700">Scan or upload receipt</p>
            <p className="text-xs text-gray-400 mt-0.5">Photo, image file, or PDF · Auto-fills form below</p>
          </button>
        )}
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Expense details</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Description *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. Client dinner at BGC"
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
              <option value="PHP">₱ PHP — Philippine Peso</option>
              <option value="USD">$ USD — US Dollar</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date *</label>
            <input type="date" value={form.expenseDate} onChange={e => set('expenseDate', e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase().replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Expense type</label>
            <select value={form.expenseType} onChange={e => set('expenseType', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              <option value="REIMBURSEMENT">Reimbursement claim</option>
              <option value="CASH_ADVANCE">Cash advance liquidation</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cost center / project</label>
            <input value={form.costCenter} onChange={e => set('costCenter', e.target.value)}
              placeholder="e.g. Q2 Marketing, Project X"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Business purpose / notes</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Why was this expense incurred? Who was present?"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 resize-none" />
          </div>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">{error}</div>}
      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">{success}</div>}

      <div className="flex gap-3">
        <button onClick={() => handleSubmit('submit')} disabled={submitting}
          className="flex-1 py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-60">
          {submitting ? 'Submitting...' : '📤 Submit for approval'}
        </button>
        <button onClick={() => handleSubmit('draft')} disabled={submitting}
          className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-60">
          💾 Save draft
        </button>
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">Submitting will notify your manager for approval.</p>
    </div>
  );
}
