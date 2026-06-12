// src/context/OrgContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';

const OrgContext = createContext(null);

const DEFAULT = {
  companyName: 'XpenseTrack',
  primaryColor: '#1D9E75',
  logoUrl: null,
  wallpaperUrl: null,
  darkMode: false,
  categories: ['MEALS','TRAVEL','ACCOMMODATION','SUPPLIES','COMMUNICATIONS','OTHER'],
  expenseTypes: ['REIMBURSEMENT','CASH_ADVANCE'],
  categoryGlCodes: {},
  defaultCurrency: 'PHP',
  receiptRequiredAbove: 500,
  approvalLevels: 2,
  defaultPassword: 'Welcome123',
};

export function OrgProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT);

  const applyTheme = (s) => {
    if (!s) return;
    // Primary color
    if (s.primaryColor) document.documentElement.style.setProperty('--brand-color', s.primaryColor);
    // Dark mode
    if (s.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Wallpaper
    if (s.wallpaperUrl) {
      document.body.style.backgroundImage = `url(${s.wallpaperUrl})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
    }
  };

  const load = () => {
    if (!localStorage.getItem('token')) return;
    api.get('/settings').then(s => {
      if (s) {
        const parsed = {
          ...s,
          categories: Array.isArray(s.categories) ? s.categories : s.categories?.split(',').map(c=>c.trim()).filter(Boolean) || DEFAULT.categories,
          expenseTypes: Array.isArray(s.expenseTypes) ? s.expenseTypes : s.expenseTypes?.split(',').map(t=>t.trim()).filter(Boolean) || DEFAULT.expenseTypes,
          categoryGlCodes: s.categoryGlCodes || {},
        };
        setSettings(parsed);
        applyTheme(parsed);
      }
    }).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  return (
    <OrgContext.Provider value={{ settings, refresh: load, applyTheme }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);
