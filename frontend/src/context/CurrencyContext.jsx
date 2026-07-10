// src/context/CurrencyContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';

const CurrencyContext = createContext(null);
const DEFAULT_RATE = 56; // fallback only, until the settings rate loads

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState('PHP');
  // USD→PHP rate comes from Settings → Exchange Rate (manual or auto-updated).
  const [rate, setRate] = useState(DEFAULT_RATE);

  const loadRate = () => {
    api.get('/settings/exchange-rate')
      .then(r => { const v = Number(r?.usdPhpRate); if (v > 0) setRate(v); })
      .catch(() => {});
  };
  useEffect(() => { loadRate(); }, []);

  const format = (amountPhp) => {
    const amt = Number(amountPhp) || 0;
    if (currency === 'USD') {
      const r = rate > 0 ? rate : DEFAULT_RATE;
      return `$${(amt / r).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `₱${amt.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const toggle = () => setCurrency(c => c === 'PHP' ? 'USD' : 'PHP');

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, toggle, rate, reloadRate: loadRate }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);
