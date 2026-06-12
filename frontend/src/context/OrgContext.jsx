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
  categories: ['Cleaning', 'Education and Training', 'Entertainment/Meals', 'Equipment', 'Facility Maintenance and Repair', 'Furniture and Fixtures', 'General Office Expense', 'Hardware', 'Miscellaneous', 'Mobile Device', 'Non-Capital Small Tools Equipment and Furniture', 'Office Rent', 'Parking', 'Printing', 'Recruiting', 'Travel - Air Ticket (International)', 'Travel - Air Ticket (Domestic)', 'Travel - Others', 'Travel - Hotel (Domestic)'],
  expenseTypes: ['REIMBURSEMENT','CASH_ADVANCE'],
  categoryGlCodes: {},
  defaultCurrency: 'PHP',
  receiptRequiredAbove: 500,
  approvalLevels: 2,
  defaultPassword: 'Welcome123',
};

export function applyThemeToDOM(s) {
  if (!s) return;
  if (s.primaryColor) {
    document.documentElement.style.setProperty('--brand-color', s.primaryColor);
  }
  if (s.darkMode) {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  }
  if (s.wallpaperUrl) {
    document.body.style.backgroundImage = `url(${s.wallpaperUrl})`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
  } else {
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
  }
}

export function OrgProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT);

  const load = () => {
    if (!localStorage.getItem('token')) return;
    api.get('/settings').then(s => {
      if (s) {
        const parsed = {
          ...s,
          categories: Array.isArray(s.categories) ? s.categories : (s.categories?.split(',').map(c=>c.trim()).filter(Boolean) || DEFAULT.categories),
          expenseTypes: Array.isArray(s.expenseTypes) ? s.expenseTypes : (s.expenseTypes?.split(',').map(t=>t.trim()).filter(Boolean) || DEFAULT.expenseTypes),
          categoryGlCodes: s.categoryGlCodes || {},
        };
        setSettings(parsed);
        applyThemeToDOM(parsed);
      }
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, []);

  const applyTheme = (s) => {
    applyThemeToDOM(s);
    setSettings(prev => ({ ...prev, ...s }));
  };

  return (
    <OrgContext.Provider value={{ settings, refresh: load, applyTheme }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);
