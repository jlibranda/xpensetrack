// src/pages/DashboardPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { useAuth } from '../context/AuthContext';

const STATUS_BADGE = {
  DRAFT: 'bg-gray-500 text-white',
  PENDING: 'bg-amber-500 text-white',
  APPROVED: 'bg-green-600 text-white',
  REJECTED: 'bg-red-600 text-white',
  RETURNED: 'bg-orange-500 text-white',
  PROCESSED: 'bg-blue-600 text-white',
  REIMBURSED: 'bg-blue-600 text-white',
  CANCELLED: 'bg-gray-400 text-white',
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
  const [ledger, setLedger] = useState(null); // null = not permitted / not loaded; array = AP/AR rows
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('expense'); // 'expense' | 'ledger'
  const { format } = useCurrency();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canExport = ['MANAGER','FINANCE','ADMIN'].includes(user?.role);
  const canViewSpending = ['FINANCE','ADMIN'].includes(user?.role);

  // Scope tabs for "This month's overview":
  //  Employee/Manager: Self, Team   |   Finance: Self, Team, All   |   Admin: none (sees all)
  const role = user?.role;
  const scopeTabs = role === 'ADMIN' ? []
    : role === 'FINANCE' ? [['self','Self'],['team','Team'],['all','All']]
    : [['self','Self'],['team','Team']];
  const [scope, setScope] = useState(role === 'ADMIN' ? 'all' : 'self');
  // Detect dark mode (the app toggles a `dark` class on <html>) for chart text colors.
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const axisColor = isDark ? '#cbd5e1' : '#475569';

  // Export this month's report — must include the auth token (download opens
  // in a new tab, so it can't use the normal Authorization header).
  const exportReport = () => {
    const base = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
    const token = localStorage.getItem('token');
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];
    const params = new URLSearchParams({ from, to });
    if (token) params.set('token', token);
    window.open(`${base}/reports/export?${params.toString()}`, '_blank');
  };

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    Promise.all([
      api.get(`/expenses?limit=8&scope=${scope}`),
      api.get(`/reports/summary?from=${from}&to=${to}&scope=${scope}`).catch(() => null),
      // AP/AR for this month — silently null if the user can't view the ledger.
      api.get(`/ledger?from=${from}&to=${to}&scope=${scope}`).catch(() => null),
    ]).then(([exp, sum, led]) => {
      setExpenses(exp.expenses || []);
      setSummary(sum);
      setLedger(Array.isArray(led) ? led : null);
    }).finally(() => setLoading(false));
  }, [scope]);

  const chartData = summary?.byCategory
    ? Object.entries(summary.byCategory).map(([name, value]) => ({ name: name.charAt(0) + name.slice(1).toLowerCase(), value }))
    : [];

  const pending = expenses.filter(e => e.status === 'PENDING').reduce((s, e) => s + e.amountPhp, 0);
  const approved = expenses.filter(e => e.status === 'APPROVED').reduce((s, e) => s + e.amountPhp, 0);

  // AP/AR this-month metrics (only when the ledger was fetched successfully).
  const apArAllowed = Array.isArray(ledger);
  const apRows = (ledger || []).filter(d => d.docType !== 'AR_INVOICE');
  const arRows = (ledger || []).filter(d => d.docType === 'AR_INVOICE');
  const apActive = apRows.filter(d => ['APPROVED', 'PROCESSED'].includes(d.status)).reduce((s, d) => s + (d.amountPhp || 0), 0);
  const arActive = arRows.filter(d => ['APPROVED', 'PROCESSED'].includes(d.status)).reduce((s, d) => s + (d.amountPhp || 0), 0);
  const apArPending = (ledger || []).filter(d => d.status === 'PENDING').length;
  const apArApproved = (ledger || []).filter(d => ['APPROVED', 'PROCESSED'].includes(d.status)).reduce((s, d) => s + (d.amountPhp || 0), 0);
  // AP/AR by category (for the chart that mirrors "Spending by category").
  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const apArCatMap = {};
  (ledger || []).filter(d => ['APPROVED', 'PROCESSED'].includes(d.status)).forEach(d => {
    const c = titleCase(d.category || 'Uncategorized');
    apArCatMap[c] = (apArCatMap[c] || 0) + (d.amountPhp || 0);
  });
  const apArCatData = Object.entries(apArCatMap).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
  const canManageApAr = ['FINANCE', 'ADMIN'].includes(role);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">This month's overview</p>
        </div>
        {scopeTabs.length > 0 && (
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm divide-x divide-gray-200">
            {scopeTabs.map(([val, label]) => (
              <button key={val} onClick={() => setScope(val)}
                className="px-4 py-1.5 font-medium transition-colors"
                style={scope === val
                  ? { backgroundColor: 'var(--brand-color,#1D9E75)', color: '#fff' }
                  : { backgroundColor: 'transparent', color: isDark ? '#cbd5e1' : '#475569' }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Source toggle — keeps the dashboard clean by showing one view at a time.
          The AP & AR option only appears for users who can view the ledger. */}
      {apArAllowed && (
        <div className="flex mb-5 bg-gray-100 rounded-lg p-1 w-fit divide-x divide-gray-300">
          {[['expense', 'Expenses'], ['ledger', 'AP & AR']].map(([val, label]) => (
            <button key={val} onClick={() => setSource(val)}
              className={`px-4 py-1.5 rounded-md text-sm transition-colors ${source === val ? 'bg-white font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {source === 'expense' ? (<>
      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total this month', value: format(summary?.totalPhp || 0), sub: `${summary?.count || 0} expenses` },
          { label: 'Pending approval', value: `${summary?.pendingCount || 0}`, sub: 'claims', accent: 'text-amber-600' },
          { label: 'Approved', value: format(summary?.approvedPhp || 0), sub: `${summary?.approvedCount || 0} claims`, accent: 'text-green-600' },
          { label: 'Processed', value: format(summary?.processedPhp || 0), sub: `${summary?.processedCount || 0} claims`, accent: 'text-blue-600' },
          { label: 'Rejected', value: `${summary?.rejectedCount || 0}`, sub: 'claims', accent: 'text-red-500' },
        ].map((m, i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-600 font-medium uppercase tracking-wide mb-1">{m.label}</p>
            <p className={`text-xl font-medium ${m.accent || 'text-gray-900'}`}>{loading ? '—' : m.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Chart — spending summary is for Finance/Admin only */}
        {canViewSpending && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium mb-3" style={{ color: axisColor }}>Spending by category</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false}
                  interval={0} angle={-35} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} width={50} />
                <Tooltip formatter={(v) => format(v)}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}`, backgroundColor: isDark ? '#1e293b' : '#ffffff', color: isDark ? '#f1f5f9' : '#111827' }}
                  labelStyle={{ color: isDark ? '#f1f5f9' : '#111827' }}
                  cursor={{ fill: isDark ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="value" fill="#1D9E75" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-sm text-gray-400">No data yet</div>
          )}
        </div>
        )}

        {/* Quick actions */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Quick actions</h2>
          <div className="space-y-2">
            {[
              { label: 'Add a new expense', sub: 'Scan receipt or enter manually', action: () => navigate('/expenses/new'), icon: '+' },
              { label: 'View all expenses', sub: 'Your expense history', action: () => navigate('/expenses'), icon: '🧾' },
              ...(apArAllowed ? [{ label: 'View AP & AR', sub: 'Payables & receivables', action: () => navigate('/ap-ar'), icon: '📑' }] : []),
              ...(canExport ? [{ label: 'Download report', sub: 'Export this month to Excel', action: exportReport, icon: '⬇' }] : []),
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
              <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium font-medium hidden md:table-cell">Date Submitted</th>
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
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{new Date(e.createdAt).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})}</td>
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
      </>) : (<>
        {/* ===== AP & AR view ===== */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Payables (AP)', value: format(apActive), sub: `${apRows.length} invoice(s)`, accent: 'text-red-500' },
            { label: 'Receivables (AR)', value: format(arActive), sub: `${arRows.length} invoice(s)`, accent: 'text-green-600' },
            { label: 'Approved / processed', value: format(apArApproved), sub: `${(ledger || []).length} total`, accent: 'text-blue-600' },
            { label: 'Pending', value: `${apArPending}`, sub: 'awaiting approval', accent: 'text-amber-600' },
          ].map((m, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-600 font-medium uppercase tracking-wide mb-1">{m.label}</p>
              <p className={`text-xl font-medium ${m.accent || 'text-gray-900'}`}>{loading ? '—' : m.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* AP/AR by category — Finance/Admin only, mirrors the expense chart */}
          {canViewSpending && (
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <h2 className="text-sm font-medium mb-3" style={{ color: axisColor }}>AP / AR by category</h2>
            {apArCatData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={apArCatData} margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false}
                    interval={0} angle={-35} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip formatter={(v) => format(v)}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}`, backgroundColor: isDark ? '#1e293b' : '#ffffff', color: isDark ? '#f1f5f9' : '#111827' }}
                    labelStyle={{ color: isDark ? '#f1f5f9' : '#111827' }}
                    cursor={{ fill: isDark ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="value" fill="#1D9E75" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-gray-400">No data yet</div>
            )}
          </div>
          )}

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Quick actions</h2>
            <div className="space-y-2">
              {[
                { label: 'View AP & AR', sub: 'Payables & receivables', action: () => navigate('/ap-ar'), icon: '📑' },
                ...(canManageApAr ? [{ label: 'Record AP / AR', sub: 'Add a payable or receivable', action: () => navigate('/payables'), icon: '+' }] : []),
                ...(canManageApAr ? [{ label: 'Transactions', sub: 'Process & generate 2307', action: () => navigate('/transactions'), icon: '🧾' }] : []),
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

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Recent AP &amp; AR invoices</h2>
            <button onClick={() => navigate('/ap-ar')} className="text-xs text-brand-400 hover:text-brand-600">View all →</button>
          </div>
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Loading...</div>
          ) : (ledger || []).length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-400">No AP/AR invoices this month.</p>
              <button onClick={() => navigate('/ap-ar')} className="mt-2 text-sm text-brand-400 hover:text-brand-600">Go to AP &amp; AR →</button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50">
                <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium">Vendor / Client</th>
                <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium hidden md:table-cell">Doc #</th>
                <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium hidden md:table-cell">Date</th>
                <th className="px-4 py-2.5 text-left text-xs text-gray-600 font-medium">Type</th>
                <th className="px-4 py-2.5 text-right text-xs text-gray-600 font-medium">Amount</th>
                <th className="px-4 py-2.5 text-right text-xs text-gray-600 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {(ledger || []).slice(0, 8).map(d => (
                  <tr key={d.id} onClick={() => navigate('/ap-ar')}
                    className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 text-gray-900">{d.vendorName || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{d.docNumber || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{d.docDate ? new Date(d.docDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${d.docType === 'AR_INVOICE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {d.docType === 'AR_INVOICE' ? 'AR' : 'AP'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{format(d.amountPhp || 0)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[d.status] || 'bg-gray-400 text-white'}`}>{d.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>)}
    </div>
  );
}
