// src/pages/ChangePasswordPage.jsx
// Forced password change after logging in with a temporary password.
import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

const DEFAULT_BRANDING = { companyName: 'Cashalo', primaryColor: '#1D9E75', logoUrl: null };
const readCachedBranding = () => {
  try { const v = localStorage.getItem('cached_branding'); return v ? JSON.parse(v) : DEFAULT_BRANDING; } catch { return DEFAULT_BRANDING; }
};
const readDark = () => { try { return localStorage.getItem('personal_dark') === 'true'; } catch { return false; } };

export default function ChangePasswordPage() {
  const { user, loading: authLoading, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const branding = readCachedBranding();
  const dark = readDark();

  if (authLoading) return null; // wait for session restore before deciding
  if (!user) return <Navigate to="/login" replace />;

  const bg = branding.primaryColor || '#1D9E75';
  const pageBg = dark ? '#0f172a' : '#f9fafb';
  const cardBg = dark ? '#1e293b' : '#ffffff';
  const cardBorder = dark ? '#334155' : '#f3f4f6';
  const inputBg = dark ? '#0f172a' : '#ffffff';
  const inputBorder = dark ? '#334155' : '#e5e7eb';
  const textMain = dark ? '#f1f5f9' : '#111827';
  const textSub = dark ? '#94a3b8' : '#6b7280';

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    if (next.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (next === current) { setError('Please choose a different password from the temporary one.'); return; }
    setLoading(true); setError('');
    try {
      await api.patch('/auth/change-password', { currentPassword: current, newPassword: next });
      await refreshUser(); // clears the must-change flag so routing lets them through
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.error || 'Could not change password. Check your temporary password.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: pageBg }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" className="w-16 h-16 rounded-2xl object-cover mx-auto mb-3 shadow-lg" />
          ) : (
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-3" style={{ backgroundColor: bg }}>
              {branding.companyName?.[0] || 'C'}
            </div>
          )}
          <h1 className="text-xl font-medium" style={{ color: textMain }}>Set your new password</h1>
          <p className="text-sm mt-1" style={{ color: textSub }}>For your security, please change the temporary password before continuing.</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
          {error && (
            <div className="rounded-lg px-3 py-2 text-sm"
              style={{ backgroundColor: dark ? 'rgba(220,38,38,0.15)' : '#fef2f2', border: `1px solid ${dark ? 'rgba(220,38,38,0.4)' : '#fecaca'}`, color: dark ? '#fca5a5' : '#b91c1c' }}>{error}</div>
          )}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: textSub }}>Temporary password</label>
            <input type={show ? 'text' : 'password'} required value={current} onChange={e => setCurrent(e.target.value)}
              placeholder="The password from your email"
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
              style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: textMain }} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: textSub }}>New password</label>
            <div className="relative">
              <input type={show ? 'text' : 'password'} required value={next} onChange={e => setNext(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-3 py-2 pr-10 rounded-lg text-sm focus:outline-none"
                style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: textMain }} />
              <button type="button" onClick={() => setShow(s => !s)} title={show ? 'Hide' : 'Show'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: textSub }}>{show ? '🙈' : '👁️'}</button>
            </div>
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: textSub }}>Confirm new password</label>
            <input type={show ? 'text' : 'password'} required value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
              style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: textMain }} />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: bg }}>
            {loading ? 'Saving…' : 'Change password & continue'}
          </button>
          <button type="button" onClick={logout} className="block w-full text-center text-xs hover:underline" style={{ color: textSub }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
