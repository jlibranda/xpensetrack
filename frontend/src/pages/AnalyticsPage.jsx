// src/pages/AnalyticsPage.jsx
import { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { useOrg } from '../context/OrgContext';

const COLORS = ['#1D9E75','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316'];

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [activeRange, setActiveRange] = useState('month'); // default: this month
  const [source, setSource] = useState('expense'); // 'expense' | 'ledger'
  const { format } = useCurrency();
  const { settings } = useOrg();
  const brandColor = settings?.primaryColor || '#1D9E75';

  // Initialise to "this month" on first mount.
  useEffect(() => { setQuickRange('month'); /* eslint-disable-next-line */ }, []);
  // Reload when the source toggles (keeps current date range).
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [source]);

  const load = async (f = from, t = to) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f) params.append('from', f);
      if (t) params.append('to', t);
      if (source === 'ledger') {
        const rows = await api.get(`/ledger?${params}`);
        setData({ ledger: Array.isArray(rows) ? rows : [] });
      } else {
        const [summary, expenses] = await Promise.all([
          api.get(`/reports/summary?${params}`),
          api.get(`/expenses?limit=1000`),
        ]);
        setData({ summary, expenses: expenses.expenses || [] });
      }
    } catch { setData(source === 'ledger' ? { ledger: [] } : { summary: {}, expenses: [] }); }
    finally { setLoading(false); }
  };

  // Quick-range presets (same behaviour as the Reports module).
  const setQuickRange = (mode) => {
    if (mode === 'all') { setFrom(''); setTo(''); setActiveRange('all'); load('', ''); return; }
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let end = new Date();
    let start;
    if (mode === 'week') {
      start = new Date(); start.setDate(start.getDate() - start.getDay());
      end = new Date(start); end.setDate(start.getDate() + 6);
    } else if (mode === 'month') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (mode === 'quarter') {
      start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
    } else if (mode === 'year') {
      start = new Date(end.getFullYear(), 0, 1);
    } else { // number of months back
      start = new Date(); start.setMonth(start.getMonth() - mode + 1); start.setDate(1);
    }
    const f = ymd(start), t = ymd(end);
    setFrom(f); setTo(t); setActiveRange(mode); load(f, t);
  };

  const { summary = {}, expenses = [] } = data || {};

  // Proper-case multi-word labels (e.g. "OFFICE SUPPLIES" -> "Office Supplies").
  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  // Category breakdown
  const categoryData = summary?.byCategory
    ? Object.entries(summary.byCategory).map(([name, value]) => ({ name: titleCase(name), value: Math.round(value) })).sort((a,b)=>b.value-a.value)
    : [];

  // Employee spending
  const employeeData = summary?.byEmployee
    ? Object.entries(summary?.byEmployee || {}).map(([name, value]) => ({ name: name?.split(' ')?.[0] || name, value: Math.round(value || 0) })).sort((a,b)=>b.value-a.value).slice(0,8)
    : [];

  // Monthly trend — last 6 calendar months ending this month, in chronological
  // order, zero-filled. Counts only APPROVED/PROCESSED (actual spend).
  const trendNow = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(trendNow.getFullYear(), trendNow.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }),
      value: 0,
    });
  }
  const monthIndex = Object.fromEntries(months.map((m, idx) => [m.key, idx]));
  expenses.forEach(e => {
    if (!['APPROVED', 'PROCESSED'].includes(e.status)) return;
    const d = new Date(e.expenseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (key in monthIndex) months[monthIndex[key]].value += e.amountPhp;
  });
  const monthlyData = months.map(m => ({ month: m.label, value: Math.round(m.value) }));
  const hasMonthly = monthlyData.some(m => m.value > 0);

  // Status breakdown
  const statusMap = {};
  expenses.forEach(e => { statusMap[e.status] = (statusMap[e.status]||0) + 1; });
  const statusData = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

  // Department breakdown
  const deptMap = {};
  expenses.filter(e => ['APPROVED','PROCESSED'].includes(e.status)).forEach(e => {
    const d = e.submittedBy?.department || 'Unknown';
    deptMap[d] = (deptMap[d]||0) + e.amountPhp;
  });
  const deptData = Object.entries(deptMap).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a,b)=>b.value-a.value);
  const deptTotal = deptData.reduce((s,d)=>s+d.value, 0) || 1;

  const totalApproved = summary?.totalPhp || 0;
  const avgExpense = summary?.count > 0 ? totalApproved / summary.count : 0;

  // ---------- AP/AR analytics (computed from the ledger rows) ----------
  const ledgerRows = data?.ledger || [];
  const lActive = ledgerRows.filter(d => ['APPROVED', 'PROCESSED'].includes(d.status));
  const apRows = ledgerRows.filter(d => d.docType !== 'AR_INVOICE');
  const arRows = ledgerRows.filter(d => d.docType === 'AR_INVOICE');
  const apTotal = apRows.filter(d => ['APPROVED', 'PROCESSED'].includes(d.status)).reduce((s, d) => s + (d.amountPhp || 0), 0);
  const arTotal = arRows.filter(d => ['APPROVED', 'PROCESSED'].includes(d.status)).reduce((s, d) => s + (d.amountPhp || 0), 0);
  const lActiveTotal = lActive.reduce((s, d) => s + (d.amountPhp || 0), 0);
  const lPending = ledgerRows.filter(d => d.status === 'PENDING').length;

  const lNow = new Date();
  const lMonths = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(lNow.getFullYear(), lNow.getMonth() - i, 1);
    lMonths.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }), value: 0 });
  }
  const lIdx = Object.fromEntries(lMonths.map((m, i) => [m.key, i]));
  lActive.forEach(d => { const dt = new Date(d.docDate); const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; if (key in lIdx) lMonths[lIdx[key]].value += (d.amountPhp || 0); });
  const ledgerMonthly = lMonths.map(m => ({ month: m.label, value: Math.round(m.value) }));
  const hasLedgerMonthly = ledgerMonthly.some(m => m.value > 0);

  const lCatMap = {};
  lActive.forEach(d => { const c = titleCase(d.category || 'Uncategorized'); lCatMap[c] = (lCatMap[c] || 0) + (d.amountPhp || 0); });
  const ledgerCategory = Object.entries(lCatMap).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);

  const lVenMap = {};
  lActive.forEach(d => { const v = d.vendorName || '—'; lVenMap[v] = (lVenMap[v] || 0) + (d.amountPhp || 0); });
  const ledgerVendors = Object.entries(lVenMap).map(([name, value]) => ({ name: name.length > 14 ? name.slice(0, 13) + '…' : name, value: Math.round(value) })).sort((a, b) => b.value - a.value).slice(0, 8);

  const apArSplit = [{ name: 'AP (payables)', value: Math.round(apTotal) }, { name: 'AR (receivables)', value: Math.round(arTotal) }].filter(x => x.value > 0);

  const ledgerBody = (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Approved / processed', value: format(lActiveTotal), sub: `${ledgerRows.length} invoice(s)` },
          { label: 'Pending', value: lPending, sub: 'awaiting approval' },
          { label: 'Payables (AP)', value: format(apTotal), sub: `${apRows.length} invoice(s)` },
          { label: 'Receivables (AR)', value: format(arTotal), sub: `${arRows.length} invoice(s)` },
        ].map((k, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-medium text-gray-900">{k.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Monthly AP/AR trend</h2>
          {hasLedgerMonthly ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={ledgerMonthly}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => format(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                <Line type="monotone" dataKey="value" stroke={brandColor} strokeWidth={2} dot={{ fill: brandColor }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">AP vs AR</h2>
          {apArSplit.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={apArSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {apArSplit.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => format(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Top vendors / payees</h2>
          {ledgerVendors.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ledgerVendors} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={v => format(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" fill={brandColor} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">By category</h2>
          {ledgerCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={ledgerCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {ledgerCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => format(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>
      </div>
    </>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Spending insights and trends</p>
        </div>
      </div>

      {/* Source toggle: Expenses vs AP & AR */}
      <div className="seg-group mb-4">
        {[['expense', 'Expenses'], ['ledger', 'AP & AR']].map(([val, label]) => (
          <button key={val} onClick={() => setSource(val)}
            className={`seg-btn ${source === val ? 'active' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Flexible date filter (mirrors the Reports module) */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {[['This week', 'week'], ['This month', 'month'], ['This quarter', 'quarter'], ['Last 3 months', 3], ['Last 6 months', 6], ['This year', 'year'], ['All dates', 'all']].map(([label, m]) => (
            <button key={label} onClick={() => setQuickRange(m)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${activeRange === m ? 'bg-brand-400 text-white border-brand-400 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setActiveRange(null); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setActiveRange(null); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <button onClick={() => load()} className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
            Apply
          </button>
        </div>
      </div>

      {loading ? <div className="py-16 text-center text-sm text-gray-400">Loading analytics...</div> : (
      source === 'ledger' ? ledgerBody : (<>
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total approved', value: format(totalApproved), sub: `${summary?.count||0} expenses` },
          { label: 'Pending', value: summary?.pendingCount||0, sub: 'awaiting approval', isCount: true },
          { label: 'Rejected', value: summary?.rejectedCount||0, sub: 'this period', isCount: true },
          { label: 'Avg per expense', value: format(avgExpense), sub: 'approved expenses' },
        ].map((k,i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-medium text-gray-900">{k.isCount ? k.value : k.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Monthly trend */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Monthly spending trend</h2>
          {hasMonthly ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyData}>
                <XAxis dataKey="month" tick={{fontSize:11}} axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize:11}} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => format(v)} contentStyle={{fontSize:12,borderRadius:8,border:'1px solid #e5e7eb'}} />
                <Line type="monotone" dataKey="value" stroke={brandColor} strokeWidth={2} dot={{fill:brandColor}} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>

        {/* Category pie */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">By category</h2>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({name,percent}) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => format(v)} contentStyle={{fontSize:12,borderRadius:8}} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top spenders */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Top spenders</h2>
          {employeeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={employeeData} layout="vertical" margin={{left:20}}>
                <XAxis type="number" tick={{fontSize:10}} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{fontSize:11}} axisLine={false} tickLine={false} width={60} />
                <Tooltip formatter={v => format(v)} contentStyle={{fontSize:12,borderRadius:8}} />
                <Bar dataKey="value" fill={brandColor} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>

        {/* Department breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">By department</h2>
          {deptData.length > 0 ? (
            <div className="space-y-2 mt-2">
              {deptData.map((d, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700">{d.name}</span>
                    <span className="font-medium text-gray-900">{format(d.value)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(d.value/deptTotal*100).toFixed(0)}%`, backgroundColor: COLORS[i%COLORS.length] }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data</div>}
        </div>
      </div>
      </>)
      )}
    </div>
  );
}
