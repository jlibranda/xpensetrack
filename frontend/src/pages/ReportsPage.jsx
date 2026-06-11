// src/pages/ReportsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';

export default function ReportsPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0]);
  const { format } = useCurrency();

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/reports/summary?from=${from}&to=${to}`);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const exportExcel = () => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    const token = localStorage.getItem('token');
    window.open(`${base}/reports/export?from=${from}&to=${to}&token=${token}`, '_blank');
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Expense summaries and exports</p>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
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
          <button onClick={load} className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
            Generate
          </button>
          <button onClick={exportExcel} className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5">
            ⬇ Export Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Generating report...</div>
      ) : summary ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total approved</p>
              <p className="text-2xl font-medium text-gray-900">{format(summary.totalPhp || 0)}</p>
              <p className="text-xs text-gray-400 mt-1">{summary.count} expenses</p>
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

          {/* By category */}
          {summary.byCategory && Object.keys(summary.byCategory).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-gray-50">
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
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{format(amt)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">
                        {summary.totalPhp > 0 ? ((amt/summary.totalPhp)*100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* By employee */}
          {summary.byEmployee && Object.keys(summary.byEmployee).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50">
                <h2 className="text-sm font-medium text-gray-700">By employee</h2>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-medium">Employee</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Amount</th>
                </tr></thead>
                <tbody>
                  {Object.entries(summary.byEmployee).sort((a,b)=>b[1]-a[1]).map(([name, amt]) => (
                    <tr key={name} className="border-t border-gray-50">
                      <td className="px-4 py-3 text-gray-900">{name}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{format(amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">Select a date range and click Generate.</div>
      )}
    </div>
  );
}
