// src/pages/UsersPage.jsx
import { useState, useEffect, useRef } from 'react';
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
  const [tab, setTab] = useState('list'); // list | add | bulk
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });
  const fileRef = useRef();

  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'EMPLOYEE', department: '', managerId: '' });
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const d = await api.get('/users'); setUsers(Array.isArray(d) ? d : []); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ name: u.name, email: u.email, password: '', role: u.role, department: u.department || '', managerId: u.managerId || '' });
    setTab('add');
  };

  const openAdd = () => {
    setEditUser(null);
    setForm({ name: '', email: '', password: '', role: 'EMPLOYEE', department: '', managerId: '' });
    setMsg({ text: '', ok: true });
    setTab('add');
  };

  const saveUser = async () => {
    if (!form.name || !form.email) { setMsg({ text: 'Name and email are required.', ok: false }); return; }
    if (!editUser && !form.password) { setMsg({ text: 'Password is required for new users.', ok: false }); return; }
    setSaving(true); setMsg({ text: '', ok: true });
    try {
      if (editUser) {
        await api.patch(`/users/${editUser.id}`, { role: form.role, department: form.department, managerId: form.managerId || null });
        setMsg({ text: 'User updated successfully!', ok: true });
      } else {
        await api.post('/auth/register', { name: form.name, email: form.email, password: form.password, role: form.role, department: form.department });
        setMsg({ text: `User ${form.name} created! They can now log in.`, ok: true });
      }
      await load();
      setTimeout(() => { setTab('list'); setMsg({ text: '', ok: true }); }, 1800);
    } catch (err) {
      setMsg({ text: err.error || 'Failed to save user.', ok: false });
    } finally { setSaving(false); }
  };

  // Bulk upload from CSV text
  const parseBulkCSV = (text) => {
    const lines = text.trim().split('\n').filter(l => l.trim());
    // Skip header row if it starts with "name" or "Name"
    const start = lines[0]?.toLowerCase().startsWith('name') ? 1 : 0;
    return lines.slice(start).map(line => {
      const [name, email, password, role, department] = line.split(',').map(s => s?.trim());
      return { name, email, password: password || 'Welcome123', role: role || 'EMPLOYEE', department: department || '' };
    }).filter(u => u.name && u.email);
  };

  const handleBulkUpload = async () => {
    const users = parseBulkCSV(bulkText);
    if (users.length === 0) { setMsg({ text: 'No valid users found. Check the format.', ok: false }); return; }
    setBulkLoading(true); setBulkResult(null);
    try {
      const result = await api.post('/users/bulk', { users });
      setBulkResult(result);
      await load();
    } catch (err) {
      setMsg({ text: err.error || 'Bulk upload failed.', ok: false });
    } finally { setBulkLoading(false); }
  };

  const handleCSVFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setBulkText(ev.target.result);
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const csv = 'name,email,password,role,department\nJuan Dela Cruz,juan@company.com,Welcome123,EMPLOYEE,Sales\nMaria Santos,maria@company.com,Welcome123,MANAGER,Finance';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'users-template.csv'; a.click();
  };

  const managers = users.filter(u => ['MANAGER','FINANCE','ADMIN'].includes(u.role));
  const initials = (name) => name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">User management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} users · assign roles and approvers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setTab('bulk'); setBulkResult(null); setMsg({ text: '', ok: true }); }}
            className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
            📤 Bulk upload
          </button>
          <button onClick={openAdd}
            className="px-3 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">
            + Add user
          </button>
        </div>
      </div>

      {/* Role guide */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { role: 'EMPLOYEE', desc: 'Submits expenses' },
          { role: 'MANAGER', desc: '1st level approver' },
          { role: 'FINANCE', desc: '2nd level approver' },
          { role: 'ADMIN', desc: 'Full access' },
        ].map(r => (
          <div key={r.role} className="bg-gray-50 rounded-xl p-3">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[r.role]}`}>{r.role}</span>
            <p className="text-xs text-gray-400 mt-1">{r.desc}</p>
          </div>
        ))}
      </div>

      {/* Add / Edit form */}
      {tab === 'add' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">{editUser ? `Edit ${editUser.name}` : 'Add new user'}</h2>
            <button onClick={() => setTab('list')} className="text-xs text-gray-400 hover:text-gray-600">✕ Cancel</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Full name *</label>
              <input value={form.name} onChange={e => setF('name', e.target.value)} disabled={!!editUser}
                placeholder="e.g. Maria Santos"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={e => setF('email', e.target.value)} disabled={!!editUser}
                placeholder="e.g. maria@company.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
            {!editUser && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Temporary password *</label>
                <input type="password" value={form.password} onChange={e => setF('password', e.target.value)}
                  placeholder="They can change this later"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role *</label>
              <select value={form.role} onChange={e => setF('role', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Department</label>
              <input value={form.department} onChange={e => setF('department', e.target.value)}
                placeholder="e.g. Sales, HR, Finance"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Approver / Manager</label>
              <select value={form.managerId} onChange={e => setF('managerId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="">— None assigned —</option>
                {managers.filter(m => m.id !== editUser?.id).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Gets notified when this user submits an expense.</p>
            </div>
          </div>
          {msg.text && (
            <div className={`mt-3 px-3 py-2 rounded-lg text-sm border ${msg.ok ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
              {msg.text}
            </div>
          )}
          <div className="flex gap-3 mt-4">
            <button onClick={saveUser} disabled={saving}
              className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60 transition-colors">
              {saving ? 'Saving...' : editUser ? 'Save changes' : 'Create user'}
            </button>
            <button onClick={() => setTab('list')} className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* Bulk upload */}
      {tab === 'bulk' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Bulk upload users</h2>
            <button onClick={() => setTab('list')} className="text-xs text-gray-400 hover:text-gray-600">✕ Cancel</button>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600">
            <p className="font-medium mb-1">CSV format:</p>
            <code className="block text-gray-500">name,email,password,role,department</code>
            <code className="block text-gray-500">Juan Dela Cruz,juan@co.com,Welcome123,EMPLOYEE,Sales</code>
            <p className="mt-1 text-gray-400">Role options: EMPLOYEE, MANAGER, FINANCE, ADMIN. Password and role are optional (defaults: Welcome123, EMPLOYEE).</p>
          </div>

          <div className="flex gap-3 mb-3">
            <button onClick={downloadTemplate}
              className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">
              ⬇ Download template
            </button>
            <button onClick={() => fileRef.current.click()}
              className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">
              📂 Upload CSV file
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCSVFile} />
          </div>

          <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={8}
            placeholder="Paste CSV here or upload a file above..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-400 resize-none mb-3" />

          {msg.text && (
            <div className={`mb-3 px-3 py-2 rounded-lg text-sm border ${msg.ok ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
              {msg.text}
            </div>
          )}

          {bulkResult && (
            <div className="mb-3 space-y-2">
              {bulkResult.created?.length > 0 && (
                <div className="px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">
                  ✅ {bulkResult.created.length} user{bulkResult.created.length !== 1 ? 's' : ''} created: {bulkResult.created.map(u => u.name).join(', ')}
                </div>
              )}
              {bulkResult.skipped?.length > 0 && (
                <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700">
                  ⚠️ {bulkResult.skipped.length} skipped (already exist): {bulkResult.skipped.map(u => u.email).join(', ')}
                </div>
              )}
              {bulkResult.errors?.length > 0 && (
                <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
                  ❌ {bulkResult.errors.length} errors: {bulkResult.errors.map(u => `${u.email} (${u.reason})`).join(', ')}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleBulkUpload} disabled={bulkLoading || !bulkText.trim()}
              className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60 transition-colors">
              {bulkLoading ? 'Uploading...' : `Upload ${parseBulkCSV(bulkText).length || 0} users`}
            </button>
            <button onClick={() => { setBulkText(''); setBulkResult(null); }}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Users list */}
      {tab === 'list' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <h2 className="text-sm font-medium text-gray-700">{users.length} users</h2>
          </div>
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Loading...</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No users yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Name</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Dept</th>
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
                            <p className="text-gray-900 font-medium text-sm">{u.name}</p>
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
                            <div className="w-5 h-5 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 text-xs font-medium">{initials(manager.name)}</div>
                            <span className="text-xs text-gray-600">{manager.name}</span>
                          </div>
                        ) : <span className="text-xs text-gray-300">not set</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => openEdit(u)} className="text-xs text-brand-400 hover:text-brand-600 font-medium">Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
