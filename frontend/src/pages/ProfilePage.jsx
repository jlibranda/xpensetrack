// src/pages/ProfilePage.jsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

export default function ProfilePage() {
  const { user } = useAuth();
  const [info, setInfo] = useState(null);      // /auth/my-info (with manager + approver names)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });

  useEffect(() => {
    api.get('/auth/my-info').then(setInfo).catch(() => setInfo(null));
  }, []);

  const changePassword = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) { setMsg({ text: 'New passwords do not match.', ok: false }); return; }
    if (form.newPassword.length < 6) { setMsg({ text: 'Password must be at least 6 characters.', ok: false }); return; }
    setLoading(true);
    try {
      await api.patch('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setMsg({ text: '✅ Password changed successfully!', ok: true });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch(err) {
      setMsg({ text: err.error || 'Failed to change password.', ok: false });
    } finally { setLoading(false); }
  };

  const u = info || user || {};
  const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || '';
  const initials = fullName.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase() || 'U';
  const memberSince = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }) : null;

  // Label/value rows for "My information". Rows with no value are hidden.
  const rows = [
    ['Employee number', u.employeeNumber],
    ['Email', u.email],
    ['Position', u.position],
    ['Department', u.department],
    ['Cost center', u.costCenter],
    ['Payroll account', u.payrollAccount],
    ['Role', u.role],
    ['Manager / Approver', info?.managerName],
    ['Account status', u.isActive === false ? 'Deactivated' : 'Active'],
    ['Member since', memberSince],
  ].filter(([, v]) => v);

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-medium text-gray-900 mb-6">My profile</h1>

      {/* Identity card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xl font-medium">
            {initials}
          </div>
          <div>
            <p className="text-base font-medium text-gray-900">{fullName}</p>
            <p className="text-sm text-gray-500">{u.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full">{u.role}</span>
              {u.department && <span className="text-xs text-gray-400">{u.department}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* My information */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-3">My information</h2>
        <div className="divide-y divide-gray-50">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2">
              <span className="text-xs text-gray-500 shrink-0">{label}</span>
              <span className="text-sm text-gray-800 text-right break-words">{String(value)}</span>
            </div>
          ))}
        </div>
        {info?.approvalFlow?.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">My approval flow ({(u.approvalMode || 'SEQUENTIAL') === 'SEQUENTIAL' ? 'steps run in order' : 'any order'})</p>
            <div className="space-y-1.5">
              {info.approvalFlow.map(s => (
                <div key={s.step} className="flex items-start gap-2 text-sm">
                  <span className="text-xs bg-gray-100 text-gray-500 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">{s.step}</span>
                  <span className="text-gray-800">
                    {s.approvers.join(s.rule === 'ANY' ? ' or ' : ' and ')}
                    {s.approvers.length > 1 && (
                      <span className="text-xs text-gray-400"> ({s.rule === 'ANY' ? 'any one approves' : 'all must approve'})</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-4">Need something corrected? Contact your Finance Department or admin — these details are managed in the Users module.</p>
      </div>

      {/* Change password */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Change password</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Current password</label>
            <input type="password" value={form.currentPassword} onChange={e=>setForm(f=>({...f,currentPassword:e.target.value}))}
              placeholder="Your current password"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">New password</label>
            <input type="password" value={form.newPassword} onChange={e=>setForm(f=>({...f,newPassword:e.target.value}))}
              placeholder="At least 6 characters"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Confirm new password</label>
            <input type="password" value={form.confirmPassword} onChange={e=>setForm(f=>({...f,confirmPassword:e.target.value}))}
              placeholder="Repeat new password"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          {msg.text && (
            <div className={`px-3 py-2 rounded-lg text-sm border ${msg.ok ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
              {msg.text}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60">
            {loading ? 'Changing...' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}
