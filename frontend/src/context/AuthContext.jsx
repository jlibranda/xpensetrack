// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';
import { applyThemeToDOM } from './OrgContext';

const AuthContext = createContext(null);

// Apply cached theme immediately on page load (before React mounts)
try {
  const cached = localStorage.getItem('xpense_theme');
  if (cached) applyThemeToDOM(JSON.parse(cached));
} catch(e) {}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    Promise.all([
      api.get('/auth/me'),
      api.get('/settings').catch(() => null),
    ]).then(([u, s]) => {
      setUser(u);
      if (s) {
        applyThemeToDOM(s);
        localStorage.setItem('xpense_theme', JSON.stringify(s));
      }
    }).catch(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('xpense_theme');
    }).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { user, token } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', token);
    setUser(user);
    // Apply theme right after login
    api.get('/settings').then(s => {
      if (s) {
        applyThemeToDOM(s);
        localStorage.setItem('xpense_theme', JSON.stringify(s));
      }
    }).catch(() => {});
    return user;
  };

  const refreshUser = async () => {
    try { const u = await api.get('/auth/me'); setUser(u); return u; } catch { return null; }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('xpense_theme');
    localStorage.removeItem('xpense_perms');
    localStorage.removeItem('xpense_roles');
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_name');
    // Full page reload — wipes all React component state so login is always fresh
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
