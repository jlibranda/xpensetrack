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
    setScanning(true); setError('');
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      const res = await api.post('/ocr/scan', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setReceiptUrl(res.receiptUrl);
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
      setError('Receipt scan failed. Please fill in the form manually.');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (action) => {
    if (!form.title || !form.amount || !form.expenseDate) {
      setError('Title, amount, and date are required.'); return;
    }
    setSubmitting(true); setError('');
    try {
      const expense = await api.post('/expenses', { ...form, receiptUrl });
      if (action === 'submit') {
        await api.post(`/expenses/${expense.id}/submit`);
        setSuccess('Expense submitted for approval!');
      } else {
        setSuccess('Draft saved!');
      }
      setTimeout(() => navigate('/expenses'), 1500);
    } catch (err) {
      setError(err.error || 'Failed to save expense.');
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
        <h2 className="text-sm font-medium text-gray-700 mb-3">Receipt</h2>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScan} />
        {receiptUrl ? (
          <div className="flex items-center gap-3">
            <img src={receiptUrl} alt="Receipt" className="w-16 h-16 object-cover rounded-lg border border-gray-100" />
            <div>
              <p className="text-sm text-green-700 font-medium">Receipt scanned ✓</p>
              <button onClick={() => { setReceiptUrl(''); fileRef.current.value = ''; }} className="text-xs text-gray-400 hover:text-gray-600 mt-1">Remove</button>
            </div>
          </div>
        ) : (
          <button onClick={() => fileRef.current.click()} disabled={scanning}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 text-center hover:border-brand-400 hover:bg-brand-50 transition-colors">
            {scanning ? (
              <p className="text-sm text-brand-600 font-medium">Scanning receipt...</p>
            ) : (
              <>
                <p className="text-2xl mb-1">📷</p>
                <p className="text-sm font-medium text-gray-700">Scan or upload receipt</p>
                <p className="text-xs text-gray-400 mt-0.5">OCR auto-fills the form below</p>
              </>
            )}
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
              placeholder="0.00" min="0" step="0.01"
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
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
              placeholder="e.g. Q2 Marketing"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Notes / business purpose</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={3} placeholder="Business purpose or additional context"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 resize-none" />
          </div>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">{error}</div>}
      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">{success}</div>}

      <div className="flex gap-3">
        <button onClick={() => handleSubmit('submit')} disabled={submitting}
          className="flex-1 py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-60">
          {submitting ? 'Submitting...' : 'Submit for approval'}
        </button>
        <button onClick={() => handleSubmit('draft')} disabled={submitting}
          className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-60">
          Save draft
        </button>
      </div>
    </div>
  );
}
