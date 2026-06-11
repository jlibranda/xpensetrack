// src/pages/ApprovalsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import ReceiptImage from '../components/ReceiptImage';
import { useCurrency } from '../context/CurrencyContext';

const STATUS_BADGE = {
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
};

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [notes, setNotes] = useState({});
  const [showReturn, setShowReturn] = useState(null);
  const [selected, setSelected] = useState(null);
  const { format } = useCurrency();

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
    if (type === 'return' && !notes[id]) {
      alert('Please add a comment before returning to submitter.'); return;
    }
    try {
      await api.post(`/approvals/${id}/${type}`, { notes: notes[id] || '' });
      setNotes(n => { const copy = {...n}; delete copy[id]; return copy; });
      setShowReturn(null);
      load();
    } catch (err) { alert(err.error || 'Action failed'); }
  };

  const reimburse = async (expenseId) => {
    try {
      await api.post(`/approvals/${expenseId}/reimburse`);
      load();
    } catch (err) { alert(err.error || 'Failed'); }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Approvals</h1>
        <p className="text-sm text-gray-500 mt-0.5">{approvals.length} pending · {history.length} actioned</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => setTab('pending')}
          className={`px-4 py-1.5 rounded-md text-sm transition-colors ${tab === 'pending' ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>
          Pending {approvals.length > 0 && <span className="ml-1 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">{approvals.length}</span>}
        </button>
        <button onClick={() => setTab('history')}
          className={`px-4 py-1.5 rounded-md text-sm transition-colors ${tab === 'history' ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>
          History
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
      ) : tab === 'pending' ? (
        approvals.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-gray-700 font-medium">All caught up!</p>
            <p className="text-sm text-gray-400 mt-1">No pending approvals.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 space-y-3">
              {approvals.map(a => {
                const e = a.expense;
                return (
                  <div key={a.id} onClick={() => setSelected(selected?.id === a.id ? null : a)}
                    className={`bg-white rounded-xl border cursor-pointer transition-colors ${selected?.id === a.id ? 'border-brand-400' : 'border-gray-100 hover:border-gray-200'} p-4`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{e.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{e.submittedBy?.name} · {e.submittedBy?.department || 'No dept'} · {new Date(e.expenseDate).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">{format(e.amountPhp)}</p>
                        <p className="text-xs text-gray-400 capitalize">{e.category.toLowerCase()}</p>
                      </div>
                    </div>
                    {e.description && <p className="text-xs text-gray-500 bg-gray-50 rounded p-2 mb-2 line-clamp-2">{e.description}</p>}

                    <input value={notes[a.id] || ''} onChange={ev => setNotes(n => ({...n, [a.id]: ev.target.value}))}
                      placeholder="Add note (required for Return)" onClick={ev => ev.stopPropagation()}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-brand-400 mb-2" />

                    <div className="flex gap-2" onClick={ev => ev.stopPropagation()}>
                      <button onClick={() => action(a.id, 'approve')}
                        className="flex-1 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100">
                        ✓ Approve
                      </button>
                      <button onClick={() => action(a.id, 'return')}
                        className="flex-1 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100">
                        ↩ Return
                      </button>
                      <button onClick={() => action(a.id, 'reject')}
                        className="flex-1 py-2 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-medium hover:bg-red-100">
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4 h-fit">
                <div className="flex justify-between mb-3">
                  <p className="text-sm font-medium text-gray-900">Receipt & details</p>
                  <button onClick={() => setSelected(null)} className="text-xs text-gray-400">✕</button>
                </div>
                {selected.expense.receipt?.id ? (
                  <div className="mb-3">
                    <ReceiptImage receiptId={selected.expense.receipt.id} className="w-full max-h-64 object-contain" />
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-4 text-center text-xs text-gray-400 mb-3">No receipt attached</div>
                )}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-medium">{format(selected.expense.amountPhp)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="capitalize">{selected.expense.expenseType?.toLowerCase().replace('_',' ')}</span></div>
                  {selected.expense.costCenter && <div className="flex justify-between"><span className="text-gray-500">Cost center</span><span>{selected.expense.costCenter}</span></div>}
                  <div className="flex justify-between"><span className="text-gray-500">Level</span><span>Level {selected.level} approval</span></div>
                </div>
                {selected.expense.status === 'APPROVED' && (
                  <button onClick={() => reimburse(selected.expense.id)}
                    className="w-full mt-3 py-2 bg-brand-400 text-white rounded-lg text-xs font-medium hover:bg-brand-600">
                    💰 Mark as reimbursed
                  </button>
                )}
              </div>
            )}
          </div>
        )
      ) : (
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
                  <tr key={a.id} className="border-t border-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-gray-900 text-sm">{a.expense.title}</p>
                      {a.notes && <p className="text-xs text-gray-400 italic truncate max-w-xs">{a.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{a.expense.submittedBy?.name}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{format(a.expense.amountPhp)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status]}`}>{a.status}</span>
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
