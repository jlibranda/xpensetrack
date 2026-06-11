// src/pages/ApprovalsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState({});
  const { format } = useCurrency();

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/approvals/pending');
      setApprovals(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const action = async (id, type) => {
    try {
      await api.post(`/approvals/${id}/${type}`, { notes: notes[id] || '' });
      setApprovals(a => a.filter(x => x.id !== id));
    } catch (err) {
      alert(err.error || 'Action failed');
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Approvals</h1>
        <p className="text-sm text-gray-500 mt-0.5">{approvals.length} expense{approvals.length !== 1 ? 's' : ''} awaiting your review</p>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
      ) : approvals.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-gray-700 font-medium">All caught up!</p>
          <p className="text-sm text-gray-400 mt-1">No pending approvals.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map(a => {
            const e = a.expense;
            return (
              <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{e.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {e.submittedBy?.name} · {e.submittedBy?.department} · {new Date(e.expenseDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-medium text-gray-900">{format(e.amountPhp)}</p>
                    <p className="text-xs text-gray-400 capitalize">{e.category.toLowerCase()} · {e.expenseType.toLowerCase().replace('_',' ')}</p>
                  </div>
                </div>

                {e.description && (
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-3">{e.description}</p>
                )}

                {e.receiptUrl && (
                  <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-600 mb-3">
                    🧾 View receipt →
                  </a>
                )}

                <div className="border-t border-gray-50 pt-3">
                  <input
                    value={notes[a.id] || ''}
                    onChange={ev => setNotes(n => ({ ...n, [a.id]: ev.target.value }))}
                    placeholder="Add a note (optional)"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-brand-400 mb-2" />
                  <div className="flex gap-2">
                    <button onClick={() => action(a.id, 'approve')}
                      className="flex-1 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm font-medium hover:bg-green-100 transition-colors">
                      ✓ Approve
                    </button>
                    <button onClick={() => action(a.id, 'reject')}
                      className="flex-1 py-2 bg-red-50 text-red-700 border border-red-100 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors">
                      ✗ Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
