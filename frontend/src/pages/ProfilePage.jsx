// src/pages/ProfilePage.jsx
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

export default function ProfilePage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });

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

  const initials = user?.name?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-medium text-gray-900 mb-6">My profile</h1>

      {/* Profile card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xl font-medium">
            {initials}
          </div>
          <div>
            <p className="text-base font-medium text-gray-900">{user?.name}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full">{user?.role}</span>
              {user?.department && <span className="text-xs text-gray-400">{user?.department}</span>}
            </div>
          </div>
        </div>
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
