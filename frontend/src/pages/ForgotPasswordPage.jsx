// src/pages/ForgotPasswordPage.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
const readDark = () => { try { return localStorage.getItem('personal_dark') === 'true'; } catch { return false; } };
const DEFAULT_BRANDING = { companyName:'Cashalo', primaryColor:'#1D9E75', logoUrl:null, wallpaperUrl:null };
const readCachedBranding = () => {
  try { const v = localStorage.getItem('cached_branding'); return v ? JSON.parse(v) : DEFAULT_BRANDING; } catch { return DEFAULT_BRANDING; }
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [dark, setDark] = useState(readDark());
  const [branding, setBranding] = useState(readCachedBranding());

  useEffect(() => {
    fetch(`${API_BASE}/settings/public`)
      .then(r => r.json())
      .then(s => {
        if (s?.primaryColor) {
          setBranding(s);
          try { localStorage.setItem('cached_branding', JSON.stringify(s)); } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem('personal_dark', String(next)); } catch {}
  };

  const bg = branding.primaryColor || '#1D9E75';
  const hasWall = !!branding.wallpaperUrl;
  const pageBg = dark ? '#0f172a' : '#f9fafb';
  const cardBg = dark ? '#1e293b' : '#ffffff';
  const cardBorder = dark ? '#334155' : '#f3f4f6';
  const inputBg = dark ? '#0f172a' : '#ffffff';
  const inputBorder = dark ? '#334155' : '#e5e7eb';
  const textMain = dark ? '#f1f5f9' : '#111827';
  const textSub = dark ? '#94a3b8' : '#6b7280';
  const labelColor = dark ? '#cbd5e1' : '#6b7280';
  const headTitle = hasWall ? '#ffffff' : textMain;
  const headSub = hasWall ? 'rgba(255,255,255,0.7)' : textSub;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      // The server always returns a generic message and never reveals whether
      // the account exists or includes the reset link in the response.
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      // Even on error we show the same neutral confirmation, to avoid leaking info.
      setSent(true);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative"
      style={hasWall ? { backgroundImage: `url(${branding.wallpaperUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { backgroundColor: pageBg }}>

      {hasWall && <div className="absolute inset-0" style={{ backgroundColor: dark ? 'rgba(15,23,42,0.7)' : 'rgba(0,0,0,0.5)' }} />}

      <button onClick={toggleDark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="absolute top-4 right-4 z-20 p-2 rounded-lg text-lg shadow"
        style={{ backgroundColor: dark ? '#334155' : '#ffffff', color: dark ? '#fbbf24' : '#475569' }}>
        {dark ? '☀️' : '🌙'}
      </button>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" className="w-16 h-16 rounded-2xl object-cover mx-auto mb-3 shadow-lg" />
          ) : (
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-3" style={{ backgroundColor: bg }}>
              {branding.companyName?.[0] || 'C'}
            </div>
          )}
          <h1 className="text-xl font-medium" style={{ color: headTitle }}>Forgot password</h1>
          <p className="text-sm mt-1" style={{ color: headSub }}>Enter your email and we'll send you a reset link</p>
        </div>

        {sent ? (
          <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
            <p className="text-3xl mb-3">📧</p>
            <p className="text-sm font-medium mb-2" style={{ color: textMain }}>Check your email</p>
            <p className="text-sm" style={{ color: textSub }}>
              If an account exists for <b>{email}</b>, a password reset link has been sent. The link expires in 1 hour.
            </p>
            <p className="text-xs mt-3" style={{ color: textSub }}>Don't see it? Check your spam folder.</p>
            <div className="mt-4">
              <Link to="/login" className="text-sm hover:underline" style={{ color: bg }}>← Back to sign in</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
            {error && (
              <div className="rounded-lg px-3 py-2 text-sm"
                style={{ backgroundColor: dark ? 'rgba(220,38,38,0.15)' : '#fef2f2', border: `1px solid ${dark ? 'rgba(220,38,38,0.4)' : '#fecaca'}`, color: dark ? '#fca5a5' : '#b91c1c' }}>{error}</div>
            )}
            <div>
              <label className="block text-xs mb-1.5" style={{ color: labelColor }}>Email address</label>
              <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
                style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: textMain }} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: bg }}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <Link to="/login" className="block text-center text-xs hover:underline" style={{ color: textSub }}>← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
