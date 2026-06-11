// src/context/CurrencyContext.jsx
import { createContext, useContext, useState } from 'react';

const CurrencyContext = createContext(null);
const PHP_USD_RATE = 56;

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState('PHP');

  const format = (amountPhp) => {
    if (currency === 'USD') {
      return `$${(amountPhp / PHP_USD_RATE).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `₱${amountPhp.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const toggle = () => setCurrency(c => c === 'PHP' ? 'USD' : 'PHP');

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, toggle }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);
