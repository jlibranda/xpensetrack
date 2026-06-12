// src/pages/EmployeePage.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import ReceiptImage from '../components/ReceiptImage';

const STATUS_BADGE = {
  DRAFT:'bg-blue-600 text-white', 
  PENDING:'bg-amber-500 text-white',
  APPROVED:'bg-green-600 text-white', 
  REJECTED:'bg-red-600 text-white',
  REIMBURSED:'bg-gray-600 text-white', 
  CANCELLED:'bg-gray-400 text-white',
};
const ROLE_BADGE = {
  EMPLOYEE:'bg-blue-600 text-white', 
  MANAGER:'bg-purple-600 text-white',
  FINANCE:'bg-amber-500 text-white', 
  ADMIN:'bg-green-600 text-white',
};

export default function EmployeePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('info');
  const { format } = useCurrency();

  useEffect(() => {
    Promise.all([
      api.get(`/users/${id}`),
      api.get(`/expenses?limit=50`),
    ]).then(([u, exp]) => {
      setUser(u);
      setExpenses((exp.expenses || []).filter(e => e.submittedById === id));
    }).catch(() => navigate('/users'))
    .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Loading...</div>;
  if (!user) return null;

  const initials = `${user.firstName?.[0]||''}${user.lastName?.[0]||''}`.toUpperCase();
  const totalSpent = expenses.filter(e=>['APPROVED','REIMBURSED'].includes(e.status)).reduce((s,e)=>s+e.amountPhp,0);
  const pendingCount = expenses.filter(e=>e.status==='PENDING').length;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <button onClick={() => navigate('/users')} className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 mb-3 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 shadow-sm">← Back to users</button>
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-bold shrink-0"
            style={{background:'linear-gradient(135deg,#1D9E75,#0F6E56)'}}>
            {initials}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-medium text-gray-900">{user.lastName}, {user.firstName}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[user.role]}`}>{user.role}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${user.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {user.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{user.email}</p>
            {user.employeeNumber && <p className="text-xs text-gray-400 mt-0.5">Employee #{user.employeeNumber}</p>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-medium text-gray-900">{expenses.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total expenses</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-medium text-gray-900">{format(totalSpent)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total approved</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-medium text-amber-600">{pendingCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Pending approval</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[['info','Employee Info'],['expenses','Expense History']].map(([val, label]) => (
          <button key={val} onClick={() => setTab(val)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${tab===val ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
            {[
              ['Employee Number', user.employeeNumber || '—'],
              ['Last Name', user.lastName || '—'],
              ['First Name', user.firstName || '—'],
              ['Email', user.email],
              ['Role', user.role],
              ['Department', user.department || '—'],
              ['Position', user.position || '—'],
              ['Cost Center', user.costCenter || '—'],
              ['Payroll Account', user.payrollAccount || '—'],
              ['Manager/Approver', user.manager ? `${user.manager.lastName}, ${user.manager.firstName}` : '—'],
              ['Total Expenses', user._count?.expenses || 0],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                <p className="text-gray-900 font-medium">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-gray-50">
            <p className="text-xs text-gray-400 mb-2">Approval flow</p>
            {(user.approvers && user.approvers.length > 0) ? (
              <>
                <div className="flex flex-wrap gap-2 mb-2">
                  {user.approvers.map((a, i) => (
                    <span key={a.id} className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg"
                      style={{ backgroundColor: 'rgba(29,158,117,0.15)', border: '1px solid rgba(29,158,117,0.45)' }}>
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white shrink-0" style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>{i + 1}</span>
                      <span className="approver-name font-bold">{a.firstName} {a.lastName}</span>
                      <span className="approver-meta text-xs">({a.role}{a.employeeNumber ? ` · ${a.employeeNumber}` : ''})</span>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  Order: <span className="font-medium text-gray-700">{user.approvalMode === 'ANY_ORDER' ? 'Any order' : 'Sequential'}</span>
                  {'  ·  '}
                  Completion: <span className="font-medium text-gray-700">{user.approvalRule === 'ANY' ? 'Any one is enough' : 'All must approve'}</span>
                </p>
              </>
            ) : (
              <p className="text-sm text-amber-600">No approver assigned — this employee cannot submit expenses until an approver is set.</p>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-50 flex gap-2">
            <button onClick={() => navigate('/users', { state: { editUserId: id } })}
              className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
              Edit employee
            </button>
          </div>
        </div>
      )}

      {tab === 'expenses' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {expenses.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No expenses yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Date</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Description</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Category</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Amount</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(e.expenseDate).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</td>
                    <td className="px-4 py-3 text-gray-900">{e.title}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell capitalize">{e.category?.toLowerCase()}</td>
                    <td className="px-4 py-3 text-right font-medium">{format(e.amountPhp)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[e.status]}`}>{e.status}</span>
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
