// src/pages/SettingsPage.jsx
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

const TABS = ['General','Branding','Categories','Expense Types','Password','Access Control'];


// Separate component for Access Control tab
function AccessControlTab({ settings, navigate, refresh }) {
  const DEFAULT_PERMS = {
    submit_expenses: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'],
    view_own_expenses: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'],
    upload_receipts: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'],
    cancel_expenses: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'],
    approve_expenses: ['MANAGER','FINANCE','ADMIN'],
    view_team_expenses: ['MANAGER','FINANCE','ADMIN'],
    view_reports: ['MANAGER','FINANCE','ADMIN'],
    export_reports: ['MANAGER','FINANCE','ADMIN'],
    second_approval: ['FINANCE','ADMIN'],
    mark_reimbursed: ['FINANCE','ADMIN'],
    edit_categories: ['FINANCE','ADMIN'],
    manage_settings: ['FINANCE','ADMIN'],
    manage_users: ['ADMIN'],
    toggle_access: ['ADMIN'],
    reset_passwords: ['ADMIN'],
    upload_branding: ['ADMIN'],
    change_branding: ['ADMIN'],
    impersonate_user: ['ADMIN'],
  };

  const PERM_LABELS = {
    submit_expenses: 'Submit expenses',
    view_own_expenses: 'View own expenses',
    upload_receipts: 'Upload receipts & AI auto-fill',
    cancel_expenses: 'Cancel own expenses',
    approve_expenses: 'Approve / Reject / Return expenses',
    view_team_expenses: 'View team expenses',
    view_reports: 'View reports & analytics',
    export_reports: 'Export Excel reports',
    second_approval: 'Second-level approval (Finance)',
    mark_reimbursed: 'Mark expenses as reimbursed',
    edit_categories: 'Edit categories & GL codes',
    manage_settings: 'Manage app settings',
    manage_users: 'Manage users',
    toggle_access: 'Activate / deactivate user access',
    reset_passwords: 'Reset any user password',
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
  const [roles, setRoles] = useState(['EMPLOYEE','MANAGER','FINANCE','ADMIN']);
  const ROLES = roles;
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

  const savePerms = async () => {
    setSaving2(true);
    try {
      await api.patch('/settings', { accessControl: perms });
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
    try {
      await api.patch('/settings', { accessControl: DEFAULT_PERMS });
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
              {ROLES.map(r => {
                const isDefault = ['EMPLOYEE','MANAGER','FINANCE','ADMIN'].includes(r);
                return (
                  <th key={r} className="text-center py-3 px-3 min-w-[90px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[r] || 'bg-gray-100 text-gray-700 border border-gray-200'}`}>{r}</span>
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
            {Object.keys(DEFAULT_PERMS).map((key, i) => (
              <tr key={key} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                <td className="py-2.5 px-4 font-semibold" style={{color:'#111827'}}>{PERM_LABELS[key]}</td>
                {ROLES.map(role => {
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

  const s = form || settings;
  const set = (k,v) => setForm(f=>({...(f||settings),[k]:v}));

  const cats = Array.isArray(s?.categories) ? s.categories : (s?.categories?.split(',').map(c=>c.trim())||[]);
  const types = Array.isArray(s?.expenseTypes) ? s.expenseTypes : (s?.expenseTypes?.split(',').map(t=>t.trim())||[]);
  const glCodes = s?.categoryGlCodes || {};

  const save = async () => {
    setSaving(true);
    try {
      // Only send fields relevant to current tab to avoid overwriting others
      const payload = {
        companyName: s.companyName,
        defaultCurrency: s.defaultCurrency,
        approvalLevels: s.approvalLevels,
        primaryColor: s.primaryColor,
        darkMode: s.darkMode ?? settings?.darkMode,
        categories: cats,
        expenseTypes: types,
        categoryGlCodes: glCodes,
        defaultPassword: s.defaultPassword,
        wallpaperStyle: s.wallpaperStyle ?? settings?.wallpaperStyle,
      };
      const updated = await api.patch('/settings', payload);
      applyTheme(updated);
      refresh();
      setMsg('✅ Settings saved!');
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
      setMsg('✅ Wallpaper updated!');
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
      setMsg('✅ Wallpaper removed');
      setTimeout(()=>setMsg(''),2000);
    }
    catch(err) { setMsg('❌ Failed'); }
  };

  const addCat = () => set('categories', [...cats, '']);
  const removeCat = (i) => { set('categories', cats.filter((_,idx)=>idx!==i)); const g={...glCodes}; delete g[cats[i]]; set('categoryGlCodes',g); };
  const updateCat = (i,v) => { const old=cats[i]; const newCats=cats.map((c,idx)=>idx===i?v.toUpperCase():c); const g={...glCodes}; if(g[old]){g[v.toUpperCase()]=g[old];delete g[old];} set('categories',newCats); set('categoryGlCodes',g); };
  const updateGl = (cat,v) => set('categoryGlCodes',{...glCodes,[cat]:v});

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Organization configuration</p>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 flex-wrap">
        {TABS.filter(t => (t!=='Access Control' && t!=='Branding' && t!=='Password') || isAdmin).map(t => (
          <button key={t} onClick={()=>setTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${tab===t?'bg-white font-medium shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">

        {tab === 'General' && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-700 mb-3">General settings</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Company name</label>
              <input value={s?.companyName||''} onChange={e=>set('companyName',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default currency</label>
              <select value={s?.defaultCurrency||'PHP'} onChange={e=>set('defaultCurrency',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="PHP">PHP — Philippine Peso (₱)</option>
                <option value="USD">USD — US Dollar ($)</option>
              </select>
            </div>
          </div>
        )}

        {tab === 'Branding' && isAdmin && (
          <div className="space-y-5">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Branding & appearance</h2>
            {/* Logo */}
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
            {/* Color */}
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
            {/* Dark mode */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Dark mode</p>
                <p className="text-xs text-gray-400">Switch between light and dark theme</p>
              </div>
              <button onClick={()=>set('darkMode',!s?.darkMode)}
                className={`relative w-12 h-6 rounded-full transition-colors ${s?.darkMode?'bg-gray-800':'bg-gray-200'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${s?.darkMode?'translate-x-7':'translate-x-1'}`} />
              </button>
            </div>
            {/* Wallpaper */}
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
          </div>
        )}

        {tab === 'Categories' && (isFinance || isAdmin) && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700">Expense categories & GL codes</h2>
              <div className="flex gap-2">
                <button onClick={async () => {
                  await api.post('/settings/reset-categories');
                  refresh();
                  window.location.reload();
                }} className="px-3 py-1.5 text-xs border border-amber-200 text-amber-600 rounded-lg hover:bg-amber-50">↺ Reset to defaults</button>
                <button onClick={addCat} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add</button>
              </div>
            </div>
            <div className="space-y-2">
              {cats.map((cat, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={cat} onChange={e=>updateCat(i,e.target.value)} placeholder="Category name"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 uppercase" />
                  <input value={glCodes[cat]||''} onChange={e=>updateGl(cat,e.target.value)} placeholder="GL code"
                    className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 font-mono" />
                  <button onClick={()=>removeCat(i)} className="px-2 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm">✕</button>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">GL code is the General Ledger account code for accounting integration.</p>
          </div>
        )}

        {tab === 'Expense Types' && (
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

        {tab === 'Password' && isAdmin && (
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

        {tab === 'Access Control' && isAdmin && <AccessControlTab settings={settings} navigate={navigate} refresh={refresh} />}

        {msg && <div className={`mt-4 px-3 py-2 rounded-lg text-sm border ${msg.startsWith('✅')?'bg-green-50 text-green-700 border-green-100':'bg-red-50 text-red-700 border-red-100'}`}>{msg}</div>}

        {tab !== 'Access Control' && (
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
