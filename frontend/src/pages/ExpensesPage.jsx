// src/pages/ExpensesPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import ReceiptImage from '../components/ReceiptImage';
import { useCurrency } from '../context/CurrencyContext';

const STATUS_BADGE = {
  DRAFT: 'bg-blue-50 text-blue-700',
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
  REIMBURSED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

const STATUS_LABEL = {
  DRAFT: '📝 Draft',
  PENDING: '⏳ Pending',
  APPROVED: '✅ Approved',
  REJECTED: '❌ Rejected',
  REIMBURSED: '💰 Reimbursed',
  CANCELLED: '🚫 Cancelled',
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const { format } = useCurrency();
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

  const load = async () => {
    setLoading(true);
    try {
      const params = filter ? `?status=${filter}` : '';
      const data = await api.get(`/expenses${params}`);
      setExpenses(data.expenses || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const handleCancel = async () => {
    try {
      await api.post(`/expenses/${cancelModal.id}/cancel`, { reason: cancelReason });
      setActionMsg('Expense cancelled.');
      setCancelModal(null); setCancelReason('');
      setSelected(null);
      load();
      setTimeout(() => setActionMsg(''), 3000);
    } catch (err) { setActionMsg(err.error || 'Failed to cancel.'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this expense permanently?')) return;
    try {
      await api.delete(`/expenses/${id}`);
      setSelected(null); load();
    } catch (err) { alert(err.error || 'Cannot delete this expense.'); }
  };

  const getApprovalNote = (expense) => {
    const last = expense.approvals?.[expense.approvals.length - 1];
    return last?.notes || '';
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium text-gray-900">My expenses</h1>
        <button onClick={() => navigate('/expenses/new')}
          className="px-3 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
          + Add expense
        </button>
      </div>

      {actionMsg && (
        <div className="mb-4 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">{actionMsg}</div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {[['','All'],['DRAFT','Drafts'],['PENDING','Pending'],['APPROVED','Approved'],['REJECTED','Rejected'],['REIMBURSED','Reimbursed'],['CANCELLED','Cancelled']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${filter === val ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* List */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
          ) : expenses.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">No expenses found.</p>
              <button onClick={() => navigate('/expenses/new')} className="mt-2 text-sm text-brand-400 hover:text-brand-600">Add expense →</button>
            </div>
          ) : (
            <div>
              {expenses.map(e => (
                <div key={e.id} onClick={() => setSelected(selected?.id === e.id ? null : e)}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selected?.id === e.id ? 'bg-brand-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(e.expenseDate).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})} · {e.category.toLowerCase()}
                    </p>
                    {['REJECTED','CANCELLED'].includes(e.status) && getApprovalNote(e) && (
                      <p className="text-xs text-red-500 mt-0.5 truncate">↩ {getApprovalNote(e)}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-gray-900">{format(e.amountPhp)}</p>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium mt-0.5 ${STATUS_BADGE[e.status]}`}>
                      {STATUS_LABEL[e.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected ? (
          <div className="bg-white rounded-xl border border-gray-100 p-4 h-fit">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-900">{selected.title}</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>

            <div className="space-y-2 text-xs mb-4">
              <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-medium">{format(selected.amountPhp)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span>{new Date(selected.expenseDate).toLocaleDateString('en-PH')}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Category</span><span className="capitalize">{selected.category.toLowerCase()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="capitalize">{selected.expenseType.toLowerCase().replace('_',' ')}</span></div>
              {selected.costCenter && <div className="flex justify-between"><span className="text-gray-500">Cost center</span><span>{selected.costCenter}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Status</span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
              </div>
            </div>

            {selected.description && (
              <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-600 mb-3">{selected.description}</div>
            )}

            {/* Approval trail */}
            {selected.approvals?.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1.5">Approval trail</p>
                {selected.approvals.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs mt-0.5 shrink-0 ${a.status === 'APPROVED' ? 'bg-green-100 text-green-700' : a.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {a.status === 'APPROVED' ? '✓' : a.status === 'REJECTED' ? '✗' : '…'}
                    </div>
                    <div>
                      <p className="text-xs text-gray-700">{a.approver?.name} <span className="text-gray-400">Level {a.level}</span></p>
                      {a.notes && <p className="text-xs text-gray-500 italic">{a.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

                        {/* Receipt */}
            {selected.receipt?.id && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1.5">Receipt</p>
                <ReceiptImage receiptId={selected.receipt.id} className="w-full max-h-48 object-contain" />
              </div>
            )}


            {/* Actions */}
            <div className="flex flex-col gap-2 border-t border-gray-50 pt-3">
              {['DRAFT', 'REJECTED', 'CANCELLED'].includes(selected.status) && (
                <button onClick={() => navigate(`/expenses/${selected.id}/edit`)}
                  className="w-full py-2 bg-brand-400 text-white rounded-lg text-xs font-medium hover:bg-brand-600">
                  ✏️ Edit & resubmit
                </button>
              )}
              {['DRAFT', 'PENDING'].includes(selected.status) && (
                <button onClick={() => { setCancelModal(selected); setCancelReason(''); }}
                  className="w-full py-2 border border-amber-200 text-amber-700 rounded-lg text-xs hover:bg-amber-50">
                  🚫 Cancel expense
                </button>
              )}
              {['DRAFT', 'REJECTED', 'CANCELLED'].includes(selected.status) && (
                <button onClick={() => handleDelete(selected.id)}
                  className="w-full py-2 border border-red-100 text-red-600 rounded-lg text-xs hover:bg-red-50">
                  🗑️ Delete permanently
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 flex items-center justify-center h-32">
            <p className="text-xs text-gray-400 text-center">Click an expense to see details and actions</p>
          </div>
        )}
      </div>

      {/* Cancel modal */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-md">
            <h2 className="text-sm font-medium text-gray-900 mb-1">Cancel expense</h2>
            <p className="text-xs text-gray-500 mb-3">"{cancelModal.title}" will be cancelled. You can resubmit later if needed.</p>
            <label className="block text-xs text-gray-500 mb-1">Reason (optional)</label>
            <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3}
              placeholder="Why are you cancelling this expense?"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 resize-none mb-3" />
            <div className="flex gap-2">
              <button onClick={handleCancel}
                className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600">
                Confirm cancel
              </button>
              <button onClick={() => setCancelModal(null)}
                className="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Keep expense
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
