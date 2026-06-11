// src/pages/UsersPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';

const ROLES = ['EMPLOYEE', 'MANAGER', 'FINANCE', 'ADMIN'];

const ROLE_BADGE = {
  EMPLOYEE: 'bg-blue-50 text-blue-700',
  MANAGER: 'bg-purple-50 text-purple-700',
  FINANCE: 'bg-amber-50 text-amber-700',
  ADMIN: 'bg-green-50 text-green-700',
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'EMPLOYEE',
    department: '', managerId: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/users');
      setUsers(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditUser(null);
    setForm({ name: '', email: '', password: '', role: 'EMPLOYEE', department: '', managerId: '' });
    setShowForm(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ name: u.name, email: u.email, password: '', role: u.role, department: u.department || '', managerId: u.managerId || '' });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name || !form.email) { setMsg('Name and email are required.'); return; }
    if (!editUser && !form.password) { setMsg('Password is required for new users.'); return; }
    setSaving(true); setMsg('');
    try {
      if (editUser) {
        await api.patch(`/users/${editUser.id}`, {
          role: form.role,
          department: form.department,
          managerId: form.managerId || null,
        });
        setMsg('User updated!');
      } else {
        await api.post('/auth/register', {
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          department: form.department,
        });
        setMsg('User created! They can now log in.');
      }
      await load();
      setTimeout(() => { setShowForm(false); setMsg(''); }, 1500);
    } catch (err) {
      setMsg(err.error || err.message || 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  };

  const managers = users.filter(u => ['MANAGER', 'FINANCE', 'ADMIN'].includes(u.role));

  const initials = (name) => name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">User management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Add employees, assign roles and approvers</p>
        </div>
        <button onClick={openAdd}
          className="px-3 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors">
          + Add user
        </button>
      </div>

      {/* Role guide */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { role: 'EMPLOYEE', desc: 'Can submit expenses' },
          { role: 'MANAGER', desc: 'Can approve expenses' },
          { role: 'FINANCE', desc: 'Second-level approver' },
          { role: 'ADMIN', desc: 'Full access' },
        ].map(r => (
          <div key={r.role} className="bg-gray-50 rounded-xl p-3">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[r.role]}`}>{r.role}</span>
            <p className="text-xs text-gray-500 mt-1">{r.desc}</p>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4">{editUser ? `Edit ${editUser.name}` : 'Add new user'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Full name *</label>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                disabled={!!editUser} placeholder="e.g. Maria Santos"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                disabled={!!editUser} placeholder="e.g. maria@company.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
            {!editUser && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Password *</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))}
                  placeholder="Temporary password"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role *</label>
              <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Department</label>
              <input value={form.department} onChange={e => setForm(f => ({...f, department: e.target.value}))}
                placeholder="e.g. Sales, Finance, HR"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Approver / Manager</label>
              <select value={form.managerId} onChange={e => setForm(f => ({...f, managerId: e.target.value}))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="">— No approver assigned —</option>
                {managers.filter(m => m.id !== editUser?.id).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">This person will receive approval requests from this user.</p>
            </div>
          </div>

          {msg && (
            <div className={`mt-3 px-3 py-2 rounded-lg text-sm ${msg.includes('!') ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
              {msg}
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60 transition-colors">
              {saving ? 'Saving...' : editUser ? 'Save changes' : 'Create user'}
            </button>
            <button onClick={() => { setShowForm(false); setMsg(''); }}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-medium text-gray-700">{users.length} users</h2>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading...</div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No users yet. Add your first user above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Name</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Department</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Role</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Approver</th>
              <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {users.map(u => {
                const manager = users.find(m => m.id === u.managerId);
                return (
                  <tr key={u.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center text-brand-600 text-xs font-medium shrink-0">
                          {initials(u.name)}
                        </div>
                        <div>
                          <p className="text-gray-900 font-medium">{u.name}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell text-xs">{u.department || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.role]}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {manager ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 text-xs font-medium">
                            {initials(manager.name)}
                          </div>
                          <span className="text-xs text-gray-600">{manager.name}</span>
                        </div>
                      ) : <span className="text-xs text-gray-400">— not set —</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(u)}
                        className="text-xs text-brand-400 hover:text-brand-600 font-medium">
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
