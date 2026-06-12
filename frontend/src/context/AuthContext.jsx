// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';
import { applyThemeToDOM } from './OrgContext';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On app load, restore session and apply theme
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      Promise.all([
        api.get('/auth/me'),
        api.get('/settings').catch(() => null),
      ]).then(([u, s]) => {
        setUser(u);
        if (s) applyThemeToDOM(s);
      }).catch(() => {
        localStorage.removeItem('token');
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const { user, token } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', token);
    setUser(user);
    // Apply theme immediately after login
    api.get('/settings').then(s => { if (s) applyThemeToDOM(s); }).catch(() => {});
    return user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    // Remove wallpaper on logout
    document.body.style.backgroundImage = '';
    document.documentElement.classList.remove('dark');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
