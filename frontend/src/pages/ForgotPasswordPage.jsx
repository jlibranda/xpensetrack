// src/pages/ForgotPasswordPage.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
const readDark = () => { try { return localStorage.getItem('personal_dark') === 'true'; } catch { return false; } };
const DEFAULT_BRANDING = { companyName:'XpenseTrack', primaryColor:'#1D9E75', logoUrl:null, wallpaperUrl:null };
const readCachedBranding = () => {
  try { const v = localStorage.getItem('cached_branding'); return v ? JSON.parse(v) : DEFAULT_BRANDING; } catch { return DEFAULT_BRANDING; }
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
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
      const res = await api.post('/auth/forgot-password', { email });
      setResult(res);
    } catch(err) {
      setError(err.error || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(result.resetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative"
      style={hasWall ? {
        backgroundImage: `url(${branding.wallpaperUrl})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
      } : { backgroundColor: pageBg }}>

      {hasWall && <div className="absolute inset-0" style={{ backgroundColor: dark ? 'rgba(15,23,42,0.7)' : 'rgba(0,0,0,0.5)' }} />}

      <button onClick={toggleDark}
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="absolute top-4 right-4 z-20 p-2 rounded-lg text-lg shadow"
        style={{ backgroundColor: dark ? '#334155' : '#ffffff', color: dark ? '#fbbf24' : '#475569' }}>
        {dark ? '☀️' : '🌙'}
      </button>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" className="w-16 h-16 rounded-2xl object-cover mx-auto mb-3 shadow-lg" />
          ) : (
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-3"
              style={{ backgroundColor: bg }}>
              {branding.companyName?.[0] || 'X'}
            </div>
          )}
          <h1 className="text-xl font-medium" style={{ color: headTitle }}>Forgot password</h1>
          <p className="text-sm mt-1" style={{ color: headSub }}>Enter the user's email to generate a reset link</p>
        </div>

        {result ? (
          <div className="rounded-2xl p-6" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
            {result.emailSent ? (
              <div className="text-center">
                <p className="text-3xl mb-3">📧</p>
                <p className="text-sm font-medium mb-2" style={{ color: textMain }}>Reset email sent!</p>
                <p className="text-sm" style={{ color: textSub }}>A password reset link was sent to <b>{email}</b>.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">🔗</span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: textMain }}>Reset link generated</p>
                    <p className="text-xs" style={{ color: textSub }}>Email not configured — copy and share this link with the user:</p>
                  </div>
                </div>

                <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}` }}>
                  <p className="text-xs break-all font-mono" style={{ color: textSub }}>{result.resetUrl}</p>
                </div>

                <button onClick={copyLink}
                  className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors mb-3 text-white"
                  style={{ backgroundColor: copied ? '#16a34a' : bg }}>
                  {copied ? '✓ Copied!' : '📋 Copy reset link'}
                </button>

                <div className="rounded-lg p-3 text-xs"
                  style={{ backgroundColor: dark ? 'rgba(217,119,6,0.15)' : '#fffbeb', border: `1px solid ${dark ? 'rgba(217,119,6,0.4)' : '#fde68a'}`, color: dark ? '#fcd34d' : '#b45309' }}>
                  <p className="font-medium mb-1">⚠️ How to share:</p>
                  <p>1. Copy the link above</p>
                  <p>2. Send it to <b>{email}</b> via SMS, chat, or email</p>
                  <p>3. Link expires in 1 hour</p>
                </div>
              </div>
            )}

            <div className="mt-4 text-center">
              <button onClick={() => setResult(null)} className="text-sm mr-4 hover:underline" style={{ color: bg }}>
                Generate another
              </button>
              <Link to="/login" className="text-sm hover:underline" style={{ color: textSub }}>← Back to sign in</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
            {error && (
              <div className="rounded-lg px-3 py-2 text-sm"
                style={{ backgroundColor: dark ? 'rgba(220,38,38,0.15)' : '#fef2f2', border: `1px solid ${dark ? 'rgba(220,38,38,0.4)' : '#fecaca'}`, color: dark ? '#fca5a5' : '#b91c1c' }}>{error}</div>
            )}
            <div>
              <label className="block text-xs mb-1.5" style={{ color: labelColor }}>User's email address</label>
              <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="employee@company.com"
                className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
                style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: textMain }} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: bg }}>
              {loading ? 'Generating...' : 'Generate reset link'}
            </button>
            <Link to="/login" className="block text-center text-xs hover:underline" style={{ color: textSub }}>← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
