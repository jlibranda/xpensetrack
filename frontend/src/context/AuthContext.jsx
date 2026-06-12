// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';
import { applyThemeToDOM } from './OrgContext';

const AuthContext = createContext(null);

// Apply cached theme immediately on page load (before React renders)
const cachedTheme = localStorage.getItem('xpense_theme');
if (cachedTheme) {
  try { applyThemeToDOM(JSON.parse(cachedTheme)); } catch(e) {}
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
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
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const { user, token } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', token);
    setUser(user);
    // Apply + cache theme immediately after login
    api.get('/settings').then(s => {
      if (s) {
        applyThemeToDOM(s);
        localStorage.setItem('xpense_theme', JSON.stringify(s));
      }
    }).catch(() => {});
    return user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('xpense_theme');
    setUser(null);
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.documentElement.classList.remove('dark');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
