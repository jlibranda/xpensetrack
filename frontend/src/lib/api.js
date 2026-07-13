// src/lib/api.js
import axios from 'axios';

const api = axios.create({ 
  baseURL: import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api'
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Public auth pages must never be bounced to /login on a 401 — a logged-out
// visitor (e.g. someone opening a password-reset link) legitimately has no token,
// and the AuthContext's /auth/me probe will 401. Redirecting here would strip the
// reset token from the URL before they can set a new password.
const PUBLIC_AUTH_PATHS = ['/login', '/reset-password', '/forgot-password', '/change-password'];

api.interceptors.response.use(
  res => res.data,
  err => {
    const path = window.location.pathname;
    const onPublicAuthPage = PUBLIC_AUTH_PATHS.some(p => path.includes(p));
    if (err.response?.status === 401 && !onPublicAuthPage) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err.response?.data || err);
  }
);

export default api;
