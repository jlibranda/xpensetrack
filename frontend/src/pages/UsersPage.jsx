// src/pages/UsersPage.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import toast from '../lib/toast';
import { useOrg } from '../context/OrgContext';

const BASE_ROLES = ['EMPLOYEE','MANAGER','FINANCE','ADMIN'];
const ROLE_BADGE = {
  EMPLOYEE:'bg-blue-600 text-white', 
  MANAGER:'bg-purple-600 text-white',
  FINANCE:'bg-amber-500 text-white', 
  ADMIN:'bg-green-600 text-white',
};
const badgeFor = (role) => ROLE_BADGE[role] || 'bg-gray-500 text-white';

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
  const apprFileRef = useRef();
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [apprResult, setApprResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deletingUsers, setDeletingUsers] = useState(false);
  const [sendingCreds, setSendingCreds] = useState(false);
  const [apprLoading, setApprLoading] = useState(false);
  const { settings } = useOrg();
  const ROLES = (() => {
    const custom = settings?.accessControl?.__roles__;
    const list = Array.isArray(custom) && custom.length ? custom : BASE_ROLES;
    return [...new Set([...BASE_ROLES, ...list])];
  })();
  const dark = !!settings?.darkMode;
  const navigate = useNavigate();
  const location = useLocation();

  const emptyForm = { firstName:'', lastName:'', email:'', password:'', role:'EMPLOYEE',
    department:'', managerId:'', costCenter:'', position:'', payrollAccount:'', employeeNumber:'',
    approverIds:[], approvalMode:'SEQUENTIAL', approvalRule:'ALL', approvalFlow:[] };
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
  const hasSendCredentialsAccess = getRolePerm('send_credentials', ['ADMIN']);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get('/users');
      let list = Array.isArray(d) ? d : [];
      // Non-admins must never see ADMIN accounts (backend also enforces this)
      if (currentUser?.role !== 'ADMIN') list = list.filter(u => u.role !== 'ADMIN');
      setUsers(list);
    }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // If we arrived here from the employee detail page's "Edit employee" button,
  // open that user in edit mode once the list has loaded.
  useEffect(() => {
    const editId = location.state?.editUserId;
    if (editId && users.length) {
      const u = users.find(x => x.id === editId);
      if (u) {
        openEdit(u);
        // clear the state so a manual refresh doesn't re-trigger
        navigate('/users', { replace: true, state: {} });
      }
    }
  }, [users, location.state]);

  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ firstName:u.firstName||'', lastName:u.lastName||'', email:u.email,
      password:'', role:u.role, department:u.department||'', managerId:u.managerId||'',
      costCenter:u.costCenter||'', position:u.position||'', payrollAccount:u.payrollAccount||'',
      employeeNumber:u.employeeNumber||'',
      approverIds: (u.approverIds||'').split(',').map(s=>s.trim()).filter(Boolean),
      approvalMode: u.approvalMode||'SEQUENTIAL',
      approvalRule: u.approvalRule||'ALL',
      approvalFlow: deriveFlow(u),
      newPassword: '' });
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
      // Clean the step flow: drop empty approver slots and empty steps.
      const cleanFlow = (form.approvalFlow||[])
        .map(s => ({ approvers: (s.approvers||[]).filter(Boolean), rule: s.rule==='ALL'?'ALL':'ANY' }))
        .filter(s => s.approvers.length > 0);
      if (editUser) {
        await api.patch(`/users/${editUser.id}`, { ...form, approvalFlow: cleanFlow, managerId: form.managerId||null, hireDate: form.hireDate||null });
        setMsg({text:'Updated!',ok:true});
      } else {
        // Create the account (saves core fields + sends the welcome email if email is ON)...
        const res = await api.post('/auth/register', { ...form });
        const newId = res?.user?.id;
        // ...then persist the rest (cost center, position, payroll account, manager,
        // approval flow) via the same endpoint the Edit form uses.
        if (newId) {
          await api.patch(`/users/${newId}`, { ...form, approvalFlow: cleanFlow, managerId: form.managerId||null, hireDate: form.hireDate||null });
        }
        setMsg({ text: res?.welcomeSent ? 'User created — welcome email sent.' : 'User created. (Email notifications are OFF, so no welcome email was sent.)', ok:true });
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

  const [sendingCredsId, setSendingCredsId] = useState(null);
  const sendCredentials = async (u) => {
    if (!confirm(`Send login credentials to ${u.firstName} ${u.lastName} (${u.email})?\n\nThis sets a NEW temporary password and emails it to them with a link to the app. Their current password will stop working.`)) return;
    setSendingCredsId(u.id);
    try {
      const res = await api.post(`/users/${u.id}/send-credentials`);
      alert(res.message || `Credentials sent to ${u.email}.`);
    } catch(err) { alert(err.error||'Failed to send credentials.'); }
    finally { setSendingCredsId(null); }
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

  // Parse a single CSV line into fields, respecting double-quoted values that
  // may themselves contain commas (e.g. a position like "Manager, HR").
  // Also strips Excel's text wrapper ="value".
  const parseCsvLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    // strip Excel ="..." wrapper and trim
    return out.map(v => {
      let s = (v ?? '').trim();
      const m = s.match(/^="(.*)"$/);
      if (m) s = m[1];
      return s;
    });
  };

  const parseBulk = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    const start = lines[0]?.toLowerCase().includes('email') ? 1 : 0;
    return lines.slice(start).map(line => {
      const [employeeNumber, lastName, firstName, email, password, role, department, costCenter, position, payrollAccount] = parseCsvLine(line);
      return { lastName, firstName, email, password: password||settings?.defaultPassword||'Welcome123', role: role||'EMPLOYEE', department, costCenter, employeeNumber, position, payrollAccount };
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
    const csv = 'employeeNumber,lastName,firstName,email,password,role,department,costCenter,position,payrollAccount\nEMP-001,Dela Cruz,Juan,juan@co.com,Welcome123,EMPLOYEE,Sales,CC-001,Sales Rep,="1234567890"\nEMP-002,Santos,Maria,maria@co.com,Welcome123,MANAGER,Finance,CC-002,"Manager, Finance",="0987654321"';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'users-template.csv'; a.click();
  };

  const downloadApprTemplate = () => {
    const guide = [
      '# APPROVER FLOW UPLOAD GUIDE — delete these # lines before uploading if your tool keeps them; the system ignores rows whose employee_number is blank',
      '# Each row sets the approval flow for ONE employee (matched by employee_number).',
      '# Columns step1..step8 are the approval STEPS, in order. Fill only the steps you need; leave the rest blank.',
      '# Within a step cell, list approver EMPLOYEE NUMBERS:',
      '#   - Use "/" between names for ANY-ONE-approves (OR).  Example: EMP-003/EMP-004  = either EMP-003 or EMP-004 can approve',
      '#   - Use "+" between names for ALL-must-approve (AND). Example: EMP-003+EMP-004 = both EMP-003 and EMP-004 must approve',
      '#   - A single number = just that one person.            Example: EMP-002',
      '# mode column: SEQUENTIAL = steps run in order (step1, then step2...). ANY_ORDER = all steps open at once.',
      '# Example below: Juan must be approved by EMP-002 (step1), then EMP-003 OR EMP-004 (step2), then EMP-005 (step3), in order.',
    ].join('\n');
    const csv = guide + '\n'
      + 'employee_number,mode,step1,step2,step3,step4\n'
      + 'EMP-001,SEQUENTIAL,EMP-002,EMP-003/EMP-004,EMP-005,\n'
      + 'EMP-006,ANY_ORDER,EMP-002+EMP-003,EMP-005,,';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'approver-assignments-template.csv'; a.click();
  };

  const handleApprUpload = async (file) => {
    if (!file) return;
    setApprLoading(true); setApprResult(null); setMsg({text:'',ok:true});
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/users/bulk-approvers', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setApprResult(r);
      await load();
    } catch (e) {
      setMsg({ text: e.error || 'Upload failed', ok: false });
    } finally { setApprLoading(false); if (apprFileRef.current) apprFileRef.current.value=''; }
  };

  const managers = users.filter(u=>['MANAGER','FINANCE','ADMIN'].includes(u.role));
  const initials = u => `${u.firstName?.[0]||''}${u.lastName?.[0]||''}`.toUpperCase();
  const fullName = u => `${u.lastName}, ${u.firstName}`.trim();

  // Build the step array for the builder from a user's stored flow, or derive
  // it from legacy manager + approverIds + rule so existing employees show up.
  const deriveFlow = (u) => {
    if (u.approvalFlowJson) {
      try {
        const parsed = JSON.parse(u.approvalFlowJson);
        if (Array.isArray(parsed) && parsed.length) {
          return parsed.map(s => ({ approvers: (s.approvers||[]).filter(Boolean), rule: s.rule==='ALL'?'ALL':'ANY' }));
        }
      } catch (e) { /* fall through */ }
    }
    const additional = (u.approverIds||'').split(',').map(s=>s.trim()).filter(Boolean);
    const ordered = [];
    if (u.managerId) ordered.push(u.managerId);
    ordered.push(...additional);
    const uniq = [...new Set(ordered)];
    if (!uniq.length) return [];
    if ((u.approvalRule||'ALL') === 'ANY') return [{ approvers: uniq, rule: 'ANY' }];
    return uniq.map(id => ({ approvers: [id], rule: 'ALL' }));
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    if (q && !`${u.firstName} ${u.lastName} ${u.email} ${u.employeeNumber||''}`.toLowerCase().includes(q)) return false;
    if (filterRole && u.role !== filterRole) return false;
    if (filterActive === 'active' && !u.isActive) return false;
    if (filterActive === 'inactive' && u.isActive) return false;
    return true;
  });

  // Selectable users for delete = everyone shown except admins and the current user.
  const deletableShown = () => filtered.filter(u => u.role !== 'ADMIN' && u.id !== currentUser?.id);

  const toggleSelect = (id) => setSelectedIds(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);
  const toggleSelectAll = () => {
    const ids = deletableShown().map(u => u.id);
    const allSelected = ids.length > 0 && ids.every(id => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : ids);
  };

  const sendCredentialsSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Send login credentials (a fresh temporary password) to ${selectedIds.length} selected user(s)? They'll be asked to change it on first login.`)) return;
    setSendingCreds(true); setMsg({ text:'', ok:true });
    try {
      const r = await api.post('/users/bulk-credentials', { userIds: selectedIds });
      toast.success(r.message || 'Credentials sent');
      setMsg({ text: r.message || 'Credentials sent', ok: (r.failed?.length || 0) === 0 });
      setSelectedIds([]);
      await load();
    } catch (e) { setMsg({ text: e.error || 'Failed to send credentials', ok: false }); }
    finally { setSendingCreds(false); }
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`PERMANENTLY delete ${selectedIds.length} employee(s) AND all their expenses and approvals? This cannot be undone.`)) return;
    setDeletingUsers(true); setMsg({text:'',ok:true});
    try {
      const r = await api.post('/users/bulk-delete', { userIds: selectedIds });
      toast.success(`Deleted ${r.deleted} employee(s)`); setMsg({ text: `Deleted ${r.deleted} employee(s)${r.skipped ? `, skipped ${r.skipped} (protected)` : ''}`, ok: true });
      setSelectedIds([]);
      await load();
    } catch (e) { setMsg({ text: e.error || 'Delete failed', ok: false }); }
    finally { setDeletingUsers(false); }
  };

  const downloadEmployeeList = () => {
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const byId = {};
    users.forEach(u => { byId[u.id] = u; });
    const header = ['employeeNumber','lastName','firstName','email','role','department','position','costCenter','payrollAccount','managerEmployeeNumber','managerFullName','status'];
    const lines = [header.join(',')];
    filtered.forEach(u => {
      const mgr = u.managerId ? byId[u.managerId] : null;
      // Wrap payroll account so Excel keeps it as text (no scientific notation / lost leading zeros).
      const payrollText = u.payrollAccount ? `="${String(u.payrollAccount).replace(/"/g,'')}"` : '';
      lines.push([
        u.employeeNumber||'', u.lastName||'', u.firstName||'', u.email||'',
        u.role||'', u.department||'', u.position||'', u.costCenter||'',
        payrollText,
        mgr?.employeeNumber || '',
        mgr ? `${mgr.lastName||''}, ${mgr.firstName||''}`.replace(/^,\s*|,\s*$/g,'').trim() : '',
        u.isActive ? 'Active' : 'Inactive',
      ].map((v, idx) => idx === 8 ? v : esc(v)).join(','));
    });
    const statusLabel = filterActive === 'all' ? 'all' : filterActive;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `employees-${statusLabel}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

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
            style={{background: settings?.primaryColor||'#1D9E75', color: 'var(--brand-contrast,#fff)'}}>+ Add user</button>
        </div>
      </div>

      {/* Add/Edit form */}
      {tab === 'add' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">{editUser ? `Edit: ${fullName(editUser)}` : 'Add new user'}</h2>
            <button onClick={() => setTab('list')} className="text-sm font-medium px-3 py-1.5 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 shadow-sm">✕ Close</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['employeeNumber','Employee #','e.g. EMP-001',false],
              ['email','Email *','email@company.com', false],
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
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role *</label>
              <select value={form.role} onChange={e=>setF('role',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                {ROLES.filter(r => r !== 'ADMIN' || currentUser?.role === 'ADMIN').map(r=><option key={r}>{r}</option>)}
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

            <div className="col-span-2 border rounded-lg p-3" style={{borderColor: dark?'#475569':'#e5e7eb', backgroundColor: dark?'#0f172a':'#f9fafb'}}>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold" style={{color: dark?'#e2e8f0':'#374151'}}>Approval flow (steps)</label>
                <span className="text-xs" style={{color: dark?'#94a3b8':'#9ca3af'}}>{(form.approvalFlow||[]).length} step(s)</span>
              </div>
              <p className="text-xs mb-3" style={{color: dark?'#94a3b8':'#6b7280'}}>
                Each step is one stage of approval. Within a step, choose whether <b>any one</b> person can approve (OR) or <b>all</b> of them must (AND). Add more people to a step, and add more steps for multi-level approval.
              </p>

              {(form.approvalFlow||[]).map((step, si) => (
                <div key={si} className="mb-3 rounded-lg border p-2.5" style={{borderColor: dark?'#475569':'#e5e7eb', backgroundColor: dark?'#1e293b':'#ffffff'}}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold" style={{color:settings?.primaryColor||'#1D9E75'}}>Step {si+1}</span>
                    <div className="flex items-center gap-2">
                      <select value={step.rule}
                        onChange={e=>{ const f=[...form.approvalFlow]; f[si]={...f[si],rule:e.target.value}; setF('approvalFlow',f); }}
                        className="px-2 py-1 border rounded-lg text-xs"
                        style={{backgroundColor: dark?'#0f172a':'#ffffff', borderColor: dark?'#475569':'#e5e7eb', color: dark?'#f1f5f9':'#1f2937'}}>
                        <option value="ANY">Any one approves (OR)</option>
                        <option value="ALL">All must approve (AND)</option>
                      </select>
                      <button type="button"
                        onClick={()=>setF('approvalFlow',form.approvalFlow.filter((_,idx)=>idx!==si))}
                        className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Remove step</button>
                    </div>
                  </div>

                  {(step.approvers||[]).map((id, ai) => (
                    <div key={ai} className="flex items-center gap-2 mb-1.5">
                      <select value={id}
                        onChange={e=>{ const f=[...form.approvalFlow]; const ap=[...f[si].approvers]; ap[ai]=e.target.value; f[si]={...f[si],approvers:ap}; setF('approvalFlow',f); }}
                        className="flex-1 px-3 py-2 border rounded-lg text-sm"
                        style={{backgroundColor: dark?'#0f172a':'#ffffff', borderColor: dark?'#475569':'#e5e7eb', color: dark?'#f1f5f9':'#1f2937'}}>
                        <option value="">— Select approver —</option>
                        {managers.filter(m=>m.id!==editUser?.id && (!(step.approvers||[]).includes(m.id) || m.id===id))
                          .map(m=><option key={m.id} value={m.id}>{fullName(m)} ({m.role})</option>)}
                      </select>
                      <button type="button"
                        onClick={()=>{ const f=[...form.approvalFlow]; f[si]={...f[si],approvers:f[si].approvers.filter((_,idx)=>idx!==ai)}; setF('approvalFlow',f); }}
                        className="text-xs px-2 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">✕</button>
                    </div>
                  ))}

                  <button type="button"
                    onClick={()=>{ const f=[...form.approvalFlow]; f[si]={...f[si],approvers:[...(f[si].approvers||[]),'']}; setF('approvalFlow',f); }}
                    className="text-xs px-2.5 py-1 border rounded-lg mt-1"
                    style={{borderColor: dark?'#475569':'#d1d5db', color: dark?'#cbd5e1':'#4b5563'}}>
                    + Add person to this step
                  </button>
                </div>
              ))}

              <button type="button"
                onClick={()=>setF('approvalFlow',[...(form.approvalFlow||[]), { approvers:[''], rule:'ANY' }])}
                className="text-xs px-3 py-1.5 rounded-lg mb-3 text-white font-medium"
                style={{backgroundColor: settings?.primaryColor||'#1D9E75', color: 'var(--brand-contrast,#fff)'}}>
                + Add step
              </button>

              {(form.approvalFlow||[]).length === 0 && (
                <p className="text-xs mb-3" style={{color:'#d97706'}}>No approval steps — this employee's expenses will be auto-approved on submission.</p>
              )}

              <div className="mt-1">
                <label className="block text-xs mb-1" style={{color: dark?'#94a3b8':'#6b7280'}}>How steps run</label>
                <select value={form.approvalMode} onChange={e=>setF('approvalMode',e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  style={{backgroundColor: dark?'#1e293b':'#ffffff', borderColor: dark?'#475569':'#e5e7eb', color: dark?'#f1f5f9':'#1f2937'}}>
                  <option value="SEQUENTIAL">Sequential — step 1, then 2, then 3…</option>
                  <option value="ANY_ORDER">All at once — every step open simultaneously</option>
                </select>
              </div>
            </div>


          </div>
          {msg.text && <div className={`mt-3 px-3 py-2 rounded-lg text-sm border ${msg.ok?'bg-green-50 text-green-700 border-green-100':'bg-red-50 text-red-700 border-red-100'}`}>{msg.text}</div>}
          <div className="flex gap-3 mt-4 flex-wrap">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              style={{background:settings?.primaryColor||'#1D9E75', color: 'var(--brand-contrast,#fff)'}}>
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
            <button onClick={() => setTab('list')} className="text-sm font-medium px-3 py-1.5 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 shadow-sm">✕ Close</button>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 mb-3 text-xs text-gray-600">
            <p className="font-medium mb-1">CSV format (default password: <code className="bg-white px-1 rounded">{settings?.defaultPassword||'Welcome123'}</code>):</p>
            <code>employeeNumber,lastName,firstName,email,password,role,department,costCenter,position</code>
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
            style={{background:settings?.primaryColor||'#1D9E75', color: 'var(--brand-contrast,#fff)'}}>
            {bulkLoading ? 'Uploading...' : `Upload ${parseBulk(bulkText).length||0} users`}
          </button>

          {/* ---- Bulk approver assignments (CSV / Excel) ---- */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <h2 className="text-sm font-medium text-gray-700 mb-1">Bulk assign approvers</h2>
            <div className="bg-gray-50 rounded-lg p-3 mb-3 text-xs text-gray-600">
              <p className="font-medium mb-1">Upload a CSV or Excel file. Columns:</p>
              <code className="break-all">employee_number, last_name, first_name, approver1_number … approver5_number, mode, rule</code>
              <p className="mt-1">Use employee numbers (e.g. EMP-001). approver1 becomes the employee's manager (approver #1); up to 5 approvers total. mode = SEQUENTIAL | ANY_ORDER. rule = ALL | ANY.</p>
            </div>
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={downloadApprTemplate} className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">⬇ Template</button>
              <button onClick={()=>apprFileRef.current.click()} disabled={apprLoading}
                className="px-3 py-2 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-60"
                style={{background:settings?.primaryColor||'#1D9E75', color: 'var(--brand-contrast,#fff)'}}>
                {apprLoading ? 'Uploading…' : '📂 Upload CSV / Excel'}
              </button>
              <input ref={apprFileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e=>handleApprUpload(e.target.files[0])} />
            </div>
            {apprResult && (
              <div className="space-y-2">
                {apprResult.updated?.length>0 && <div className="px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-xs text-green-700">✅ Updated {apprResult.updated.length}: {apprResult.updated.map(u=>u.employee).join(', ')}</div>}
                {apprResult.errors?.length>0 && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">❌ {apprResult.errors.length} error(s): {apprResult.errors.map(e=>`row ${e.row||'?'} ${e.employee||''} (${e.reason})`).join('; ')}</div>}
              </div>
            )}
          </div>
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
            <button onClick={downloadEmployeeList} disabled={!filtered.length}
              className="ml-auto text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              title="Download the currently filtered list as CSV">
              ⬇ Download list
            </button>
            {currentUser?.role === 'ADMIN' && selectedIds.length > 0 && (
              <>
                <button onClick={sendCredentialsSelected} disabled={sendingCreds}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-60"
                  style={{ backgroundColor: settings?.primaryColor||'#1D9E75', color: 'var(--brand-contrast,#fff)' }}>
                  {sendingCreds ? 'Sending…' : `✉️ Send credentials (${selectedIds.length})`}
                </button>
                <button onClick={deleteSelected} disabled={deletingUsers}
                  className="text-xs px-3 py-1.5 rounded-lg text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: '#dc2626' }}>
                  {deletingUsers ? 'Deleting…' : `🗑 Delete selected (${selectedIds.length})`}
                </button>
              </>
            )}
          </div>

          {loading ? <div className="py-12 text-center text-sm text-gray-400">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-100">
                  {currentUser?.role === 'ADMIN' && (
                    <th className="px-4 py-3 text-left w-10">
                      <input type="checkbox" onChange={toggleSelectAll}
                        checked={deletableShown().length > 0 && deletableShown().every(u => selectedIds.includes(u.id))}
                        title="Select all" />
                    </th>
                  )}
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
                        {currentUser?.role === 'ADMIN' && (
                          <td className="px-4 py-3">
                            {(u.role !== 'ADMIN' && u.id !== currentUser?.id) ? (
                              <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={()=>toggleSelect(u.id)} />
                            ) : null}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                              style={{background: u.isActive ? (settings?.primaryColor||'#1D9E75') : '#9ca3af', color: u.isActive ? 'var(--brand-contrast,#fff)' : '#fff'}}>
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
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badgeFor(u.role)}`}>{u.role}</span>
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
                            {hasSendCredentialsAccess && (
                              <button onClick={() => sendCredentials(u)} disabled={sendingCredsId === u.id}
                                className="text-xs px-2 py-1 border border-teal-200 text-teal-700 rounded-lg hover:bg-teal-50 font-medium disabled:opacity-50"
                                title="Set a new temporary password and email it to this user with a link to the app">
                                {sendingCredsId === u.id ? 'Sending…' : '✉ Send credentials'}
                              </button>
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
