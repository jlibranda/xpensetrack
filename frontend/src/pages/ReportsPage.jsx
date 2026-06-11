// src/pages/ReportsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

export default function ReportsPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const now = new Date();
  const [from, setFrom] = useState(() => {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(() => now.toISOString().split('T')[0]);
  const [userId, setUserId] = useState('');
  const { format } = useCurrency();

  useEffect(() => {
    api.get('/users').then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {});
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (userId) params.append('userId', userId);
      const data = await api.get(`/reports/summary?${params}`);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const setQuickRange = (months) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months + 1);
    start.setDate(1);
    setFrom(start.toISOString().split('T')[0]);
    setTo(end.toISOString().split('T')[0]);
  };

  const exportExcel = () => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ from, to, token });
    if (userId) params.append('userId', userId);
    window.open(`${base}/reports/export?${params}`, '_blank');
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Expense summaries and exports</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {[['This month', 1], ['Last 3 months', 3], ['Last 6 months', 6], ['This year', 12]].map(([label, m]) => (
            <button key={label} onClick={() => setQuickRange(m)}
              className="px-3 py-1 border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-gray-50">
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employee</label>
            <select value={userId} onChange={e => setUserId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              <option value="">All employees</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button onClick={load} className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
            Generate
          </button>
          <button onClick={exportExcel}
            className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5">
            ⬇ Export Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Generating report...</div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total approved</p>
              <p className="text-2xl font-medium text-gray-900">{format(summary.totalPhp || 0)}</p>
              <p className="text-xs text-gray-400 mt-1">{summary.count || 0} expenses</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Top category</p>
              <p className="text-2xl font-medium text-gray-900 capitalize">
                {summary.byCategory && Object.keys(summary.byCategory).length > 0
                  ? Object.entries(summary.byCategory).sort((a,b)=>b[1]-a[1])[0][0].toLowerCase()
                  : '—'}
              </p>
            </div>
          </div>

          {summary.byCategory && Object.keys(summary.byCategory).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-700">By category</h2>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-medium">Category</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Share</th>
                </tr></thead>
                <tbody>
                  {Object.entries(summary.byCategory).sort((a,b)=>b[1]-a[1]).map(([cat, amt]) => (
                    <tr key={cat} className="border-t border-gray-50">
                      <td className="px-4 py-3 text-gray-900 capitalize">{cat.toLowerCase()}</td>
                      <td className="px-4 py-3 text-right font-medium">{format(amt)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">
                        {summary.totalPhp > 0 ? ((amt/summary.totalPhp)*100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summary.byEmployee && Object.keys(summary.byEmployee).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50">
                <h2 className="text-sm font-medium text-gray-700">By employee</h2>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-medium">Employee</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Share</th>
                </tr></thead>
                <tbody>
                  {Object.entries(summary.byEmployee).sort((a,b)=>b[1]-a[1]).map(([name, amt]) => (
                    <tr key={name} className="border-t border-gray-50">
                      <td className="px-4 py-3 text-gray-900">{name}</td>
                      <td className="px-4 py-3 text-right font-medium">{format(amt)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">
                        {summary.totalPhp > 0 ? ((amt/summary.totalPhp)*100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summary.count === 0 && (
            <div className="py-12 text-center bg-white rounded-xl border border-gray-100">
              <p className="text-gray-400 text-sm">No approved expenses found for this period.</p>
            </div>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">Select a date range and click Generate.</div>
      )}
    </div>
  );
}
