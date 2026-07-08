// src/pages/SettingsPage.jsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import toast from '../lib/toast';

const TABS = ['General','Branding','Categories','Expense Types','Vendors/Payees','Password','Email Templates','Access Control'];


// Separate component for Access Control tab
function AccessControlTab({ settings, navigate, refresh }) {
  const { user: acUser } = useAuth();
  const acIsAdmin = acUser?.role === 'ADMIN';
  // A non-admin managing access control must never see/grant these.
  const SENSITIVE_PERMS = ['manage_password', 'reset_passwords', 'send_credentials', 'manage_receipt_storage', 'upload_branding', 'change_branding', 'impersonate_user'];
  const DEFAULT_PERMS = {
    view_approvals: ['MANAGER','FINANCE','ADMIN'],
    approve_on_behalf: ['ADMIN'],
    view_reports: ['MANAGER','FINANCE','ADMIN'],
    view_analytics: ['FINANCE','ADMIN'],
    export_reports: ['MANAGER','FINANCE','ADMIN'],
    view_audit_log: ['ADMIN'],
    edit_categories: ['FINANCE','ADMIN'],
    manage_expense_types: ['FINANCE','ADMIN'],
    manage_ap_ar: ['FINANCE','ADMIN'],
    manage_settings: ['FINANCE','ADMIN'],
    manage_security: ['ADMIN'],
    manage_password: ['ADMIN'],
    manage_access_control: ['ADMIN'],
    manage_users: ['ADMIN'],
    toggle_access: ['ADMIN'],
    reset_passwords: ['ADMIN'],
    send_credentials: ['ADMIN'],
    manage_receipt_storage: ['ADMIN'],
    upload_branding: ['ADMIN'],
    change_branding: ['ADMIN'],
    impersonate_user: ['ADMIN'],
  };

  const PERM_LABELS = {
    view_approvals: 'Access My Approvals',
    approve_on_behalf: 'Approve on behalf of approvers (unblock stuck approvals)',
    view_reports: 'View reports',
    view_analytics: 'View analytics',
    export_reports: 'Export Excel reports',
    view_audit_log: 'View audit log',
    edit_categories: 'Edit categories & GL codes',
    manage_expense_types: 'Manage expense types',
    manage_ap_ar: 'Manage payables & receivables',
    manage_settings: 'Manage app settings',
    manage_security: 'Manage security (login lockout)',
    manage_password: 'View / set default password',
    manage_access_control: 'Manage access control',
    manage_users: 'Manage users',
    toggle_access: 'Activate / deactivate user access',
    reset_passwords: 'Reset any user password',
    send_credentials: 'Send login credentials to a user',
    manage_receipt_storage: 'Download / purge receipt storage',
    upload_branding: 'Upload logo & wallpaper',
    change_branding: 'Change colors & branding',
    impersonate_user: 'Login as / access user account',
  };

  const [perms, setPerms] = useState(() => {
    const ac = settings?.accessControl;
    return (ac && Object.keys(ac).length > 0) ? { ...DEFAULT_PERMS, ...ac } : DEFAULT_PERMS;
  });
  const [saved2, setSaved2] = useState(false);
  const [saving2, setSaving2] = useState(false);
  const [roles, setRoles] = useState(() => {
    const saved = settings?.accessControl?.__roles__;
    return (Array.isArray(saved) && saved.length) ? saved : ['EMPLOYEE','MANAGER','FINANCE','ADMIN'];
  });
  const [features, setFeatures] = useState(() => settings?.accessControl?.__features__ || {});
  const ROLES = roles;
  // Non-admins never see or edit the ADMIN column.
  const visibleRoles = acIsAdmin ? ROLES : ROLES.filter(r => r !== 'ADMIN');
  const LOCKED = ['ADMIN']; // Admin always has all perms
  const ROLE_COLORS = {
    EMPLOYEE:'bg-blue-600 text-white',
    MANAGER:'bg-purple-600 text-white',
    FINANCE:'bg-amber-500 text-white',
    ADMIN:'bg-green-600 text-white',
  };

  const toggle = (permKey, role) => {
    if (role === 'ADMIN') return; // Admin always has everything
    setPerms(prev => {
      const current = prev[permKey] || [];
      const next = current.includes(role) ? current.filter(r => r !== role) : [...current, role];
      // Ensure hierarchy: if EMPLOYEE has it, MANAGER should too etc.
      return { ...prev, [permKey]: next };
    });
  };

  // The permission rows currently visible in the matrix (sensitive perms are
  // hidden from non-admins). "Select all" / "None" only affect these.
  const visiblePermKeys = () => Object.keys(DEFAULT_PERMS).filter(key => acIsAdmin || !SENSITIVE_PERMS.includes(key));
  const setAllForRole = (role, grant) => {
    if (role === 'ADMIN') return; // Admin always has full access
    setPerms(prev => {
      const next = { ...prev };
      for (const key of visiblePermKeys()) {
        const cur = next[key] || [];
        if (grant) { if (!cur.includes(role)) next[key] = [...cur, role]; }
        else next[key] = cur.filter(r => r !== role);
      }
      return next;
    });
  };

  const savePerms = async () => {
    setSaving2(true);
    try {
      await api.patch('/settings', { accessControl: { ...perms, __roles__: roles, __features__: features } });
      if (refresh) refresh();
      setSaved2(true);
      setTimeout(() => setSaved2(false), 2000);
    } catch(e) {
      alert('Failed to save permissions. Please try again.');
    } finally {
      setSaving2(false);
    }
  };

  const resetPerms = async () => {
    setPerms(DEFAULT_PERMS);
    setRoles(['EMPLOYEE','MANAGER','FINANCE','ADMIN']);
    try {
      await api.patch('/settings', { accessControl: { ...DEFAULT_PERMS, __roles__: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'], __features__: features } });
      if (refresh) refresh();
    } catch(e) {}
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium text-gray-700">Role permissions</h2>
        <div className="flex gap-2">
          <button onClick={resetPerms} className="px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg text-xs hover:bg-gray-50">Reset</button>
          <button onClick={savePerms}
            className={`px-3 py-1.5 text-white rounded-lg text-xs font-medium transition-colors ${saved2 ? 'bg-green-500' : 'hover:opacity-90'}`}
            style={saved2 ? {} : {backgroundColor: settings?.primaryColor||'#1D9E75'}}>
            {saving2 ? 'Saving…' : saved2 ? '✓ Saved!' : 'Save'}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-3">Check/uncheck to configure which roles can access each feature. ADMIN always has full access.</p>
      
      {/* Add custom role */}
      <div className="flex gap-2 mb-4">
        <input
          id="new-role-input"
          placeholder="New role name (e.g. SUPERVISOR)"
          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-brand-400 uppercase"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const val = e.target.value.trim().toUpperCase().replace(/\s+/g,'_');
              if (val && !ROLES.includes(val)) {
                setRoles(r => [...r, val]);
                setPerms(p => {
                  const np = {...p};
                  Object.keys(np).forEach(k => { /* don't auto-grant */ });
                  return np;
                });
                e.target.value = '';
              }
            }
          }}
        />
        <button
          onClick={() => {
            const input = document.getElementById('new-role-input');
            const val = input.value.trim().toUpperCase().replace(/\s+/g,'_');
            if (val && !ROLES.includes(val)) {
              setRoles(r => [...r, val]);
              input.value = '';
            }
          }}
          className="px-3 py-1.5 text-white rounded-lg text-xs font-medium hover:opacity-90"
          style={{backgroundColor: settings?.primaryColor||'#1D9E75'}}>
          + Add role
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b" style={{backgroundColor:'#1e293b'}}>
              <th className="text-left py-3 px-4 font-bold text-white">Permission</th>
              {visibleRoles.map(r => {
                const isDefault = ['EMPLOYEE','MANAGER','FINANCE','ADMIN'].includes(r);
                return (
                  <th key={r} className="text-center py-3 px-3 min-w-[90px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[r] || 'bg-gray-100 text-gray-700 border border-gray-200'}`}>{r}</span>
                      {r !== 'ADMIN' && (
                        <div className="flex items-center gap-1 leading-none">
                          <button onClick={() => setAllForRole(r, true)} title={`Grant all permissions to ${r}`}
                            className="text-[10px] text-green-300 hover:text-green-200 hover:underline">All</button>
                          <span className="text-[10px] text-gray-500">/</span>
                          <button onClick={() => setAllForRole(r, false)} title={`Remove all permissions from ${r}`}
                            className="text-[10px] text-gray-400 hover:text-gray-200 hover:underline">None</button>
                        </div>
                      )}
                      {!isDefault && (
                        <button onClick={() => setRoles(rs => rs.filter(x => x !== r))}
                          className="text-red-400 hover:text-red-600 text-xs leading-none">✕</button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Object.keys(DEFAULT_PERMS).filter(key => acIsAdmin || !SENSITIVE_PERMS.includes(key)).map((key, i) => (
              <tr key={key} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                <td className="py-2.5 px-4 font-semibold" style={{color:'#111827'}}>{PERM_LABELS[key]}</td>
                {visibleRoles.map(role => {
                  const hasAccess = (perms[key] || []).includes(role);
                  const isAdmin = role === 'ADMIN';
                  return (
                    <td key={role} className="text-center py-2.5 px-3">
                      <button
                        onClick={() => toggle(key, role)}
                        disabled={isAdmin}
                        title={isAdmin ? 'Admin always has full access' : (hasAccess ? 'Click to remove access' : 'Click to grant access')}
                        className={`w-6 h-6 rounded flex items-center justify-center mx-auto transition-all ${
                          isAdmin
                            ? 'bg-green-100 text-green-600 cursor-default'
                            : hasAccess
                              ? 'bg-green-500 text-white hover:bg-red-400 cursor-pointer shadow-sm'
                              : 'bg-gray-100 text-gray-300 hover:bg-green-100 hover:text-green-500 cursor-pointer'
                        }`}>
                        {hasAccess || isAdmin ? '✓' : '✗'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 p-4 bg-blue-600 rounded-xl">
        <p className="text-xs font-bold text-white mb-1">🔐 User login access</p>
        <p className="text-xs text-blue-100 mb-3">To block or restore a user's login, go to Users and click their <strong>Active/Inactive</strong> badge. Use <strong>Reset pwd</strong> to change their password.</p>
        <button onClick={() => navigate('/users')}
          className="px-4 py-2 text-white rounded-lg text-xs font-medium hover:opacity-90"
          style={{backgroundColor: settings?.primaryColor||'#1D9E75'}}>
          → Manage users & access
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, refresh, applyTheme } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('General');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const logoRef = useRef();
  const wallpaperRef = useRef();

  const isFinance = ['FINANCE','ADMIN'].includes(user?.role);
  const isAdmin = user?.role === 'ADMIN';
  // Permission checks driven by Access Control (ADMIN always allowed).
  const can = (permKey, fallback) => {
    if (user?.role === 'ADMIN') return true;
    return (settings?.accessControl?.[permKey] || fallback).includes(user?.role);
  };
  const canEditCategories = can('edit_categories', ['FINANCE','ADMIN']);
  const canUploadBranding = can('upload_branding', ['ADMIN']);
  const canChangeBranding = can('change_branding', ['ADMIN']);
  const canSeeBranding = canUploadBranding || canChangeBranding;
  const canManageSettings = can('manage_settings', ['FINANCE','ADMIN']);
  const canExpenseTypes = can('manage_expense_types', ['FINANCE','ADMIN']);
  const canPassword = can('manage_password', ['ADMIN']);
  const canAccessControl = can('manage_access_control', ['ADMIN']);
  const canSecurity = can('manage_security', ['ADMIN']);
  const canSettingsManage = can('manage_settings', ['FINANCE', 'ADMIN']);
  const canReceiptStorage = can('manage_receipt_storage', ['ADMIN']);
  const canApAr = can('manage_ap_ar', ['FINANCE','ADMIN']);

  // Exchange rate (USD -> PHP) — separate from the main settings form.
  const [fx, setFx] = useState(null);          // { usdPhpRate, auto, updatedAt }
  const [fxRateInput, setFxRateInput] = useState('');
  const [fxBusy, setFxBusy] = useState(false);
  const [fxMsg, setFxMsg] = useState('');

  useEffect(() => {
    api.get('/settings/exchange-rate').then(r => { setFx(r); setFxRateInput(String(r.usdPhpRate)); }).catch(() => {});
  }, []);

  const saveFxManual = async () => {
    setFxBusy(true); setFxMsg('');
    try {
      const r = await api.patch('/settings/exchange-rate', { usdPhpRate: Number(fxRateInput), auto: false });
      setFx(r); setFxRateInput(String(r.usdPhpRate)); setFxMsg('✅ Manual rate saved'); toast.success('Exchange rate saved');
    } catch (e) { setFxMsg('❌ ' + (e.error || 'Failed')); }
    finally { setFxBusy(false); }
  };
  const enableAuto = async () => {
    setFxBusy(true); setFxMsg('');
    try {
      const r = await api.patch('/settings/exchange-rate', { auto: true });
      setFx(r); setFxRateInput(String(r.usdPhpRate)); setFxMsg('✅ Auto-update enabled');
    } catch (e) { setFxMsg('❌ ' + (e.error || 'Failed')); }
    finally { setFxBusy(false); }
  };
  const refreshNow = async () => {
    setFxBusy(true); setFxMsg('');
    try {
      const r = await api.post('/settings/exchange-rate/refresh', {});
      if (r.error) setFxMsg('❌ ' + r.error);
      else { const cur = await api.get('/settings/exchange-rate'); setFx(cur); setFxRateInput(String(cur.usdPhpRate)); setFxMsg('✅ Rate refreshed'); toast.success('Exchange rate refreshed'); }
    } catch (e) { setFxMsg('❌ ' + (e.error || 'Failed')); }
    finally { setFxBusy(false); }
  };

  const s = form || settings;
  const set = (k,v) => setForm(f=>({...(f||settings),[k]:v}));

  const cats = Array.isArray(s?.categories) ? s.categories : (s?.categories?.split(',').map(c=>c.trim())||[]);
  const types = Array.isArray(s?.expenseTypes) ? s.expenseTypes : (s?.expenseTypes?.split(',').map(t=>t.trim())||[]);
  const glCodes = s?.categoryGlCodes || {};
  const catTypes = s?.categoryTypes || {};

  const save = async () => {
    setSaving(true);
    try {
      // Only send fields relevant to current tab to avoid overwriting others
      const payload = {
        companyName: s.companyName,
        tin: s.tin ?? settings?.tin,
        defaultCurrency: s.defaultCurrency,
        approvalLevels: s.approvalLevels,
        primaryColor: s.primaryColor,
        darkMode: s.darkMode ?? settings?.darkMode,
        categories: cats,
        expenseTypes: types,
        categoryGlCodes: glCodes,
        categoryTypes: catTypes,
        defaultPassword: s.defaultPassword,
        wallpaperStyle: s.wallpaperStyle ?? settings?.wallpaperStyle,
        autoReapplyApprovalFlow: s.autoReapplyApprovalFlow ?? settings?.autoReapplyApprovalFlow,
        loginMaxAttempts: s.loginMaxAttempts ?? settings?.loginMaxAttempts,
        loginLockoutMinutes: s.loginLockoutMinutes ?? settings?.loginLockoutMinutes,
        vendors: Array.isArray(s?.vendors) ? s.vendors : (settings?.vendors || []),
        companyAddress: s.companyAddress ?? settings?.companyAddress,
        companyZip: s.companyZip ?? settings?.companyZip,
        signatoryName: s.signatoryName ?? settings?.signatoryName,
        signatoryTitle: s.signatoryTitle ?? settings?.signatoryTitle,
        signatoryTin: s.signatoryTin ?? settings?.signatoryTin,
        atcCodes: Array.isArray(s?.atcCodes) ? s.atcCodes : (settings?.atcCodes || []),
      };
      const updated = await api.patch('/settings', payload);
      applyTheme(updated);
      refresh();
      setMsg('✅ Settings saved!'); toast.success('Settings saved');
      setForm(null);
      setTimeout(() => setMsg(''), 3000);
    } catch(err) { setMsg('❌ ' + (err.error||'Failed')); }
    finally { setSaving(false); }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('logo', file);
    try { await api.post('/settings/logo', fd, {headers:{'Content-Type':'multipart/form-data'}}); refresh(); setMsg('✅ Logo updated!'); setTimeout(()=>setMsg(''),3000); }
    catch(err) { setMsg('❌ Failed to upload logo'); }
  };

  const uploadWallpaper = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('wallpaper', file);
    try {
      const res = await api.post('/settings/wallpaper', fd, {headers:{'Content-Type':'multipart/form-data'}});
      // Apply immediately
      const newSettings = {...settings, wallpaperUrl: res.wallpaperUrl};
      applyTheme(newSettings);
      localStorage.setItem('xpense_theme', JSON.stringify(newSettings));
      refresh();
      setMsg('✅ Wallpaper updated!'); toast.success('Wallpaper updated');
      setTimeout(()=>setMsg(''),3000);
    }
    catch(err) { setMsg('❌ Failed to upload wallpaper'); }
  };

  const removeWallpaper = async () => {
    try {
      await api.delete('/settings/wallpaper');
      const newSettings = {...settings, wallpaperUrl: null};
      applyTheme(newSettings);
      localStorage.setItem('xpense_theme', JSON.stringify(newSettings));
      refresh();
      setMsg('✅ Wallpaper removed'); toast.success('Wallpaper removed');
      setTimeout(()=>setMsg(''),2000);
    }
    catch(err) { setMsg('❌ Failed'); }
  };

  const addCat = () => set('categories', [...cats, '']);
  const removeCat = (i) => { const old=cats[i]; set('categories', cats.filter((_,idx)=>idx!==i)); const g={...glCodes}; delete g[old]; set('categoryGlCodes',g); const ty={...catTypes}; delete ty[old]; set('categoryTypes',ty); };
  const updateCat = (i,v) => { const old=cats[i]; const nv=v.toUpperCase(); const newCats=cats.map((c,idx)=>idx===i?nv:c); const g={...glCodes}; if(g[old]){g[nv]=g[old];delete g[old];} const ty={...catTypes}; if(ty[old]){ty[nv]=ty[old];delete ty[old];} set('categories',newCats); set('categoryGlCodes',g); set('categoryTypes',ty); };
  const updateGl = (cat,v) => set('categoryGlCodes',{...glCodes,[cat]:v});
  const updateType = (cat,v) => set('categoryTypes',{...catTypes,[cat]:v});

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Organization configuration</p>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 flex-wrap">
        {TABS.filter(t => {
          if (t === 'Branding') return canSeeBranding;
          if (t === 'Expense Types') return canExpenseTypes;
          if (t === 'Password') return canPassword;
          if (t === 'Access Control') return canAccessControl;
          if (t === 'Email Templates') return canManageSettings;
          if (t === 'Vendors/Payees') return canApAr || canManageSettings;
          return true; // General, Categories
        }).map(t => (
          <button key={t} onClick={()=>setTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${tab===t?'bg-white font-medium shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">

        {tab === 'General' && (<>
          <fieldset disabled={!canManageSettings} className={!canManageSettings ? 'opacity-60' : ''}>
          {!canManageSettings && <p className="text-xs text-amber-600 mb-3">You have view-only access to general settings.</p>}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-700 mb-3">General settings</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Company name</label>
              <input value={s?.companyName||''} onChange={e=>set('companyName',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Employer TIN</label>
              <input value={s?.tin||''} placeholder="123-456-789-012"
                onChange={e=>{
                  const digits = e.target.value.replace(/\D/g,'').slice(0,12);
                  const groups = digits.match(/.{1,3}/g) || [];
                  set('tin', groups.join('-'));
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              <p className="text-xs text-gray-400 mt-1">Format: XXX-XXX-XXX-XXX (auto-formatted as you type). Shown at the top of the app.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Registered address <span className="text-gray-400">(for BIR 2307 — Payor)</span></label>
              <input value={s?.companyAddress||''} placeholder="Unit/Bldg, Street, Barangay, City/Municipality, Province"
                onChange={e=>set('companyAddress', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ZIP code</label>
                <input value={s?.companyZip||''} placeholder="1600" onChange={e=>set('companyZip', e.target.value.replace(/\D/g,'').slice(0,4))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Signatory name <span className="text-gray-400">(2307)</span></label>
                <input value={s?.signatoryName||''} placeholder="Juan Dela Cruz" onChange={e=>set('signatoryName', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Signatory title</label>
                <input value={s?.signatoryTitle||''} placeholder="Finance Officer" onChange={e=>set('signatoryTitle', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Signatory TIN <span className="text-gray-400">(2307 — signatory's own TIN)</span></label>
                <input value={s?.signatoryTin||''} placeholder="000-000-000-000" onChange={e=>set('signatoryTin', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default currency</label>
              <select value={s?.defaultCurrency||'PHP'} onChange={e=>set('defaultCurrency',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="PHP">PHP — Philippine Peso (₱)</option>
                <option value="USD">USD — US Dollar ($)</option>
              </select>
            </div>

            {/* USD -> PHP exchange rate */}
            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-gray-700">USD → PHP exchange rate</p>
                <span className="text-xs px-2.5 py-1 rounded-full font-bold text-white"
                  style={{ backgroundColor: fx?.auto ? '#16a34a' : '#f59e0b' }}>
                  {fx?.auto ? 'Auto-updating' : 'Manual'}
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900">₱{fx ? Number(fx.usdPhpRate).toFixed(4) : '—'} <span className="text-sm font-normal text-gray-400">= $1</span></p>
              <p className="text-xs text-gray-400 mt-0.5">
                {fx?.updatedAt ? `Last updated ${new Date(fx.updatedAt).toLocaleString('en-PH')}` : 'Not yet updated'}
              </p>

              {canManageSettings && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Set rate manually (e.g. official BSP reference rate)</label>
                      <input type="number" step="0.0001" value={fxRateInput} onChange={e=>setFxRateInput(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
                    </div>
                    <button onClick={saveFxManual} disabled={fxBusy}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: '#2563eb' }}>
                      Save manual
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={enableAuto} disabled={fxBusy || fx?.auto}
                      className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      Use auto-update
                    </button>
                    <button onClick={refreshNow} disabled={fxBusy}
                      className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      ↻ Refresh now
                    </button>
                    {fxMsg && <span className="text-xs text-gray-500">{fxMsg}</span>}
                  </div>
                  <p className="text-xs text-gray-400">
                    Auto-update pulls a live market rate (close to BSP) daily. BSP has no free public feed, so for the exact official reference rate, switch to Manual and enter BSP's published number.
                  </p>
                </div>
              )}
            </div>

            {/* Auto re-apply approval flow */}
            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-3">
                  <p className="text-sm font-medium text-gray-700">Auto re-apply approval flow</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    When ON, editing an employee's approvers/manager/order/rule automatically re-routes their already-pending expenses to the new flow. When OFF, only newly submitted expenses use the new flow (you can still re-apply manually per employee).
                  </p>
                </div>
                <button onClick={()=>set('autoReapplyApprovalFlow', !s?.autoReapplyApprovalFlow)}
                  className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${s?.autoReapplyApprovalFlow?'bg-green-600':'bg-gray-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${s?.autoReapplyApprovalFlow?'translate-x-7':'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
          </fieldset>
          {canSecurity && (
            <div className="mt-6 p-4 rounded-xl border border-gray-100 bg-gray-50">
              <h2 className="text-sm font-medium text-gray-700 mb-1">Login security</h2>
              <p className="text-xs text-gray-500 mb-3">Lock an account after too many failed sign-in attempts. A locked user can wait out the timer, reset via "Forgot password", or be reset by Finance/Admin.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Max failed attempts (0 = no lockout)</label>
                  <input type="number" min="0" value={s?.loginMaxAttempts ?? 5}
                    onChange={e => set('loginMaxAttempts', e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Lockout duration (minutes)</label>
                  <input type="number" min="1" value={s?.loginLockoutMinutes ?? 15}
                    onChange={e => set('loginLockoutMinutes', e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
            </div>
          )}
          {canSettingsManage && <EmailNotificationsCard settings={settings} />}
          {canSettingsManage && <ReminderSettingsCard settings={settings} />}
          {canSecurity && <PayoutReversalCard settings={settings} />}
          {canReceiptStorage && <ReceiptStorageCard />}
        </>)}

        {tab === 'Branding' && canSeeBranding && (
          <div className="space-y-5">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Branding & appearance</h2>
            {/* Logo */}
            {canUploadBranding && (
            <div>
              <label className="block text-xs text-gray-500 mb-2">Company logo</label>
              <div className="flex items-center gap-4">
                {s?.logoUrl ? <img src={s.logoUrl} alt="Logo" className="w-16 h-16 rounded-xl object-cover border border-gray-100" /> :
                  <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-xs">Logo</div>}
                <div>
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
                  <button onClick={()=>logoRef.current.click()} className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Upload logo</button>
                  <p className="text-xs text-gray-400 mt-1">PNG or JPG, max 2MB</p>
                </div>
              </div>
            </div>
            )}
            {/* Color */}
            {canChangeBranding && (
            <div>
              <label className="block text-xs text-gray-500 mb-2">Primary color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={s?.primaryColor||'#1D9E75'} onChange={e=>set('primaryColor',e.target.value)}
                  className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer p-1" />
                <input value={s?.primaryColor||'#1D9E75'} onChange={e=>set('primaryColor',e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none font-mono" />
                <div className="w-10 h-10 rounded-lg" style={{backgroundColor:s?.primaryColor||'#1D9E75'}} />
              </div>
              <div className="flex gap-2 mt-2">
                {['#1D9E75','#2563EB','#7C3AED','#DC2626','#D97706','#0F172A','#EC4899','#0EA5E9'].map(c => (
                  <button key={c} onClick={()=>set('primaryColor',c)}
                    className="w-7 h-7 rounded-lg border-2 border-white shadow hover:scale-110 transition-transform"
                    style={{backgroundColor:c}} />
                ))}
              </div>
            </div>
            )}
            {/* Wallpaper */}
            {canUploadBranding && (
            <div>
              <label className="block text-xs text-gray-500 mb-2">App wallpaper / background</label>
              {s?.wallpaperUrl ? (
                <div className="flex items-center gap-3">
                  <img src={s.wallpaperUrl} alt="Wallpaper" className="w-24 h-16 rounded-lg object-cover border border-gray-100" />
                  <div>
                    <button onClick={()=>wallpaperRef.current.click()} className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 mr-2">Change</button>
                    <button onClick={removeWallpaper} className="px-3 py-2 border border-red-100 text-red-600 rounded-lg text-sm hover:bg-red-50">Remove</button>
                  </div>
                </div>
              ) : (
                <button onClick={()=>wallpaperRef.current.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl py-4 text-center hover:border-brand-400 hover:bg-brand-50 transition-colors text-sm text-gray-400">
                  🖼️ Upload wallpaper image
                </button>
              )}
              <input ref={wallpaperRef} type="file" accept="image/*" className="hidden" onChange={uploadWallpaper} />
              <p className="text-xs text-gray-400 mt-1">JPG or PNG, max 5MB. Appears as the app background.</p>

              {s?.wallpaperUrl && (
                <div className="mt-3">
                  <label className="block text-xs text-gray-500 mb-1">Wallpaper style</label>
                  <select value={s?.wallpaperStyle || 'cover'} onChange={e=>set('wallpaperStyle', e.target.value)}
                    className="w-full md:w-64 px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    <option value="cover">Cover (fill screen)</option>
                    <option value="stretch">Stretch (fit exactly)</option>
                    <option value="center">Center (actual size)</option>
                    <option value="tile-small">Tile — small</option>
                    <option value="tile-big">Tile — big</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Tiling repeats the image as a pattern. Save to apply.</p>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {tab === 'Categories' && (isFinance || isAdmin) && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700">Expense categories & GL codes</h2>
              {canEditCategories && (
              <div className="flex gap-2">
                <button onClick={async () => {
                  await api.post('/settings/reset-categories');
                  refresh();
                  window.location.reload();
                }} className="px-3 py-1.5 text-xs border border-amber-200 text-amber-600 rounded-lg hover:bg-amber-50">↺ Reset to defaults</button>
                <button onClick={addCat} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add</button>
              </div>
              )}
            </div>
            <div className="space-y-2">
              {cats.map((cat, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={cat} onChange={e=>updateCat(i,e.target.value)} placeholder="Category name" disabled={!canEditCategories}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 uppercase disabled:bg-gray-50 disabled:text-gray-500" />
                  <input value={glCodes[cat]||''} onChange={e=>updateGl(cat,e.target.value)} placeholder="GL code" disabled={!canEditCategories}
                    className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 font-mono disabled:bg-gray-50 disabled:text-gray-500" />
                  <select value={catTypes[cat]||'BOTH'} onChange={e=>updateType(cat,e.target.value)} disabled={!canEditCategories}
                    className="w-44 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-500">
                    <option value="EXPENSE">Expense</option>
                    <option value="AP_AR">AP/AR Invoice</option>
                    <option value="BOTH">Both</option>
                  </select>
                  {canEditCategories && (
                    <button onClick={()=>removeCat(i)} className="px-2 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm">✕</button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">{canEditCategories ? 'GL code is the General Ledger account code for accounting integration.' : 'You have view-only access to categories.'}</p>
          </div>
        )}

        {tab === 'Expense Types' && canExpenseTypes && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700">Expense types</h2>
              <button onClick={()=>set('expenseTypes',[...types,''])} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add</button>
            </div>
            <div className="space-y-2">
              {types.map((type, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={type} onChange={e=>set('expenseTypes',types.map((t,idx)=>idx===i?e.target.value.toUpperCase():t))}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 uppercase" />
                  <button onClick={()=>set('expenseTypes',types.filter((_,idx)=>idx!==i))}
                    className="px-2 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Vendors/Payees' && (canApAr || canManageSettings) && (() => {
          const vlist = Array.isArray(s?.vendors) ? s.vendors : (settings?.vendors || []);
          const upd = (i, key, val) => set('vendors', vlist.map((v, idx) => idx === i ? { ...v, [key]: val } : v));
          return (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-gray-700">Vendors / Payees</h2>
                <button onClick={() => set('vendors', [...vlist, { name: '', tin: '' }])}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add vendor</button>
              </div>
              {vlist.length === 0 && <p className="text-xs text-gray-400 mb-2">No vendors yet. Add vendors here so they appear in the Add Document dropdown.</p>}
              <div className="space-y-2">
                {vlist.map((v, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-lg p-2">
                    <input value={v.name || ''} onChange={e => upd(i, 'name', e.target.value)} placeholder="Vendor / payee name"
                      className="flex-1 min-w-[160px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
                    <select value={v.type || 'COMPANY'} onChange={e => upd(i, 'type', e.target.value)}
                      className="w-40 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand-400">
                      <option value="COMPANY">Company/Payee</option>
                      <option value="GOVERNMENT">Government</option>
                      <option value="LGU">LGU</option>
                    </select>
                    <input value={v.tin || ''} onChange={e => upd(i, 'tin', e.target.value)} placeholder="TIN (optional)"
                      className="w-36 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 font-mono" />
                    <button onClick={() => set('vendors', vlist.filter((_, idx) => idx !== i))}
                      className="px-2 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm">✕</button>
                    <input value={v.address || ''} onChange={e => upd(i, 'address', e.target.value)} placeholder="Registered address (for BIR 2307)"
                      className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
                    <input value={v.zip || ''} onChange={e => upd(i, 'zip', e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="ZIP"
                      className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">These appear in the AP/AR "Add Document" Vendor/Payee dropdown. Type controls which fields show (Government hides Vendor TIN, Doc/OR no., and PO no.). Users can still pick "Others" to type a name manually. Remember to click Save.</p>

              {/* ATC codes for BIR 2307 / EWT */}
              {(() => {
                const alist = Array.isArray(s?.atcCodes) ? s.atcCodes : (settings?.atcCodes || []);
                const aupd = (i, key, val) => set('atcCodes', alist.map((a, idx) => idx === i ? { ...a, [key]: val } : a));
                return (
                  <div className="mt-8 pt-6 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-medium text-gray-700">ATC codes &amp; EWT rates <span className="text-gray-400 font-normal">(for BIR 2307)</span></h2>
                      <button onClick={() => set('atcCodes', [...alist, { code: '', description: '', rate: 0 }])}
                        className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add ATC</button>
                    </div>
                    {alist.length === 0 && <p className="text-xs text-gray-400 mb-2">Add the ATCs your company uses (e.g. WC158 — goods 1%, WC160 — services 2%). These populate the ATC dropdown on AP invoices and auto-fill the EWT rate.</p>}
                    <div className="space-y-2">
                      {alist.map((a, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-lg p-2">
                          <input value={a.code || ''} onChange={e => aupd(i, 'code', e.target.value.toUpperCase())} placeholder="ATC (e.g. WC160)"
                            className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 font-mono" />
                          <input value={a.description || ''} onChange={e => aupd(i, 'description', e.target.value)} placeholder="Description (e.g. Services — regular supplier)"
                            className="flex-1 min-w-[180px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
                          <div className="flex items-center gap-1">
                            <input type="number" step="0.01" value={a.rate ?? ''} onChange={e => aupd(i, 'rate', e.target.value === '' ? '' : Number(e.target.value))} placeholder="Rate"
                              className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
                            <span className="text-sm text-gray-400">%</span>
                          </div>
                          <button onClick={() => set('atcCodes', alist.filter((_, idx) => idx !== i))}
                            className="px-2 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm">✕</button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">⚠️ Verify the exact ATC codes and rates with your accountant/BIR. Common under RR 11-2018: goods 1%, services 2% for regular suppliers.</p>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {tab === 'Password' && canPassword && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-4">Password manager</h2>
            <div className="bg-amber-500 border border-amber-600 rounded-lg p-3 mb-4 text-xs text-white font-medium">
              ⚠️ This default password will be used when creating new users via Add User or Bulk Upload. Users should change it on first login.
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default password for new users</label>
              <input type="text" value={s?.defaultPassword||'Welcome123'} onChange={e=>set('defaultPassword',e.target.value)}
                placeholder="e.g. Welcome@2024"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 font-mono" />
              <p className="text-xs text-gray-400 mt-1">Minimum 6 characters. This is shown when adding users so admins can share it with new employees.</p>
            </div>
            <div className="mt-4 p-3 bg-gray-800 rounded-lg border border-gray-600">
              <p className="text-xs font-medium text-gray-300 mb-1">Current default password:</p>
              <code className="text-sm font-mono text-white">{s?.defaultPassword||'Welcome123'}</code>
            </div>
          </div>
        )}

        {tab === 'Access Control' && canAccessControl && <AccessControlTab settings={settings} navigate={navigate} refresh={refresh} />}
        {tab === 'Email Templates' && canManageSettings && <EmailTemplatesTab settings={settings} refresh={refresh} brand={settings?.primaryColor||'#1D9E75'} />}

        {msg && <div className={`mt-4 px-3 py-2 rounded-lg text-sm border ${msg.startsWith('✅')?'bg-green-50 text-green-700 border-green-100':'bg-red-50 text-red-700 border-red-100'}`}>{msg}</div>}

        {tab !== 'Access Control' && tab !== 'Email Templates' && (
          <button onClick={save} disabled={saving}
            className="mt-5 w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
            style={{backgroundColor:settings?.primaryColor||'#1D9E75'}}>
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        )}
      </div>
    </div>
  );
}

function EmailNotificationsCard({ settings }) {
  const [on, setOn] = useState(settings?.emailNotificationsEnabled !== false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const apply = async (next) => {
    setOn(next); setSaving(true); setMsg(null);
    try {
      await api.patch('/settings', { emailNotificationsEnabled: next });
      setMsg({ ok: true, text: next ? 'Notifications ON' : 'Notifications OFF' });
    } catch (e) { setOn(!next); setMsg({ ok: false, text: e.error || 'Failed' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-6 p-4 rounded-xl border border-gray-100 bg-gray-50">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-1">Email notifications</h2>
          <p className="text-xs text-gray-500">Master switch for automated emails (approval requests + status updates like approved/returned/processed/reprocessing). Turn OFF during testing so staff don't get real emails. Password resets and credential emails are not affected.</p>
        </div>
        <button onClick={() => apply(!on)} disabled={saving} role="switch" aria-checked={on}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${on ? '' : 'bg-gray-300'}`}
          style={on ? { backgroundColor: 'var(--brand-color,#1D9E75)' } : {}}>
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {msg && <p className={`text-xs mt-2 ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.ok ? '✓ ' : '✕ '}{msg.text}{msg.ok ? ' — saved.' : ''}</p>}
    </div>
  );
}

function EmailTestCard_REMOVED() { return null; }

const TIMEZONES = [
  'Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Shanghai',
  'Asia/Dubai', 'Asia/Kolkata', 'Australia/Sydney', 'Europe/London', 'Europe/Paris',
  'America/Los_Angeles', 'America/Chicago', 'America/New_York', 'UTC',
];

// Timezone (used for dates/times in emails) + automatic approval follow-up reminders.
function ReminderSettingsCard({ settings }) {
  const [tz, setTz] = useState(settings?.timezone || 'Asia/Manila');
  const [days, setDays] = useState(settings?.approvalFollowUpDays ?? 0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.patch('/settings', { timezone: tz, approvalFollowUpDays: Number(days) || 0 });
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e) { setMsg({ ok: false, text: e.error || 'Save failed.' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-6 p-4 rounded-xl border border-gray-100 bg-gray-50">
      <h2 className="text-sm font-medium text-gray-700 mb-1">Reminders &amp; timezone</h2>
      <p className="text-xs text-gray-500 mb-3">Timezone is used for dates/times shown in emails. Follow-up reminders email the current pending approver(s) when an expense has been waiting.</p>
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Timezone</label>
          <select value={tz} onChange={e => setTz(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            {TIMEZONES.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Follow-up reminder after (days)</label>
          <input type="number" min="0" value={days} onChange={e => setDays(e.target.value)}
            className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <p className="text-[11px] text-gray-400 mt-1">0 = off. Re-sends every N days while still pending.</p>
        </div>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.ok ? '✓ ' : '✕ '}{msg.text}</span>}
      </div>
    </div>
  );
}

// Choose which user(s) may "Undo" a processed payout in the Transactions tab.
// Empty list = Admins only.
function PayoutReversalCard({ settings }) {
  const [users, setUsers] = useState([]);
  const [ids, setIds] = useState(() => Array.isArray(settings?.payoutReversalUserIds) ? settings.payoutReversalUserIds : []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/users').then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const toggle = (id) => setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.patch('/settings', { payoutReversalUserIds: ids });
      setMsg({ ok: true, text: 'Saved. Changes apply on their next page load.' });
    } catch (e) { setMsg({ ok: false, text: e.error || 'Save failed.' }); }
    finally { setSaving(false); }
  };

  // Only Finance/Admin make sense as reversers.
  const eligible = users.filter(u => ['FINANCE', 'ADMIN'].includes(u.role));

  return (
    <div className="mt-6 p-4 rounded-xl border border-gray-100 bg-gray-50">
      <h2 className="text-sm font-medium text-gray-700 mb-1">Payout reversal access (Undo)</h2>
      <p className="text-xs text-gray-500 mb-3">Choose who can <b>Undo</b> a processed payout in the Transactions tab. Admins can always undo. If none are selected, only Admins can.</p>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white divide-y divide-gray-50">
        {eligible.length === 0 ? (
          <p className="text-xs text-gray-400 p-3">No Finance/Admin users found.</p>
        ) : eligible.map(u => (
          <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={ids.includes(u.id)} onChange={() => toggle(u.id)} className="w-4 h-4" />
            <span className="text-gray-800">{`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}</span>
            <span className="text-xs text-gray-400">· {u.role}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>
          {saving ? 'Saving…' : 'Save reversal access'}
        </button>
        <span className="text-xs text-gray-500">{ids.length} selected</span>
        {msg && <span className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.ok ? '✓ ' : '✕ '}{msg.text}</span>}
      </div>
    </div>
  );
}

const RS_API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
function ReceiptStorageCard() {
  const [stats, setStats] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [msg, setMsg] = useState(null);

  const loadStats = async () => {
    try { setStats(await api.get('/receipts/storage-stats')); } catch { setStats(null); }
  };
  useEffect(() => { loadStats(); }, []);

  const download = async () => {
    setDownloading(true); setMsg(null);
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(`${RS_API_BASE}/receipts/archive`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error('Download failed (' + resp.status + ')');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `receipts-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: 'Download started. Keep this backup safe before purging.' });
    } catch (e) { setMsg({ ok: false, text: e.message || 'Download failed.' }); }
    finally { setDownloading(false); }
  };

  const purge = async () => {
    if (confirmText !== 'PURGE') { setMsg({ ok: false, text: 'Type PURGE to confirm.' }); return; }
    if (!confirm('This permanently removes the stored receipt images (you should have downloaded the backup first). Continue?')) return;
    setPurging(true); setMsg(null);
    try {
      const res = await api.post('/receipts/purge', { confirm: 'PURGE' });
      setMsg({ ok: true, text: res.message || 'Purged.' });
      setConfirmText('');
      loadStats();
    } catch (e) { setMsg({ ok: false, text: e.error || 'Purge failed.' }); }
    finally { setPurging(false); }
  };

  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const purgeOrphans = async () => {
    if (!confirm('Delete all orphan receipts (uploads that were never attached to an expense)? This is safe — it does not touch receipts linked to expenses.')) return;
    setCleaningOrphans(true); setMsg(null);
    try {
      const res = await api.post('/receipts/purge-orphans', {});
      setMsg({ ok: true, text: res.message || 'Orphans deleted.' });
      loadStats();
    } catch (e) { setMsg({ ok: false, text: e.error || 'Cleanup failed.' }); }
    finally { setCleaningOrphans(false); }
  };

  return (
    <div className="mt-6 p-4 rounded-xl border border-gray-100 bg-gray-50">
      <h2 className="text-sm font-medium text-gray-700 mb-1">Receipt storage</h2>
      <p className="text-xs text-gray-500 mb-3">
        Download a backup of all receipt images, then purge them to free database space.
        Files are named <code>FullName_DateSubmitted_Status_StatusDate</code>.
      </p>
      {stats && (
        <p className="text-xs text-gray-500 mb-3">
          {stats.total} receipt(s) · {stats.withBytes} stored in database · {stats.inStorage} in object storage
          {typeof stats.orphans === 'number' ? <> · <b>{stats.orphans} orphan(s)</b> (not attached to any expense)</> : null}.
        </p>
      )}
      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={download} disabled={downloading}
          className="px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-color,#1D9E75)' }}>
          {downloading ? 'Preparing…' : '⬇ Download all receipts (ZIP)'}
        </button>
        <button onClick={purgeOrphans} disabled={cleaningOrphans || (stats && stats.orphans === 0)}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          title="Delete uploads that were never attached to an expense">
          {cleaningOrphans ? 'Cleaning…' : `🧹 Delete orphan receipts${stats && typeof stats.orphans === 'number' ? ` (${stats.orphans})` : ''}`}
        </button>
      </div>
      <div className="mt-4 pt-3 border-t border-gray-200">
        <p className="text-xs text-gray-500 mb-2">Danger zone — purge removes the stored images permanently.</p>
        <div className="flex gap-2 flex-wrap items-center">
          <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="Type PURGE"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-32" />
          <button onClick={purge} disabled={purging || confirmText !== 'PURGE'}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">
            {purging ? 'Purging…' : '🗑 Purge receipt images'}
          </button>
        </div>
      </div>
      {msg && <p className={`text-xs mt-3 ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.ok ? '✓ ' : '✕ '}{msg.text}</p>}
    </div>
  );
}

const EMP_VARS = ['{employeeName}','{employeeDept}','{employeePosition}','{employeeNumber}','{employeeEmail}'];
const EMAIL_TEMPLATE_DEFS = [
  { key: 'approval_request', label: 'Approval request', desc: 'Sent to an approver when an expense needs their approval. Employee tags refer to the submitter.',
    subject: 'Action required: Approve "{title}"', message: 'An expense from {employeeName} has been submitted and is waiting for your approval:',
    vars: ['{name}','{title}','{amount}','{category}','{date}', ...EMP_VARS] },
  { key: 'status_APPROVED', label: 'Status: Approved', desc: 'Sent to the submitter when their expense is fully approved.',
    subject: '✅ Expense approved — {title}', message: 'Hi {employeeName}, your expense has been fully approved and will be processed for reimbursement.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'status_REJECTED', label: 'Status: Rejected', desc: 'Sent when an expense is rejected.',
    subject: '❌ Expense rejected — {title}', message: 'Your expense was not approved. Please check the notes and resubmit if needed.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'status_RETURNED', label: 'Status: Returned', desc: 'Sent when an expense is returned for revision.',
    subject: '↩ Expense returned — {title}', message: 'Your approver returned this expense. Please review their comments and resubmit.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'status_MANAGER_APPROVED', label: 'Status: Manager approved', desc: 'Sent when a manager approves and it moves to finance.',
    subject: '✓ Manager approved — {title}', message: 'Your expense was approved by your manager and is now pending finance review.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'status_PROCESSED', label: 'Status: Processed', desc: 'Sent when an expense is processed for payout.',
    subject: '💰 Expense processed — {title}', message: 'Your expense has been processed for payout.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'status_REPROCESSING', label: 'Status: Reprocessing', desc: 'Sent when a processed expense is undone and goes back for reprocessing.',
    subject: '↻ Expense back for reprocessing — {title}', message: 'A previously processed expense has been reverted and is now back for reprocessing. You will receive an updated notification once it has been processed again.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'welcome', label: 'Welcome (new user)', desc: 'Sent to a new employee with their login details.',
    subject: 'Welcome to {appName}!', message: 'Your {appName} account has been created. Here are your login details:',
    vars: ['{name}','{email}','{password}','{appName}', ...EMP_VARS] },
  { key: 'password_reset', label: 'Password reset', desc: 'Sent when a user requests a password reset.',
    subject: 'Reset your {appName} password', message: 'Click below to reset your password. This link expires in 1 hour.',
    vars: ['{name}','{appName}', ...EMP_VARS] },
];

// AP/AR (payables & receivables) workflow templates — edited via the toggle.
const AP_AR_TEMPLATE_DEFS = [
  { key: 'apar_approval_request', label: 'Approval request', desc: 'Sent to an approver when an AP/AR invoice needs their approval. Employee tags refer to the invoice creator.',
    subject: 'Action required: Approve "{title}"', message: 'An AP/AR invoice from {employeeName} has been submitted and is waiting for your approval:',
    vars: ['{name}','{title}','{amount}','{category}','{date}', ...EMP_VARS] },
  { key: 'apar_status_APPROVED', label: 'Status: Approved', desc: 'Sent to the creator when their AP/AR invoice is fully approved.',
    subject: '✅ AP/AR invoice approved — {title}', message: 'The AP/AR invoice has been fully approved and will be processed for payment.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'apar_status_REJECTED', label: 'Status: Rejected', desc: 'Sent when an AP/AR invoice is rejected.',
    subject: '❌ AP/AR invoice rejected — {title}', message: 'The AP/AR invoice was not approved. Please check the notes and resubmit if needed.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'apar_status_RETURNED', label: 'Status: Returned', desc: 'Sent when an AP/AR invoice is returned for revision.',
    subject: '↩ AP/AR invoice returned — {title}', message: 'The approver returned this AP/AR invoice. Please review the comments and resubmit.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'apar_status_PROCESSED', label: 'Status: Processed', desc: 'Sent to the creator when an AP/AR invoice is processed for payout.',
    subject: '💰 AP/AR invoice processed — {title}', message: 'The AP/AR invoice has been processed for payout.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
  { key: 'apar_status_REPROCESSING', label: 'Status: Reprocessing', desc: 'Sent when a processed AP/AR invoice is undone and goes back for reprocessing.',
    subject: '↻ AP/AR invoice back for reprocessing — {title}', message: 'A previously processed AP/AR invoice has been reverted and is now back for reprocessing.',
    vars: ['{name}','{title}','{amount}', ...EMP_VARS] },
];

function EmailTemplatesTab({ settings, refresh, brand }) {
  const ALL_DEFS = [...EMAIL_TEMPLATE_DEFS, ...AP_AR_TEMPLATE_DEFS];
  // Pre-fill each field with the current custom value, or the default draft if none.
  // This gives the admin an editable starting draft rather than a blank box.
  const saved = settings?.emailTemplates || {};
  const initial = {};
  for (const d of ALL_DEFS) {
    initial[d.key] = {
      subject: (saved[d.key]?.subject != null && saved[d.key].subject !== '') ? saved[d.key].subject : d.subject,
      message: (saved[d.key]?.message != null && saved[d.key].message !== '') ? saved[d.key].message : d.message,
    };
  }
  const [tpls, setTpls] = useState(initial);
  const [mode, setMode] = useState('expense'); // 'expense' | 'apar'
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const defList = mode === 'apar' ? AP_AR_TEMPLATE_DEFS : EMAIL_TEMPLATE_DEFS;
  const defFor = (key) => ALL_DEFS.find(d => d.key === key) || {};
  const get = (key, field) => tpls[key]?.[field] ?? '';
  const set = (key, field, val) => setTpls(t => ({ ...t, [key]: { ...(t[key] || {}), [field]: val } }));
  const isCustom = (key) => { const d = defFor(key); return (tpls[key]?.subject ?? '') !== d.subject || (tpls[key]?.message ?? '') !== d.message; };
  const resetOne = (key) => { const d = defFor(key); setTpls(t => ({ ...t, [key]: { subject: d.subject, message: d.message } })); };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      // Only persist entries that differ from the default draft, so unchanged
      // templates keep following the defaults.
      const clean = {};
      for (const d of ALL_DEFS) {
        const subj = (tpls[d.key]?.subject ?? '').trim();
        const message = (tpls[d.key]?.message ?? '').trim();
        const entry = {};
        if (subj && subj !== d.subject) entry.subject = subj;
        if (message && message !== d.message) entry.message = message;
        if (Object.keys(entry).length) clean[d.key] = entry;
      }
      await api.patch('/settings', { emailTemplates: clean });
      if (refresh) refresh();
      setMsg('✅ Email templates saved.');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      setMsg('✕ ' + (err.error || 'Could not save.'));
    } finally { setSaving(false); }
  };

  return (
    <div>
      <h2 className="text-sm font-medium text-gray-700 mb-1">Email templates</h2>
      <p className="text-xs text-gray-500 mb-4">
        Each notification starts from an editable draft below. Edit the subject or message, or click "Reset to default" to restore it.
        Tags like <code className="bg-gray-100 px-1 rounded">{'{employeeName}'}</code> are replaced with the employee's real details when the email is sent.
        The branded header, details, and buttons stay consistent.
      </p>

      {/* Expense / AP & AR toggle */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[['expense', 'Expense emails'], ['apar', 'AP & AR emails']].map(([val, label]) => (
          <button key={val} onClick={() => setMode(val)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${mode === val ? 'bg-white font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {defList.map(def => (
          <div key={def.key} className="rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-800">{def.label} {isCustom(def.key) && <span className="text-[10px] text-emerald-600 ml-1">customized</span>}</p>
              <button onClick={() => resetOne(def.key)} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Reset to default</button>
            </div>
            <p className="text-xs text-gray-400 mb-2">{def.desc}</p>
            <label className="block text-[11px] text-gray-500 mb-1">Subject</label>
            <input value={get(def.key,'subject')} onChange={e => set(def.key,'subject',e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-2" />
            <label className="block text-[11px] text-gray-500 mb-1">Message</label>
            <textarea value={get(def.key,'message')} onChange={e => set(def.key,'message',e.target.value)}
              rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            <p className="text-[11px] text-gray-400 mt-1.5">Tags: {def.vars.map(v => (
              <code key={v} className="bg-gray-100 px-1 rounded mr-1 cursor-default" title="Replaced automatically when sent">{v}</code>
            ))}</p>
          </div>
        ))}
      </div>

      {msg && <div className={`mt-4 px-3 py-2 rounded-lg text-sm border ${msg.startsWith('✅')?'bg-green-50 text-green-700 border-green-100':'bg-red-50 text-red-700 border-red-100'}`}>{msg}</div>}

      <button onClick={save} disabled={saving}
        className="mt-5 w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: brand }}>
        {saving ? 'Saving...' : 'Save email templates'}
      </button>
    </div>
  );
}
