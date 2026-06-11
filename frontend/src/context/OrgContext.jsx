// src/context/OrgContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';

const OrgContext = createContext(null);

export function OrgProvider({ children }) {
  const [settings, setSettings] = useState({
    companyName: 'XpenseTrack',
    primaryColor: '#1D9E75',
    logoUrl: null,
    categories: ['MEALS','TRAVEL','ACCOMMODATION','SUPPLIES','COMMUNICATIONS','OTHER'],
    expenseTypes: ['REIMBURSEMENT','CASH_ADVANCE'],
    defaultCurrency: 'PHP',
    receiptRequiredAbove: 500,
    approvalLevels: 2,
  });

  useEffect(() => {
    api.get('/settings').then(s => {
      if (s) setSettings(s);
      // Apply primary color to CSS
      if (s?.primaryColor) {
        document.documentElement.style.setProperty('--brand-color', s.primaryColor);
      }
    }).catch(() => {});
  }, []);

  const refresh = () => {
    api.get('/settings').then(s => { if(s) setSettings(s); }).catch(() => {});
  };

  return (
    <OrgContext.Provider value={{ settings, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);
