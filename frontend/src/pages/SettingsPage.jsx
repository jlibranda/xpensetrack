// src/pages/SettingsPage.jsx
import { useState, useRef } from 'react';
import { useOrg } from '../context/OrgContext';
import api from '../lib/api';

const TABS = ['General', 'Branding', 'Categories', 'Access Control'];

export default function SettingsPage() {
  const { settings, refresh } = useOrg();
  const [tab, setTab] = useState('General');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const logoRef = useRef();

  const s = form || settings;
  const set = (k, v) => setForm(f => ({ ...(f || settings), [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/settings', {
        companyName: s.companyName,
        defaultCurrency: s.defaultCurrency,
        receiptRequiredAbove: s.receiptRequiredAbove,
        approvalLevels: s.approvalLevels,
        primaryColor: s.primaryColor,
        categories: Array.isArray(s.categories) ? s.categories : s.categories?.split(','),
        expenseTypes: Array.isArray(s.expenseTypes) ? s.expenseTypes : s.expenseTypes?.split(','),
      });
      refresh();
      setMsg('✅ Settings saved!');
      setForm(null);
      setTimeout(() => setMsg(''), 3000);
    } catch(err) {
      setMsg('❌ ' + (err.error || 'Failed to save'));
    } finally { setSaving(false); }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const res = await api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      refresh();
      setMsg('✅ Logo updated!');
      setTimeout(() => setMsg(''), 3000);
    } catch(err) { setMsg('❌ Failed to upload logo'); }
  };

  const cats = Array.isArray(s?.categories) ? s.categories : (s?.categories?.split(',') || []);
  const types = Array.isArray(s?.expenseTypes) ? s.expenseTypes : (s?.expenseTypes?.split(',') || []);

  const addCategory = () => set('categories', [...cats, 'NEW CATEGORY']);
  const removeCategory = (i) => set('categories', cats.filter((_,idx) => idx !== i));
  const updateCategory = (i, v) => set('categories', cats.map((c, idx) => idx === i ? v.toUpperCase() : c));

  const addType = () => set('expenseTypes', [...types, 'NEW TYPE']);
  const removeType = (i) => set('expenseTypes', types.filter((_,idx) => idx !== i));
  const updateType = (i, v) => set('expenseTypes', types.map((t, idx) => idx === i ? v.toUpperCase() : t));

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Organization configuration</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${tab===t ? 'bg-white font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        {tab === 'General' && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-700 mb-3">General settings</h2>
            <div><label className="block text-xs text-gray-500 mb-1">Company name</label>
              <input value={s?.companyName||''} onChange={e=>set('companyName',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Default currency</label>
              <select value={s?.defaultCurrency||'PHP'} onChange={e=>set('defaultCurrency',e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value="PHP">PHP — Philippine Peso (₱)</option>
                <option value="USD">USD — US Dollar ($)</option>
              </select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Approval levels</label>
              <select value={s?.approvalLevels||2} onChange={e=>set('approvalLevels',Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
                <option value={1}>1 — Manager only</option>
                <option value={2}>2 — Manager + Finance</option>
              </select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Receipt required above (PHP)</label>
              <input type="number" value={s?.receiptRequiredAbove||500} onChange={e=>set('receiptRequiredAbove',Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
              <p className="text-xs text-gray-400 mt-1">Expenses above this amount must have a receipt attached.</p></div>
          </div>
        )}

        {tab === 'Branding' && (
          <div className="space-y-5">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Branding & appearance</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-2">Company logo</label>
              <div className="flex items-center gap-4">
                {s?.logoUrl ? (
                  <img src={s.logoUrl} alt="Logo" className="w-16 h-16 rounded-xl object-cover border border-gray-100" />
                ) : (
                  <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 text-xs">Logo</div>
                )}
                <div>
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
                  <button onClick={() => logoRef.current.click()}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
                    Upload logo
                  </button>
                  <p className="text-xs text-gray-400 mt-1">PNG or JPG, max 2MB</p>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-2">Primary color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={s?.primaryColor||'#1D9E75'} onChange={e=>set('primaryColor',e.target.value)}
                  className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer p-1" />
                <input value={s?.primaryColor||'#1D9E75'} onChange={e=>set('primaryColor',e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none font-mono" />
                <div className="w-10 h-10 rounded-lg" style={{backgroundColor: s?.primaryColor||'#1D9E75'}} />
              </div>
              <div className="flex gap-2 mt-2">
                {['#1D9E75','#2563EB','#7C3AED','#DC2626','#D97706','#0F172A'].map(c => (
                  <button key={c} onClick={() => set('primaryColor', c)}
                    className="w-7 h-7 rounded-lg border-2 border-white shadow hover:scale-110 transition-transform"
                    style={{backgroundColor:c}} />
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'Categories' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700">Expense categories</h2>
              <button onClick={addCategory}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add</button>
            </div>
            <div className="space-y-2 mb-6">
              {cats.map((cat, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={cat} onChange={e => updateCategory(i, e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 uppercase" />
                  <button onClick={() => removeCategory(i)}
                    className="px-2 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm">✕</button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mb-3 pt-4 border-t border-gray-100">
              <h2 className="text-sm font-medium text-gray-700">Expense types</h2>
              <button onClick={addType}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">+ Add</button>
            </div>
            <div className="space-y-2">
              {types.map((type, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={type} onChange={e => updateType(i, e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 uppercase" />
                  <button onClick={() => removeType(i)}
                    className="px-2 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Access Control' && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-4">Role permissions</h2>
            <div className="space-y-3">
              {[
                { role: 'EMPLOYEE', color: 'bg-blue-50 text-blue-700', perms: ['Submit expenses', 'View own expenses', 'Upload receipts', 'Cancel own expenses'] },
                { role: 'MANAGER', color: 'bg-purple-50 text-purple-700', perms: ['All Employee permissions', 'Approve/Reject expenses', 'View team expenses', 'View reports', 'View analytics'] },
                { role: 'FINANCE', color: 'bg-amber-50 text-amber-700', perms: ['All Manager permissions', 'Second-level approval', 'Mark as reimbursed', 'Export reports', 'Manage settings'] },
                { role: 'ADMIN', color: 'bg-green-50 text-green-700', perms: ['All Finance permissions', 'Manage users', 'Bulk user upload', 'Upload logo', 'Change branding'] },
              ].map(r => (
                <div key={r.role} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.color}`}>{r.role}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.perms.map(p => (
                      <span key={p} className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded-lg">✓ {p}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && <div className="mt-3 px-3 py-2 rounded-lg text-sm bg-green-50 text-green-700 border border-green-100">{msg}</div>}

        {tab !== 'Access Control' && (
          <button onClick={save} disabled={saving}
            className="mt-5 w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-colors"
            style={{ backgroundColor: settings?.primaryColor || '#1D9E75' }}>
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        )}
      </div>
    </div>
  );
}
