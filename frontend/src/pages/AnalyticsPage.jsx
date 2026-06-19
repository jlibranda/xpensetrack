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
  const [range, setRange] = useState('month');
  const { format } = useCurrency();
  const { settings } = useOrg();
  const brandColor = settings?.primaryColor || '#1D9E75';

  useEffect(() => { load(); }, [range]);

  const load = async () => {
    setLoading(true);
    try {
      const now = new Date();
      let from;
      if (range === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
      else if (range === 'quarter') from = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1);
      else from = new Date(now.getFullYear(), 0, 1);

      const [summary, expenses] = await Promise.all([
        api.get(`/reports/summary?from=${from.toISOString().split('T')[0]}&to=${now.toISOString().split('T')[0]}`),
        api.get(`/expenses?limit=1000`),
      ]);
      setData({ summary, expenses: expenses.expenses || [] });
    } finally { setLoading(false); }
  };

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Loading analytics...</div>;

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

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Spending insights and trends</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[['month','This month'],['quarter','This quarter'],['year','This year']].map(([val, label]) => (
            <button key={val} onClick={() => setRange(val)}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors ${range===val ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

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
    </div>
  );
}
