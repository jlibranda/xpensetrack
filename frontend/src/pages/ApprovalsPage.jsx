// src/pages/ApprovalsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useNotifications } from '../context/NotificationContext';
import { useCurrency } from '../context/CurrencyContext';
import ReceiptImage from '../components/ReceiptImage';

const STATUS_BADGE = {
  PENDING: 'bg-amber-500 text-white',
  APPROVED: 'bg-green-600 text-white',
  REJECTED: 'bg-red-600 text-white',
};

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [notes, setNotes] = useState({});
  const [selected, setSelected] = useState(null);
  const [actioning, setActioning] = useState(null);
  const { format } = useCurrency();
  const { load: refreshNotif } = useNotifications();

  // Build a full name from a user object (backend returns firstName/lastName).
  const personName = (u) => u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || '—') : '—';

  const load = async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([
        api.get('/approvals/pending'),
        api.get('/approvals/history'),
      ]);
      setApprovals(Array.isArray(p) ? p : []);
      setHistory(Array.isArray(h) ? h : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const action = async (id, type) => {
    if (type === 'return' && !notes[id]?.trim()) {
      alert('Please add a comment before returning to submitter.'); return;
    }
    setActioning(id + type);
    try {
      await api.post(`/approvals/${id}/${type}`, { notes: notes[id] || '' });
      setNotes(n => { const c = {...n}; delete c[id]; return c; });
      setSelected(null);
      await load();
      refreshNotif();
    } catch(err) {
      alert(err.error || 'Action failed. Please try again.');
    } finally { setActioning(null); }
  };

  const reimburse = async (expenseId) => {
    try {
      await api.post(`/approvals/${expenseId}/reimburse`);
      await load();
    } catch(err) { alert(err.error || 'Failed'); }
  };

  const hasReceipt = (expense) => expense?.receipt?.id;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Approvals</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-red-500 text-white text-sm font-bold mr-1">{approvals.length}</span>
          pending · {history.length} actioned
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => setTab('pending')}
          className={`px-4 py-1.5 rounded-md text-sm transition-colors ${tab === 'pending' ? 'bg-white font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          Pending {approvals.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full">{approvals.length}</span>
          )}
        </button>
        <button onClick={() => setTab('history')}
          className={`px-4 py-1.5 rounded-md text-sm transition-colors ${tab === 'history' ? 'bg-white font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          History
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
      ) : tab === 'pending' ? (
        approvals.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-gray-700 font-medium">All caught up!</p>
            <p className="text-sm text-gray-400 mt-1">No pending approvals.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Approval cards */}
            <div className="lg:col-span-3 space-y-3">
              {approvals.map(a => {
                const e = a.expense;
                const isSelected = selected?.id === a.id;
                return (
                  <div key={a.id}
                    onClick={() => setSelected(isSelected ? null : a)}
                    className={`bg-white rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-brand-400 ring-1 ring-brand-400' : 'border-gray-100 hover:border-gray-200'} p-4`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-sm font-medium text-gray-900 truncate">{e.merchant || e.title}</p>
                        {e.orNumber && <p className="text-xs text-gray-400">OR: {e.orNumber}</p>}
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="font-semibold text-gray-700">{personName(e.submittedBy)}</span> · {e.submittedBy?.department || 'No dept'} · {new Date(e.expenseDate).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}
                        </p>
                        {(() => {
                          const pendingApprovers = (e.approvals || []).filter(ap => ap.status === 'PENDING').map(ap => personName(ap.approver));
                          const uniq = [...new Set(pendingApprovers)];
                          return uniq.length ? (
                            <p className="text-xs text-amber-600 mt-0.5">Waiting on: <span className="font-medium">{uniq.join(', ')}</span></p>
                          ) : null;
                        })()}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium text-gray-900">{format(e.amountPhp)}</p>
                        <p className="text-xs text-gray-400 capitalize mt-0.5">{e.category?.toLowerCase()}</p>
                      </div>
                    </div>

                    {e.description && (
                      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-2 line-clamp-2">
                        {e.description}
                      </p>
                    )}

                    {hasReceipt(e) && (
                      <p className="text-xs text-brand-500 mb-2 cursor-pointer" onClick={ev => {ev.stopPropagation(); setSelected(a);}}>
                        🧾 Receipt attached — click to view
                      </p>
                    )}

                    <div onClick={ev => ev.stopPropagation()}>
                      <input
                        value={notes[a.id] || ''}
                        onChange={ev => setNotes(n => ({...n, [a.id]: ev.target.value}))}
                        placeholder="Add note (required for Return)"
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-brand-400 mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => action(a.id, 'approve')}
                          disabled={actioning === a.id + 'approve'}
                          className="flex-1 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100 disabled:opacity-50 transition-colors">
                          {actioning === a.id + 'approve' ? '...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => action(a.id, 'return')}
                          disabled={actioning === a.id + 'return'}
                          className="flex-1 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors">
                          {actioning === a.id + 'return' ? '...' : '↩ Return'}
                        </button>
                        <button
                          onClick={() => action(a.id, 'reject')}
                          disabled={actioning === a.id + 'reject'}
                          className="flex-1 py-2 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50 transition-colors">
                          {actioning === a.id + 'reject' ? '...' : '✗ Reject'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Detail panel */}
            {selected ? (
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4 h-fit sticky top-4">
                <div className="flex justify-between items-center mb-3">
                  <p className="text-sm font-medium text-gray-900">Receipt & details</p>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>

                {/* Receipt */}
                {hasReceipt(selected.expense) ? (
                  <div className="mb-4">
                    <ReceiptImage
                      receiptId={selected.expense.receipt.id}
                      className="w-full max-h-56 object-contain"
                    />
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-6 text-center mb-4">
                    <p className="text-2xl mb-1">🧾</p>
                    <p className="text-xs text-gray-400">No receipt attached</p>
                  </div>
                )}

                {/* Details */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-gray-500">Amount</span>
                    <span className="font-medium text-gray-900">{format(selected.expense.amountPhp)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-gray-500">Type</span>
                    <span className="capitalize text-gray-700">{selected.expense.expenseType?.toLowerCase().replace('_',' ')}</span>
                  </div>
                  {selected.expense.costCenter && (
                    <div className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">Cost center</span>
                      <span className="text-gray-700">{selected.expense.costCenter}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-gray-500">Submitted by</span>
                    <span className="text-gray-700">{personName(selected.expense.submittedBy)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-gray-500">Approval level</span>
                    <span className="text-gray-700">Level {selected.level}</span>
                  </div>
                </div>

                {selected.expense.status === 'APPROVED' && (
                  <button onClick={() => reimburse(selected.expense.id)}
                    className="w-full mt-4 py-2 bg-brand-400 text-white rounded-lg text-xs font-medium hover:bg-brand-600 transition-colors">
                    💰 Mark as reimbursed
                  </button>
                )}
              </div>
            ) : (
              <div className="lg:col-span-2 bg-gray-50 rounded-xl border border-gray-100 p-4 flex flex-col items-center justify-center min-h-32">
                <p className="text-xs text-gray-400 text-center">Click an expense to see receipt and details</p>
              </div>
            )}
          </div>
        )
      ) : (
        /* History tab */
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {history.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No history yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Expense</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Employee</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Amount</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Decision</th>
              </tr></thead>
              <tbody>
                {history.map(a => (
                  <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-gray-900 font-medium text-sm">{a.expense.title}</p>
                      {a.notes && <p className="text-xs text-gray-400 italic mt-0.5 max-w-xs truncate">{a.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{personName(a.expense.submittedBy)}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{format(a.expense.amountPhp)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status] || 'bg-gray-100 text-gray-600'}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
