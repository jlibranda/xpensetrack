// src/pages/SettingsPage.jsx
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

const TABS = ['General','Branding','Categories','Expense Types','Password','Access Control'];

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
      const updated = await api.patch('/settings', {
        companyName: s.companyName,
        defaultCurrency: s.defaultCurrency,
        receiptRequiredAbove: s.receiptRequiredAbove,
        approvalLevels: s.approvalLevels,
        primaryColor: s.primaryColor,
        darkMode: s.darkMode,
        categories: cats,
        expenseTypes: types,
        categoryGlCodes: glCodes,
        defaultPassword: s.defaultPassword,
      });
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
    try { const res = await api.post('/settings/wallpaper', fd, {headers:{'Content-Type':'multipart/form-data'}}); refresh(); applyTheme({...settings, wallpaperUrl: res.wallpaperUrl}); setMsg('✅ Wallpaper updated!'); setTimeout(()=>setMsg(''),3000); }
    catch(err) { setMsg('❌ Failed to upload wallpaper'); }
  };

  const removeWallpaper = async () => {
    try { await api.delete('/settings/wallpaper'); refresh(); applyTheme({...settings, wallpaperUrl:null}); setMsg('✅ Wallpaper removed'); setTimeout(()=>setMsg(''),2000); }
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
        {TABS.filter(t => t!=='Access Control' || isAdmin).map(t => (
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
            {[['companyName','Company name','text'],['receiptRequiredAbove','Receipt required above (PHP)','number'],].map(([k,label,type]) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input type={type} value={s?.[k]||''} onChange={e=>set(k, type==='number'?Number(e.target.value):e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default currency</label>
              <select value={s?.defaultCurrency||'PHP'} onChange={e=>set('defaultCurrency',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="PHP">PHP — Philippine Peso (₱)</option>
                <option value="USD">USD — US Dollar ($)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Approval levels</label>
              <select value={s?.approvalLevels||2} onChange={e=>set('approvalLevels',Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value={1}>1 — Manager only</option>
                <option value={2}>2 — Manager + Finance</option>
              </select>
            </div>
          </div>
        )}

        {tab === 'Branding' && (
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
            </div>
          </div>
        )}

        {tab === 'Categories' && (isFinance || isAdmin) && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700">Expense categories & GL codes</h2>
              <button onClick={addCat} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add</button>
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

        {tab === 'Password' && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-4">Password manager</h2>
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4 text-xs text-amber-700">
              ⚠️ This default password will be used when creating new users via Add User or Bulk Upload. Users should change it on first login.
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default password for new users</label>
              <input type="text" value={s?.defaultPassword||'Welcome123'} onChange={e=>set('defaultPassword',e.target.value)}
                placeholder="e.g. Welcome@2024"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 font-mono" />
              <p className="text-xs text-gray-400 mt-1">Minimum 6 characters. This is shown when adding users so admins can share it with new employees.</p>
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-medium text-gray-600 mb-1">Current default password:</p>
              <code className="text-sm font-mono text-gray-800">{s?.defaultPassword||'Welcome123'}</code>
            </div>
          </div>
        )}

        {tab === 'Access Control' && isAdmin && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-1">Access control</h2>
            <p className="text-xs text-gray-400 mb-4">Manage users directly from the Users page. Click Active/Inactive to toggle access.</p>
            <div className="space-y-3">
              {[
                { role:'EMPLOYEE', color:'bg-blue-50 text-blue-700', perms:['Submit expenses','View own expenses','Upload receipts (AI auto-fill)','Cancel own expenses','Change own password','View own profile'] },
                { role:'MANAGER', color:'bg-purple-50 text-purple-700', perms:['All Employee permissions','Approve / Reject / Return expenses','View team expenses','View reports & analytics','Export Excel reports'] },
                { role:'FINANCE', color:'bg-amber-50 text-amber-700', perms:['All Manager permissions','Second-level approval','Mark as reimbursed','Edit categories & GL codes','Manage settings','Manage users'] },
                { role:'ADMIN', color:'bg-green-50 text-green-700', perms:['All Finance permissions','Activate / deactivate users','Reset any user password','Upload logo & wallpaper','Change branding & colors','Full access'] },
              ].map(r => (
                <div key={r.role} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${r.color}`}>{r.role}</span>
                    <button onClick={() => navigate('/users')}
                      className="text-xs text-brand-400 hover:text-brand-600">
                      Manage {r.role.toLowerCase()}s →
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.perms.map(p => <span key={p} className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded-lg">✓ {p}</span>)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 p-4 bg-amber-50 border border-amber-100 rounded-xl">
              <p className="text-xs font-medium text-amber-800 mb-1">⚡ Quick access management</p>
              <p className="text-xs text-amber-700 mb-3">To activate/deactivate a user or reset their password, go to the Users page and click on their status badge or use the Reset pwd button.</p>
              <button onClick={() => navigate('/users')}
                className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90"
                style={{backgroundColor: settings?.primaryColor||'#1D9E75'}}>
                → Go to Users page
              </button>
            </div>
          </div>
        )}

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
