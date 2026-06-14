// src/pages/ExpensesPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import ReceiptImage from '../components/ReceiptImage';
import { useCurrency } from '../context/CurrencyContext';
import { useAuth } from '../context/AuthContext';

const STATUS_BADGE = {
  DRAFT: 'bg-blue-50 text-blue-700',
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
  RETURNED: 'bg-amber-50 text-amber-700',
  PROCESSED: 'bg-blue-50 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

const STATUS_LABEL = {
  DRAFT: '📝 Draft',
  PENDING: '⏳ Pending',
  APPROVED: '✅ Approved',
  REJECTED: '❌ Rejected',
  RETURNED: '↩ Returned',
  PROCESSED: '💰 Processed',
  CANCELLED: '🚫 Cancelled',
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const { user } = useAuth();
  // Self / Team scope toggle (Finance & Admin also get All).
  const scopeTabs = ['FINANCE','ADMIN'].includes(user?.role)
    ? [['self','Self'],['team','Team'],['all','All']]
    : [['self','Self'],['team','Team']];
  const [scope, setScope] = useState('self');
  const [selected, setSelected] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const personName = (u) => u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || '—') : '—';
  const [actionMsg, setActionMsg] = useState('');
  const { format } = useCurrency();
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filter) qs.set('status', filter);
      qs.set('scope', scope);
      const data = await api.get(`/expenses?${qs.toString()}`);
      setExpenses(data.expenses || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter, scope]);

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
    const apps = expense.approvals || [];
    // Prefer an explicit returned/rejected note with content; ignore [auto] notes.
    const returned = apps.find(a => a.notes && a.notes.startsWith('[RETURNED]'));
    if (returned) return returned.notes.replace(/^\[RETURNED\]\s*/, '');
    const real = [...apps].reverse().find(a => a.notes && !a.notes.startsWith('[auto]'));
    return real?.notes || '';
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

      {/* Scope toggle */}
      <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-1 w-fit">
        {scopeTabs.map(([val, label]) => (
          <button key={val} onClick={() => { setScope(val); setSelected(null); }}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${scope === val ? 'text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            style={scope === val ? { backgroundColor: 'var(--brand-color,#1D9E75)' } : {}}>
            {label}
          </button>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {[['','All'],['DRAFT','Drafts'],['PENDING','Pending'],['APPROVED','Approved'],['RETURNED','Returned'],['REJECTED','Rejected'],['PROCESSED','Processed'],['CANCELLED','Cancelled']].map(([val, label]) => (
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
                  className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selected?.id === e.id ? 'border-l-4' : 'border-l-4 border-l-transparent'}`}
                  style={selected?.id === e.id ? { borderLeftColor: 'var(--brand-color,#1D9E75)', backgroundColor: 'rgba(29,158,117,0.12)' } : {}}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.merchant || e.title}</p>
                      {e.orNumber && <p className="text-xs text-gray-400">OR: {e.orNumber}</p>}
                    {scope !== 'self' && e.submittedBy && (
                      <p className="text-xs text-gray-500 mt-0.5">👤 {personName(e.submittedBy)}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(e.expenseDate).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})} · {e.category.toLowerCase()}
                    </p>
                    {['REJECTED','RETURNED','CANCELLED'].includes(e.status) && getApprovalNote(e) && (
                      <p className="text-xs mt-1 px-2 py-1 rounded-md font-medium"
                        style={e.status==='RETURNED'
                          ? { backgroundColor:'rgba(217,119,6,0.12)', color:'#b45309', border:'1px solid rgba(217,119,6,0.35)' }
                          : { backgroundColor:'rgba(220,38,38,0.10)', color:'#b91c1c', border:'1px solid rgba(220,38,38,0.30)' }}>
                        {e.status==='RETURNED' ? '↩ Returned: ' : e.status==='REJECTED' ? '✕ Rejected: ' : '🚫 '}{getApprovalNote(e)}
                      </p>
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
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Approval Trail</p>
                <div className="space-y-2">
                  {[...selected.approvals].sort((a,b)=>(a.stepOrder||a.level||0)-(b.stepOrder||b.level||0)).map((a, i) => {
                    const isApproved = a.status === 'APPROVED';
                    const isReturned = a.status === 'REJECTED' && (a.notes||'').startsWith('[RETURNED]');
                    const isRejected = a.status === 'REJECTED' && !isReturned;
                    const accent = isApproved ? '#16a34a' : isReturned ? '#d97706' : isRejected ? '#dc2626' : '#dc2626';
                    const cleanNote = (a.notes||'').startsWith('[auto]') ? '' : (a.notes||'').replace(/^\[RETURNED\]\s*/, '');
                    return (
                      <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg border"
                        style={{
                          backgroundColor: isApproved ? 'rgba(22,163,74,0.12)' : isReturned ? 'rgba(217,119,6,0.12)' : 'rgba(220,38,38,0.12)',
                          borderColor: isApproved ? 'rgba(22,163,74,0.35)' : isReturned ? 'rgba(217,119,6,0.35)' : 'rgba(220,38,38,0.35)',
                        }}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold mt-0.5 shrink-0 text-white"
                          style={{ backgroundColor: accent }}>
                          {isApproved ? '✓' : isReturned ? '↩' : isRejected ? '✗' : '⌛'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold">
                            <span className="trail-name">{personName(a.approver)}</span>
                          </p>
                          <p className="text-xs font-semibold" style={{ color: accent }}>
                            {isApproved ? 'Approved' : isReturned ? 'Returned' : isRejected ? 'Rejected' : 'Pending approval'}
                          </p>
                          {cleanNote && <p className="text-sm mt-1 font-medium" style={{ color: accent }}>"{cleanNote}"</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              {['DRAFT', 'RETURNED', 'CANCELLED'].includes(selected.status) && (
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
              {['DRAFT', 'RETURNED', 'CANCELLED'].includes(selected.status) && (
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
