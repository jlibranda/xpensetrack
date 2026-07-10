// src/components/RecordModal.jsx
// A small, focused add/edit modal. Auto-focuses the first field and stays open
// until the user Saves or Cancels (backdrop / Esc do NOT dismiss, so an in-progress
// edit can't be lost by accident). onSave may be async and may throw an Error whose
// message is shown inline while keeping the modal open.
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function RecordModal({ title, fields, initial = {}, brand = '#1D9E75', saveLabel = 'Save', onCancel, onSave }) {
  const [vals, setVals] = useState(() => {
    const v = {};
    fields.forEach(f => { v[f.key] = initial[f.key] ?? f.default ?? ''; });
    return v;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const firstRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => firstRef.current?.focus(), 50); return () => clearTimeout(t); }, []);

  const setField = (f, raw) => {
    let v = raw;
    if (f.uppercase) v = String(v).toUpperCase();
    if (f.numericOnly) v = String(v).replace(/\D/g, '');
    if (f.maxLen) v = String(v).slice(0, f.maxLen);
    setVals(prev => ({ ...prev, [f.key]: v }));
  };

  const missingRequired = fields.some(f => f.required && !String(vals[f.key] ?? '').trim());

  const submit = async () => {
    if (missingRequired || saving) return;
    setSaving(true); setError('');
    try {
      await onSave(vals);
    } catch (e) {
      setError(e?.message || 'Could not save.');
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onKeyDown={onKeyDown}>
        <div className="px-5 pt-5 pb-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          {fields.map((f, idx) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {f.label}{f.required ? ' *' : ''}
              </label>
              {f.type === 'select' ? (
                <select
                  ref={idx === 0 ? firstRef : null}
                  value={vals[f.key]}
                  onChange={e => setField(f, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand-400">
                  {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  ref={idx === 0 ? firstRef : null}
                  type={f.type === 'number' ? 'number' : 'text'}
                  step={f.type === 'number' ? (f.step || 'any') : undefined}
                  inputMode={f.numericOnly ? 'numeric' : undefined}
                  value={vals[f.key]}
                  onChange={e => setField(f, e.target.value)}
                  placeholder={f.placeholder || ''}
                  className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 ${f.uppercase ? 'uppercase' : ''} ${f.mono ? 'font-mono' : ''}`} />
              )}
              {f.help && <p className="text-[11px] text-gray-400 mt-1">{f.help}</p>}
            </div>
          ))}
          {error && (
            <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }}>{error}</div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={submit} disabled={missingRequired || saving}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: brand, color: 'var(--brand-contrast,#fff)' }}>
            {saving ? 'Saving…' : saveLabel}
          </button>
          <button onClick={onCancel} disabled={saving}
            className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
