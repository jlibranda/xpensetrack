// src/pages/ReportsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

export default function ReportsPage() {
  const [summary, setSummary] = useState(null);
  const [aging, setAging] = useState(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const now = new Date();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [source, setSource] = useState('expense'); // 'expense' | 'ledger'
  const [ledgerRows, setLedgerRows] = useState([]);
  const [activeRange, setActiveRange] = useState('all'); // 'all' = no date filter (default)
  const [userId, setUserId] = useState('');
  const { format } = useCurrency();
  const { settings } = useOrg();
  const { user } = useAuth();
  const canExport = user?.role === 'ADMIN' ||
    (settings?.accessControl?.export_reports || ['MANAGER','FINANCE','ADMIN']).includes(user?.role);
  const glCodes = settings?.categoryGlCodes || {};
  const glNorm = Object.fromEntries(Object.entries(glCodes).map(([k, v]) => [String(k).trim().toUpperCase(), v]));
  const glFor = (cat) => glNorm[String(cat || '').trim().toUpperCase()] || '—';

  useEffect(() => {
    api.get('/users').then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [source]);

  const load = async (f = from, t = to) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f) params.append('from', f);
      if (t) params.append('to', t);
      if (source === 'ledger') {
        const d = await api.get(`/ledger?${params}`);
        setLedgerRows(Array.isArray(d) ? d : []);
        setLoading(false);
        return;
      }
      if (userId) params.append('userId', userId);
      const data = await api.get(`/reports/summary?${params}`);
      setSummary(data);
      // Aging is company/scope-wide outstanding (not date-filtered).
      try { setAging(await api.get('/reports/aging')); } catch { setAging(null); }
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const setQuickRange = (mode) => {
    if (mode === 'all') {
      // No range = include ALL dates (nothing hidden by a date filter).
      setFrom('');
      setTo('');
      load('', '');
      return;
    }
    // Format in LOCAL time so the Sunday/Saturday boundaries aren't shifted a day by UTC.
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    let end = new Date();
    let start;
    if (mode === 'week') {
      // Current week: most recent Sunday → that week's Saturday.
      start = new Date();
      start.setDate(start.getDate() - start.getDay()); // getDay(): 0 = Sunday
      end = new Date(start);
      end.setDate(start.getDate() + 6); // Saturday
    } else if (mode === 'year') {
      start = new Date(end.getFullYear(), 0, 1); // Jan 1 of the current year
    } else {
      start = new Date();
      start.setMonth(start.getMonth() - mode + 1);
      start.setDate(1);
    }
    const f = ymd(start);
    const t = ymd(end);
    setFrom(f);
    setTo(t);
    load(f, t); // apply immediately
  };

  const exportExcel = () => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ token });
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (source === 'ledger') { window.open(`${base}/ledger/export?${params}`, '_blank'); return; }
    if (userId) params.append('userId', userId);
    window.open(`${base}/reports/export?${params}`, '_blank');
  };

  // Compact AP/AR report panel (computed from the fetched ledger rows).
  const renderLedgerReport = () => {
    const rows = ledgerRows;
    const approvedPhp = rows.filter(d => ['APPROVED','PROCESSED'].includes(d.status)).reduce((s,d)=>s+(d.amountPhp||0),0);
    const ap = rows.filter(d => d.docType !== 'AR_INVOICE');
    const ar = rows.filter(d => d.docType === 'AR_INVOICE');
    const card = (label, value, sub) => (
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
        <p className="text-2xl font-medium text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    );
    return (
      <div className="grid grid-cols-2 gap-3 mb-4">
        {card('Approved / processed', format(approvedPhp), `${rows.length} invoice(s)`)}
        {card('Pending', rows.filter(d=>d.status==='PENDING').length, 'awaiting approval')}
        {card('AP (payables)', ap.length, format(ap.reduce((s,d)=>s+(d.amountPhp||0),0)))}
        {card('AR (receivables)', ar.length, format(ar.reduce((s,d)=>s+(d.amountPhp||0),0)))}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Summaries and exports</p>
        <div className="seg-group mt-3">
          <button onClick={() => setSource('expense')}
            className={`seg-btn ${source === 'expense' ? 'active' : ''}`}>
            Expenses
          </button>
          <button onClick={() => setSource('ledger')}
            className={`seg-btn ${source === 'ledger' ? 'active' : ''}`}>
            AP &amp; AR
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {[['This week', 'week'], ['This month', 1], ['Last 3 months', 3], ['Last 6 months', 6], ['This year', 'year'], ['All dates', 'all']].map(([label, m]) => {
            const active = activeRange === m;
            return (
              <button key={label} onClick={() => {
                  if (m !== 'all' && activeRange === m) { setQuickRange('all'); setActiveRange('all'); } // toggle off -> all dates
                  else { setQuickRange(m); setActiveRange(m); }
                }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${active ? 'bg-brand-400 text-white border-brand-400 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            );
          })}
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
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employee</label>
            <select value={userId} onChange={e => setUserId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
              <option value="">All employees</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button onClick={() => load()} className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
            Generate
          </button>
          {canExport && (
            <button onClick={exportExcel}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5">
              ⬇ Export Excel
            </button>
          )}
        </div>
      </div>

      {source === 'ledger' ? (
        loading ? <div className="py-12 text-center text-sm text-gray-400">Generating report...</div> : renderLedgerReport()
      ) : loading ? (
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
                  <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-medium">GL Code</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Share</th>
                </tr></thead>
                <tbody>
                  {Object.entries(summary.byCategory).sort((a,b)=>b[1]-a[1]).map(([cat, amt]) => (
                    <tr key={cat} className="border-t border-gray-50">
                      <td className="px-4 py-3 text-gray-900 capitalize">{cat.toLowerCase()}</td>
                      <td className="px-4 py-3 text-gray-500">{glFor(cat)}</td>
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

          {/* By cost center */}
          {summary.byCostCenter && Object.keys(summary.byCostCenter).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-gray-50">
                <h2 className="text-sm font-medium text-gray-700">By cost center</h2>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-medium">Cost Center</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right text-xs text-gray-500 font-medium">Share</th>
                </tr></thead>
                <tbody>
                  {Object.entries(summary.byCostCenter).sort((a,b)=>b[1]-a[1]).map(([cc, amt]) => (
                    <tr key={cc} className="border-t border-gray-50">
                      <td className="px-4 py-3 text-gray-900">{cc}</td>
                      <td className="px-4 py-3 text-right font-medium">{format(amt)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">{summary.totalPhp>0?((amt/summary.totalPhp)*100).toFixed(1):0}%</td>
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

          {/* Aging / outstanding */}
          {aging && (
            <div className="mt-6">
              <h2 className="text-sm font-medium text-gray-700 mb-2">Aging / outstanding</h2>
              <p className="text-xs text-gray-400 mb-3">Current outstanding items by age (not limited to the date range above).</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AgingCard title="Pending approval" subtitle="aged from date submitted" data={aging.pending} format={format} />
                <AgingCard title="Approved, not yet paid" subtitle="aged from approval date" data={aging.approvedUnpaid} format={format} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">Select a date range and click Generate.</div>
      )}
    </div>
  );
}

const BUCKET_COLOR = {
  '0-7': 'text-gray-700',
  '8-14': 'text-amber-600',
  '15-30': 'text-orange-600',
  '30+': 'text-red-600',
};

function AgingCard({ title, subtitle, data, format }) {
  const buckets = data?.buckets || {};
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700">{title}</h3>
          <p className="text-[11px] text-gray-400">{subtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-gray-900">{format(data?.total || 0)}</p>
          <p className="text-[11px] text-gray-400">{data?.count || 0} items</p>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="bg-gray-50">
          <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Age (days)</th>
          <th className="px-4 py-2 text-right text-xs text-gray-500 font-medium">Items</th>
          <th className="px-4 py-2 text-right text-xs text-gray-500 font-medium">Amount</th>
        </tr></thead>
        <tbody>
          {['0-7','8-14','15-30','30+'].map(b => (
            <tr key={b} className="border-t border-gray-50">
              <td className={`px-4 py-2.5 font-medium ${BUCKET_COLOR[b]}`}>{b}</td>
              <td className="px-4 py-2.5 text-right text-gray-600">{buckets[b]?.count || 0}</td>
              <td className="px-4 py-2.5 text-right font-medium">{format(buckets[b]?.amount || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
