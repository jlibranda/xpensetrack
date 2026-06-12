// src/pages/UsersPage.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { useOrg } from '../context/OrgContext';

const ROLES = ['EMPLOYEE','MANAGER','FINANCE','ADMIN'];
const ROLE_BADGE = {
  EMPLOYEE:'bg-blue-600 text-white', 
  MANAGER:'bg-purple-600 text-white',
  FINANCE:'bg-amber-500 text-white', 
  ADMIN:'bg-green-600 text-white',
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('list');
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text:'', ok:true });
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const fileRef = useRef();
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const { settings } = useOrg();
  const navigate = useNavigate();

  const emptyForm = { firstName:'', lastName:'', email:'', password:'', newPassword:'', role:'EMPLOYEE',
    department:'', managerId:'', costCenter:'', position:'', payrollAccount:'', employeeNumber:'' };
  const [form, setForm] = useState(emptyForm);

  const { user: currentUser } = useAuth();

  // Read role permissions from Access Control settings (DB-backed via settings.accessControl)
  const getRolePerm = (permKey, defaultRoles = ['ADMIN']) => {
    const userRole = currentUser?.role || 'EMPLOYEE';
    const perms = settings?.accessControl;
    if (!perms || Object.keys(perms).length === 0) return defaultRoles.includes(userRole);
    return (perms[permKey] || defaultRoles).includes(userRole);
  };

  const hasImpersonateAccess = getRolePerm('impersonate_user', ['ADMIN']);
  const hasResetPasswordAccess = getRolePerm('reset_passwords', ['ADMIN']);

  const load = async () => {
    setLoading(true);
    try { const d = await api.get('/users'); setUsers(Array.isArray(d) ? d : []); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ firstName:u.firstName||'', lastName:u.lastName||'', email:u.email,
      password:'', role:u.role, department:u.department||'', managerId:u.managerId||'',
      costCenter:u.costCenter||'', position:u.position||'', payrollAccount:u.payrollAccount||'',
      employeeNumber:u.employeeNumber||'' });
    setMsg({text:'',ok:true}); setTab('add');
  };

  const openAdd = () => {
    setEditUser(null);
    setForm({...emptyForm, password: settings?.defaultPassword || 'Welcome123'});
    setMsg({text:'',ok:true}); setTab('add');
  };

  const save = async () => {
    if (!form.firstName || !form.email) { setMsg({text:'First name and email required.',ok:false}); return; }
    if (!editUser && !form.password) { setMsg({text:'Password required.',ok:false}); return; }
    setSaving(true); setMsg({text:'',ok:true});
    try {
      if (editUser) {
        await api.patch(`/users/${editUser.id}`, { ...form, managerId: form.managerId||null, hireDate: form.hireDate||null, newPassword: form.newPassword||undefined });
        setMsg({text:'Updated!',ok:true});
      } else {
        await api.post('/auth/register', { ...form });
        setMsg({text:'User created!',ok:true});
      }
      await load();
      setTimeout(() => { setTab('list'); setMsg({text:'',ok:true}); }, 1500);
    } catch(err) { setMsg({text:err.error||'Failed.',ok:false}); }
    finally { setSaving(false); }
  };

  const toggleActive = async (u) => {
    try {
      await api.post(`/users/${u.id}/toggle-active`);
      await load();
    } catch(err) { alert(err.error||'Failed'); }
  };

  const resetPassword = async (u) => {
    const pwd = prompt(`New password for ${u.firstName} ${u.lastName}:`, settings?.defaultPassword || 'Welcome123');
    if (!pwd) return;
    try {
      await api.post(`/users/${u.id}/reset-password`, { newPassword: pwd });
      alert('Password reset successfully!');
    } catch(err) { alert(err.error||'Failed'); }
  };

  const impersonateUser = async (u) => {
    if (!window.confirm(`Access account of ${u.firstName} ${u.lastName}? You can return to admin by clicking "Return to Admin" in the top bar.`)) return;
    try {
      const res = await api.post(`/users/${u.id}/impersonate`);
      // Save current admin token so we can return
      localStorage.setItem('admin_token', localStorage.getItem('token'));
      localStorage.setItem('admin_name', `${window.__currentUser?.firstName || ''} ${window.__currentUser?.lastName || ''}`.trim());
      // Switch to impersonated user
      localStorage.setItem('token', res.token);
      window.location.href = '/';
    } catch(err) { alert(err.error || 'Failed to access user account'); }
  };

  const parseBulk = (text) => {
    const lines = text.trim().split('\n').filter(l=>l.trim());
    const start = lines[0]?.toLowerCase().includes('email') ? 1 : 0;
    return lines.slice(start).map(line => {
      const [lastName, firstName, email, password, role, department, costCenter, employeeNumber, position] = line.split(',').map(s=>s?.trim());
      return { lastName, firstName, email, password: password||settings?.defaultPassword||'Welcome123', role: role||'EMPLOYEE', department, costCenter, employeeNumber, position };
    }).filter(u => u.firstName && u.email);
  };

  const handleBulk = async () => {
    const users = parseBulk(bulkText);
    if (!users.length) { setMsg({text:'No valid users found.',ok:false}); return; }
    setBulkLoading(true); setBulkResult(null);
    try { const r = await api.post('/users/bulk', { users }); setBulkResult(r); await load(); }
    catch(err) { setMsg({text:err.error||'Failed.',ok:false}); }
    finally { setBulkLoading(false); }
  };

  const downloadTemplate = () => {
    const csv = 'lastName,firstName,email,password,role,department,costCenter,employeeNumber,position\nDela Cruz,Juan,juan@co.com,Welcome123,EMPLOYEE,Sales,CC-001,EMP-001,Sales Rep\nSantos,Maria,maria@co.com,Welcome123,MANAGER,Finance,CC-002,EMP-002,Finance Manager';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'users-template.csv'; a.click();
  };

  const managers = users.filter(u=>['MANAGER','FINANCE','ADMIN'].includes(u.role));
  const initials = u => `${u.firstName?.[0]||''}${u.lastName?.[0]||''}`.toUpperCase();
  const fullName = u => `${u.lastName}, ${u.firstName}`.trim();

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    if (q && !`${u.firstName} ${u.lastName} ${u.email} ${u.employeeNumber||''}`.toLowerCase().includes(q)) return false;
    if (filterRole && u.role !== filterRole) return false;
    if (filterActive === 'active' && !u.isActive) return false;
    if (filterActive === 'inactive' && u.isActive) return false;
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">User management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} users · {users.filter(u=>u.isActive).length} active</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setTab('bulk'); setBulkResult(null); }}
            className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">📤 Bulk</button>
          <button onClick={openAdd}
            className="px-3 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90"
            style={{background: settings?.primaryColor||'#1D9E75'}}>+ Add user</button>
        </div>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[['EMPLOYEE','Submit expenses'],['MANAGER','1st approver'],['FINANCE','2nd approver + reports'],['ADMIN','Full access']].map(([r,d]) => (
          <div key={r} className="bg-gray-50 rounded-xl p-3">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[r]}`}>{r}</span>
            <p className="text-xs text-gray-400 mt-1">{d}</p>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {tab === 'add' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">{editUser ? `Edit: ${fullName(editUser)}` : 'Add new user'}</h2>
            <button onClick={() => setTab('list')} className="text-xs text-gray-400 hover:text-gray-600">✕ Cancel</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['employeeNumber','Employee #','e.g. EMP-001',false],
              ['email','Email *','email@company.com', !!editUser],
              ['lastName','Last name *','e.g. Dela Cruz',false],
              ['firstName','First name *','e.g. Juan',false],
            ].map(([k,label,ph,disabled]) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input value={form[k]} onChange={e=>setF(k,e.target.value)} placeholder={ph} disabled={disabled}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-400" />
              </div>
            ))}
            {!editUser && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Password *</label>
                <input type="text" value={form.password} onChange={e=>setF('password',e.target.value)}
                  placeholder="Temporary password"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
            )}
            {editUser && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reset Password <span className="text-gray-400 font-normal">(leave blank to keep current)</span></label>
                <input type="text" value={form.newPassword} onChange={e=>setF('newPassword',e.target.value)}
                  placeholder="Enter new password to reset"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role *</label>
              <select value={form.role} onChange={e=>setF('role',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                {ROLES.map(r=><option key={r}>{r}</option>)}
              </select>
            </div>
            {[
              ['department','Department','e.g. Sales'],
              ['position','Position','e.g. Sales Rep'],
              ['costCenter','Cost center','e.g. CC-001'],
              ['payrollAccount','Payroll account no.','e.g. PA-00123'],
            ].map(([k,label,ph]) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input value={form[k]} onChange={e=>setF(k,e.target.value)} placeholder={ph}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Approver / Manager</label>
              <select value={form.managerId} onChange={e=>setF('managerId',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="">— None —</option>
                {managers.filter(m=>m.id!==editUser?.id).map(m=>(
                  <option key={m.id} value={m.id}>{fullName(m)} ({m.role})</option>
                ))}
              </select>
            </div>


          </div>
          {msg.text && <div className={`mt-3 px-3 py-2 rounded-lg text-sm border ${msg.ok?'bg-green-50 text-green-700 border-green-100':'bg-red-50 text-red-700 border-red-100'}`}>{msg.text}</div>}
          <div className="flex gap-3 mt-4 flex-wrap">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              style={{background:settings?.primaryColor||'#1D9E75'}}>
              {saving ? 'Saving...' : editUser ? 'Save changes' : 'Create user'}
            </button>
            <button onClick={() => setTab('list')} className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            {editUser && hasImpersonateAccess && (
              <button onClick={() => { setTab('list'); impersonateUser(editUser); }}
                className="px-4 py-2 border border-purple-200 text-purple-600 rounded-lg text-sm font-medium hover:bg-purple-50 ml-auto"
                title="Login and access this user's account">
                🔑 Login as {editUser.firstName}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bulk upload */}
      {tab === 'bulk' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Bulk upload</h2>
            <button onClick={() => setTab('list')} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 mb-3 text-xs text-gray-600">
            <p className="font-medium mb-1">CSV format (default password: <code className="bg-white px-1 rounded">{settings?.defaultPassword||'Welcome123'}</code>):</p>
            <code>lastName,firstName,email,password,role,department,costCenter,employeeNumber,position</code>
          </div>
          <div className="flex gap-2 mb-3">
            <button onClick={downloadTemplate} className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">⬇ Template</button>
            <button onClick={()=>fileRef.current.click()} className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">📂 Upload CSV</button>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
              onChange={e=>{const r=new FileReader();r.onload=ev=>setBulkText(ev.target.result);r.readAsText(e.target.files[0]);}} />
          </div>
          <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} rows={6}
            placeholder="Paste CSV or upload above..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none resize-none mb-3" />
          {bulkResult && (
            <div className="space-y-2 mb-3">
              {bulkResult.created?.length>0 && <div className="px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-xs text-green-700">✅ Created {bulkResult.created.length}: {bulkResult.created.map(u=>`${u.lastName}, ${u.firstName}`).join(' · ')}</div>}
              {bulkResult.skipped?.length>0 && <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">⚠️ Skipped: {bulkResult.skipped.map(u=>u.email).join(', ')}</div>}
              {bulkResult.errors?.length>0 && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">❌ Errors: {bulkResult.errors.map(u=>u.email).join(', ')}</div>}
            </div>
          )}
          <button onClick={handleBulk} disabled={bulkLoading||!bulkText.trim()}
            className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
            style={{background:settings?.primaryColor||'#1D9E75'}}>
            {bulkLoading ? 'Uploading...' : `Upload ${parseBulk(bulkText).length||0} users`}
          </button>
        </div>
      )}

      {/* Users list */}
      {tab === 'list' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {/* Filters */}
          <div className="px-4 py-3 border-b border-gray-50 flex flex-wrap gap-3 items-center">
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search name, email, employee #..."
              className="flex-1 min-w-48 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            <select value={filterRole} onChange={e=>setFilterRole(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none">
              <option value="">All roles</option>
              {ROLES.map(r=><option key={r}>{r}</option>)}
            </select>
            <select value={filterActive} onChange={e=>setFilterActive(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none">
              <option value="all">All status</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            <span className="text-xs text-gray-400">{filtered.length} shown</span>
          </div>

          {loading ? <div className="py-12 text-center text-sm text-gray-400">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Employee</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden md:table-cell">Dept / Position</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Role</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium hidden lg:table-cell">Approver</th>
                  <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {filtered.map(u => {
                    const manager = users.find(m=>m.id===u.managerId);
                    return (
                      <tr key={u.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                              style={{background: u.isActive ? (settings?.primaryColor||'#1D9E75') : '#9ca3af'}}>
                              {initials(u)}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium text-gray-900">{fullName(u)}</p>
                                {u.canImpersonate && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">🔑 Access</span>}
                              </div>
                              <p className="text-xs text-gray-400">{u.email}</p>
                              {u.employeeNumber && <p className="text-xs text-gray-300">#{u.employeeNumber}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <p className="text-xs text-gray-700">{u.department||'—'}</p>
                          <p className="text-xs text-gray-400">{u.position||''}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.role]}`}>{u.role}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {manager ? <span className="text-xs text-gray-600">{fullName(manager)}</span> : <span className="text-xs text-gray-300">—</span>}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <button onClick={() => navigate(`/users/${u.id}`)} className="text-xs px-2 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">View</button>
                            <button onClick={() => openEdit(u)} className="text-xs px-2 py-1 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 font-medium">Edit</button>
                            {hasImpersonateAccess && (
                              <button onClick={() => impersonateUser(u)}
                                className="text-xs px-2 py-1 border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 font-medium"
                                title="Login as this user to access their account">
                                🔑 Login as
                              </button>
                            )}
                            <button onClick={() => toggleActive(u)}
                              className={`text-xs px-2 py-1 rounded-lg font-medium border ${u.isActive ? 'border-green-200 text-green-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200' : 'border-red-200 text-red-600 hover:bg-green-50 hover:text-green-700 hover:border-green-200'}`}
                              title={u.isActive ? 'Click to deactivate access' : 'Click to activate access'}>
                              {u.isActive ? '✓ Active' : '✗ Inactive'}
                            </button>
                            {hasResetPasswordAccess && (
                              <button onClick={() => resetPassword(u)} className="text-xs px-2 py-1 border border-amber-200 text-amber-600 rounded-lg hover:bg-amber-50 font-medium">Reset pwd</button>
                            )}
                          </div>
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
