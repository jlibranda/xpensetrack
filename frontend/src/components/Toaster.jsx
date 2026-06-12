// src/components/Toaster.jsx
import { useState, useEffect } from 'react';
import toast from '../lib/toast';

const STYLES = {
  success: { bg: '#16a34a', icon: '✓' },
  error:   { bg: '#dc2626', icon: '✕' },
  info:    { bg: '#2563eb', icon: 'ℹ' },
};

export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail;
      setItems(prev => [...prev, t]);
      // Auto-dismiss after 3 seconds.
      setTimeout(() => {
        setItems(prev => prev.filter(x => x.id !== t.id));
      }, 3000);
    };
    window.addEventListener(toast.EVENT, handler);
    return () => window.removeEventListener(toast.EVENT, handler);
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {items.map(t => {
        const s = STYLES[t.type] || STYLES.info;
        return (
          <div key={t.id}
            style={{
              backgroundColor: s.bg, color: '#fff', padding: '10px 16px', borderRadius: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)', fontSize: 14, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 8, minWidth: 200, maxWidth: 420,
              animation: 'toastIn 0.2s ease-out',
            }}>
            <span style={{ fontWeight: 800 }}>{s.icon}</span>
            <span>{t.message}</span>
          </div>
        );
      })}
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
