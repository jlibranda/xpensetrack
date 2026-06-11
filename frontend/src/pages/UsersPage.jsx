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
  const [tab, setTab] = useState('list');
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });
  const fileRef = useRef();
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [form, setForm] = useState({ name:'', email:'', password:'', role:'EMPLOYEE', department:'', managerId:'', costCenter:'' });

  const load = async () => {
    setLoading(true);
    try { const d = await api.get('/users'); setUsers(Array.isArray(d) ? d : []); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ name:u.name, email:u.email, password:'', role:u.role, department:u.department||'', managerId:u.managerId||'', costCenter:u.costCenter||'' });
    setTab('add');
  };

  const openAdd = () => {
    setEditUser(null);
    setForm({ name:'', email:'', password:'', role:'EMPLOYEE', department:'', managerId:'', costCenter:'' });
    setMsg({ text:'', ok:true }); setTab('add');
  };

  const save = async () => {
    if (!form.name || !form.email) { setMsg({ text:'Name and email required.', ok:false }); return; }
    if (!editUser && !form.password) { setMsg({ text:'Password required.', ok:false }); return; }
    setSaving(true); setMsg({ text:'', ok:true });
    try {
      if (editUser) {
        await api.patch(`/users/${editUser.id}`, { role:form.role, department:form.department, managerId:form.managerId||null, costCenter:form.costCenter||null });
        setMsg({ text:'User updated!', ok:true });
      } else {
        await api.post('/auth/register', { name:form.name, email:form.email, password:form.password, role:form.role, department:form.department });
        setMsg({ text:`User created!`, ok:true });
      }
      await load();
      setTimeout(() => { setTab('list'); setMsg({ text:'', ok:true }); }, 1500);
    } catch(err) { setMsg({ text:err.error||'Failed.', ok:false }); }
    finally { setSaving(false); }
  };

  const parseBulk = (text) => {
    const lines = text.trim().split('\n').filter(l => l.trim());
    const start = lines[0]?.toLowerCase().startsWith('name') ? 1 : 0;
    return lines.slice(start).map(line => {
      const [name, email, password, role, department, costCenter] = line.split(',').map(s => s?.trim());
      return { name, email, password: password||'Welcome123', role: role||'EMPLOYEE', department: department||'', costCenter: costCenter||'' };
    }).filter(u => u.name && u.email);
  };

  const handleBulk = async () => {
    const users = parseBulk(bulkText);
    if (!users.length) { setMsg({ text:'No valid users found.', ok:false }); return; }
    setBulkLoading(true); setBulkResult(null);
    try { const r = await api.post('/users/bulk', { users }); setBulkResult(r); await load(); }
    catch(err) { setMsg({ text:err.error||'Bulk upload failed.', ok:false }); }
    finally { setBulkLoading(false); }
  };

  const downloadTemplate = () => {
    const csv = 'name,email,password,role,department,costCenter\nJuan Cruz,juan@co.com,Welcome123,EMPLOYEE,Sales,CC-001\nMaria Santos,maria@co.com,Welcome123,MANAGER,Finance,CC-002';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
    a.download = 'users-template.csv'; a.click();
  };

  const managers = users.filter(u => ['MANAGER','FINANCE','ADMIN'].includes(u.role));
  const initials = name => name?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">User management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} users · assign roles, approvers & cost centers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setTab('bulk'); setBulkResult(null); }}
            className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">📤 Bulk</button>
          <button onClick={openAdd}
            className="px-3 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600">+ Add user</button>
        </div>
      </div>

      {/* Role guide */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[['EMPLOYEE','Submits expenses'],['MANAGER','1st approver'],['FINANCE','2nd approver'],['ADMIN','Full access']].map(([role,desc]) => (
          <div key={role} className="bg-gray-50 rounded-xl p-3">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[role]}`}>{role}</span>
            <p className="text-xs text-gray-400 mt-1">{desc}</p>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {tab === 'add' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">{editUser ? `Edit ${editUser.name}` : 'Add new user'}</h2>
            <button onClick={() => setTab('list')} className="text-xs text-gray-400">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Full name *</label>
              <input value={form.name} onChange={e=>setF('name',e.target.value)} disabled={!!editUser} placeholder="Maria Santos"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-400" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Email *</label>
              <input value={form.email} onChange={e=>setF('email',e.target.value)} disabled={!!editUser} placeholder="maria@company.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-400" /></div>
            {!editUser && <div><label className="block text-xs text-gray-500 mb-1">Password *</label>
              <input type="password" value={form.password} onChange={e=>setF('password',e.target.value)} placeholder="Temp password"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" /></div>}
            <div><label className="block text-xs text-gray-500 mb-1">Role *</label>
              <select value={form.role} onChange={e=>setF('role',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Department</label>
              <input value={form.department} onChange={e=>setF('department',e.target.value)} placeholder="e.g. Sales"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Cost center</label>
              <input value={form.costCenter} onChange={e=>setF('costCenter',e.target.value)} placeholder="e.g. CC-001"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" /></div>
            <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Approver / Manager</label>
              <select value={form.managerId} onChange={e=>setF('managerId',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="">— None —</option>
                {managers.filter(m=>m.id!==editUser?.id).map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">This person will receive approval requests from this user.</p></div>
          </div>
          {msg.text && <div className={`mt-3 px-3 py-2 rounded-lg text-sm border ${msg.ok?'bg-green-50 text-green-700 border-green-100':'bg-red-50 text-red-700 border-red-100'}`}>{msg.text}</div>}
          <div className="flex gap-3 mt-4">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60">
              {saving ? 'Saving...' : editUser ? 'Save changes' : 'Create user'}
            </button>
            <button onClick={() => setTab('list')} className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* Bulk upload */}
      {tab === 'bulk' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Bulk upload</h2>
            <button onClick={() => setTab('list')} className="text-xs text-gray-400">✕</button>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 mb-3 text-xs text-gray-600">
            <p className="font-medium mb-1">CSV format:</p>
            <code>name,email,password,role,department,costCenter</code>
          </div>
          <div className="flex gap-2 mb-3">
            <button onClick={downloadTemplate} className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">⬇ Template</button>
            <button onClick={() => fileRef.current.click()} className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">📂 Upload CSV</button>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const r=new FileReader(); r.onload=ev=>setBulkText(ev.target.result); r.readAsText(e.target.files[0]); }} />
          </div>
          <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} rows={6}
            placeholder="Paste CSV here..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-400 resize-none mb-3" />
          {bulkResult && (
            <div className="space-y-2 mb-3">
              {bulkResult.created?.length>0 && <div className="px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-xs text-green-700">✅ Created: {bulkResult.created.map(u=>u.name).join(', ')}</div>}
              {bulkResult.skipped?.length>0 && <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">⚠️ Skipped: {bulkResult.skipped.map(u=>u.email).join(', ')}</div>}
              {bulkResult.errors?.length>0 && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">❌ Errors: {bulkResult.errors.map(u=>u.email).join(', ')}</div>}
            </div>
          )}
          <button onClick={handleBulk} disabled={bulkLoading||!bulkText.trim()}
            className="px-4 py-2 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60">
            {bulkLoading ? 'Uploading...' : `Upload ${parseBulk(bulkText).length||0} users`}
          </button>
        </div>
      )}

      {/* Users table */}
      {tab === 'list' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50"><h2 className="text-sm font-medium text-gray-700">{users.length} users</h2></div>
          {loading ? <div className="py-12 text-center text-sm text-gray-400">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Name</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Department</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Cost Center</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Role</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden lg:table-cell">Approver</th>
                  <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {users.map(u => {
                    const manager = users.find(m => m.id === u.managerId);
                    return (
                      <tr key={u.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center text-brand-600 text-xs font-medium shrink-0">{initials(u.name)}</div>
                            <div><p className="text-sm font-medium text-gray-900">{u.name}</p><p className="text-xs text-gray-400">{u.email}</p></div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">{u.department||'—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">{u.costCenter||'—'}</td>
                        <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.role]}`}>{u.role}</span></td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {manager ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 text-xs">{initials(manager.name)}</div>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
