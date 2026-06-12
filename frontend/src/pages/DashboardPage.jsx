// src/pages/DashboardPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';

const STATUS_BADGE = {
  DRAFT: 'bg-blue-50 text-blue-700',
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
  REIMBURSED: 'bg-gray-100 text-gray-600',
};

export default function DashboardPage() {
  const personName = (u) => u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || '—') : '—';
  // Names of approver(s) currently pending on an expense.
  const pendingApprovers = (e) => {
    if (e.status !== 'PENDING') return '';
    const names = (e.approvals || []).filter(a => a.status === 'PENDING').map(a => personName(a.approver));
    return [...new Set(names)].join(', ');
  };
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const { format } = useCurrency();
  const navigate = useNavigate();

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

    Promise.all([
      api.get('/expenses?limit=8'),
      api.get(`/reports/summary?from=${from}&to=${to}`).catch(() => null),
    ]).then(([exp, sum]) => {
      setExpenses(exp.expenses || []);
      setSummary(sum);
    }).finally(() => setLoading(false));
  }, []);

  const chartData = summary?.byCategory
    ? Object.entries(summary.byCategory).map(([name, value]) => ({ name: name.charAt(0) + name.slice(1).toLowerCase(), value }))
    : [];

  const pending = expenses.filter(e => e.status === 'PENDING').reduce((s, e) => s + e.amountPhp, 0);
  const approved = expenses.filter(e => e.status === 'APPROVED').reduce((s, e) => s + e.amountPhp, 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">This month's overview</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total this month', value: format(summary?.totalPhp || 0), sub: `${summary?.count || 0} expenses` },
          { label: 'Pending approval', value: format(pending), sub: `${expenses.filter(e=>e.status==='PENDING').length} claims`, accent: 'text-amber-600' },
          { label: 'Approved', value: format(approved), sub: `${expenses.filter(e=>e.status==='APPROVED').length} claims`, accent: 'text-green-600' },
          { label: 'Reimbursed', value: format(expenses.filter(e=>e.status==='REIMBURSED').reduce((s,e)=>s+e.amountPhp,0)), sub: `${expenses.filter(e=>e.status==='REIMBURSED').length} claims` },
        ].map((m, i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-600 font-medium uppercase tracking-wide mb-1">{m.label}</p>
            <p className={`text-xl font-medium ${m.accent || 'text-gray-900'}`}>{loading ? '—' : m.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Spending by category</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => format(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '0.5px solid #e5e7eb' }} />
                <Bar dataKey="value" fill="#1D9E75" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-sm text-gray-400">No data yet</div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Quick actions</h2>
          <div className="space-y-2">
            {[
              { label: 'Add a new expense', sub: 'Scan receipt or enter manually', action: () => navigate('/expenses/new'), icon: '+' },
              { label: 'View all expenses', sub: 'Your expense history', action: () => navigate('/expenses'), icon: '🧾' },
              { label: 'Download report', sub: 'Export this month to Excel', action: () => window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/reports/export`, '_blank'), icon: '⬇' },
            ].map((a, i) => (
              <button key={i} onClick={a.action}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 text-sm shrink-0">{a.icon}</div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{a.label}</p>
                  <p className="text-xs text-gray-400">{a.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recent expenses */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Recent expenses</h2>
          <button onClick={() => navigate('/expenses')} className="text-xs text-brand-400 hover:text-brand-600">View all →</button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading...</div>
        ) : expenses.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-400">No expenses yet.</p>
            <button onClick={() => navigate('/expenses/new')} className="mt-2 text-sm text-brand-400 hover:text-brand-600">Add your first expense →</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50">
              <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium font-medium">Description</th>
              <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium font-medium hidden md:table-cell">Category</th>
              <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium font-medium hidden md:table-cell">Employee</th>
              <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium font-medium hidden lg:table-cell">Pending With</th>
              <th className="px-4 py-2.5 text-right text-xs text-gray-600 font-medium font-medium">Amount</th>
              <th className="px-4 py-2.5 text-right text-xs text-gray-600 font-medium font-medium">Status</th>
            </tr></thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} onClick={() => navigate('/expenses')}
                  className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-gray-900">{e.title}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell capitalize">{e.category.toLowerCase()}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{personName(e.submittedBy)}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {pendingApprovers(e)
                      ? <span className="text-amber-600 text-xs font-medium">{pendingApprovers(e)}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{format(e.amountPhp)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[e.status]}`}>{e.status}</span>
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
