// src/pages/ExpensesPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';

const STATUS_BADGE = {
  DRAFT: 'bg-blue-50 text-blue-700',
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
  REIMBURSED: 'bg-gray-100 text-gray-600',
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const { format } = useCurrency();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const params = filter ? `?status=${filter}` : '';
      const data = await api.get(`/expenses${params}`);
      setExpenses(data.expenses || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium text-gray-900">My expenses</h1>
        <button onClick={() => navigate('/expenses/new')}
          className="px-3 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
          + Add expense
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[['', 'All'], ['DRAFT','Drafts'], ['PENDING','Pending'], ['APPROVED','Approved'], ['REJECTED','Rejected']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${filter === val ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
        ) : expenses.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No expenses found.</p>
            <button onClick={() => navigate('/expenses/new')} className="mt-2 text-sm text-brand-400 hover:text-brand-600">Add your first expense →</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Date</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Description</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Category</th>
              <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Amount</th>
              <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Status</th>
              <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(e.expenseDate).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900 font-medium">{e.title}</p>
                    {e.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{e.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell capitalize text-xs">{e.category.toLowerCase()}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{format(e.amountPhp)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[e.status]}`}>{e.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {['DRAFT','REJECTED'].includes(e.status) && (
                      <button onClick={() => navigate(`/expenses/${e.id}/edit`)}
                        className="text-xs text-brand-400 hover:text-brand-600 mr-2">Edit</button>
                    )}
                    {e.receiptUrl && (
                      <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-gray-400 hover:text-gray-600">Receipt</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
