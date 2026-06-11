// src/pages/SettingsPage.jsx
import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings').then(setSettings).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/settings', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="py-12 text-center text-sm text-gray-400">Loading...</div>;

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Organization configuration</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Company name</label>
          <input value={settings.companyName || ''} onChange={e => setSettings(s => ({ ...s, companyName: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Default currency</label>
          <select value={settings.defaultCurrency || 'PHP'} onChange={e => setSettings(s => ({ ...s, defaultCurrency: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
            <option value="PHP">PHP — Philippine Peso (₱)</option>
            <option value="USD">USD — US Dollar ($)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Approval levels</label>
          <select value={settings.approvalLevels || 2} onChange={e => setSettings(s => ({ ...s, approvalLevels: Number(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400">
            <option value={1}>1 — Manager only</option>
            <option value={2}>2 — Manager + Finance</option>
            <option value={3}>3 — Manager + Finance + Director</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            Receipt required above (PHP)
          </label>
          <input type="number" value={settings.receiptRequiredAbove || 500}
            onChange={e => setSettings(s => ({ ...s, receiptRequiredAbove: Number(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          <p className="text-xs text-gray-400 mt-1">Expenses above this amount require a receipt photo.</p>
        </div>

        {saved && <div className="px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700">Settings saved ✓</div>}

        <button onClick={save} disabled={saving}
          className="w-full py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60 transition-colors">
          {saving ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
