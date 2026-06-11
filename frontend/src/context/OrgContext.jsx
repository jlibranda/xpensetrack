// src/context/OrgContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';

const OrgContext = createContext(null);

const DEFAULT = {
  companyName: 'XpenseTrack',
  primaryColor: '#1D9E75',
  logoUrl: null,
  categories: ['MEALS','TRAVEL','ACCOMMODATION','SUPPLIES','COMMUNICATIONS','OTHER'],
  expenseTypes: ['REIMBURSEMENT','CASH_ADVANCE'],
  defaultCurrency: 'PHP',
  receiptRequiredAbove: 500,
  approvalLevels: 2,
};

export function OrgProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT);

  const load = () => {
    const token = localStorage.getItem('token');
    if (!token) return; // Don't fetch if not logged in
    api.get('/settings').then(s => {
      if (s) {
        setSettings({
          ...s,
          categories: Array.isArray(s.categories) ? s.categories : (s.categories?.split(',').map(c=>c.trim()).filter(Boolean) || DEFAULT.categories),
          expenseTypes: Array.isArray(s.expenseTypes) ? s.expenseTypes : (s.expenseTypes?.split(',').map(t=>t.trim()).filter(Boolean) || DEFAULT.expenseTypes),
        });
        if (s.primaryColor) {
          document.documentElement.style.setProperty('--brand-color', s.primaryColor);
        }
      }
    }).catch(() => {}); // Silently fail — use defaults
  };

  useEffect(() => {
    load();
    // Re-load when token changes (login/logout)
    const handler = () => load();
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <OrgContext.Provider value={{ settings, refresh: load }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);
