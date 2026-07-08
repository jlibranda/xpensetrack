// src/pages/LoginPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';

const readDark = () => {
  try { const v = localStorage.getItem('personal_dark'); return v === 'true'; } catch { return false; }
};

const DEFAULT_BRANDING = { companyName:'Cashalo', primaryColor:'#1D9E75', logoUrl:null, wallpaperUrl:null };
// Read the last-known branding so the page shows the real logo/colors instantly,
// instead of flashing the default green "X" until the network fetch returns.
const readCachedBranding = () => {
  try { const v = localStorage.getItem('cached_branding'); return v ? JSON.parse(v) : DEFAULT_BRANDING; } catch { return DEFAULT_BRANDING; }
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(readDark());
  const [branding, setBranding] = useState(readCachedBranding());
  const { login } = useAuth();
  const navigate = useNavigate();

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

  // Keep the global `html.dark` class in sync with the toggle. The app's CSS
  // applies dark styling to inputs and the page body via `html.dark` !important
  // rules, so without this the toggle would only restyle part of the page.
  useEffect(() => {
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [dark]);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem('personal_dark', String(next)); } catch {}
  };

  const bg = branding.primaryColor || '#1D9E75';
  const hasWall = !!branding.wallpaperUrl;

  // Theme-aware colors
  const pageBg = dark ? '#0f172a' : '#f3f4f6';
  const cardBg = dark ? '#1e293b' : '#ffffff';
  const inputBg = dark ? '#0f172a' : '#ffffff';
  const inputBorder = dark ? '#334155' : '#e5e7eb';
  const textMain = dark ? '#f1f5f9' : '#111827';
  const textSub = dark ? '#94a3b8' : '#6b7280';
  const labelColor = dark ? '#cbd5e1' : '#6b7280';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch(err) {
      setError(err.error || 'Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailChange = (e) => { setEmail(e.target.value); if (error) setError(''); };
  const handlePasswordChange = (e) => { setPassword(e.target.value); if (error) setError(''); };

  // On a wallpaper, header text stays white for contrast; otherwise theme-aware.
  const headTitle = hasWall ? '#ffffff' : textMain;
  const headSub = hasWall ? 'rgba(255,255,255,0.7)' : textSub;
  const footText = hasWall ? 'rgba(255,255,255,0.6)' : textSub;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative"
      style={hasWall ? {
        backgroundImage: `url(${branding.wallpaperUrl})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
      } : { backgroundColor: pageBg }}>

      {/* Overlay: darker in dark mode for readability */}
      {hasWall && <div className="absolute inset-0" style={{ backgroundColor: dark ? 'rgba(15,23,42,0.7)' : 'rgba(0,0,0,0.5)' }} />}

      {/* Dark/Light toggle */}
      <button onClick={toggleDark}
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="absolute top-4 right-4 z-20 p-2 rounded-lg text-lg shadow"
        style={{ backgroundColor: dark ? '#334155' : '#ffffff', color: dark ? '#fbbf24' : '#475569' }}>
        {dark ? '☀️' : '🌙'}
      </button>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-6">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" className="w-16 h-16 rounded-2xl object-cover mx-auto mb-3 shadow-lg" />
          ) : (
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3 shadow-lg"
              style={{ backgroundColor: bg }}>
              {branding.companyName?.[0] || 'X'}
            </div>
          )}
          <h1 className="text-xl font-semibold" style={{ color: headTitle }}>
            {branding.companyName || 'Cashalo'}
          </h1>
          <p className="text-sm mt-1" style={{ color: headSub }}>
            Sign in to your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl shadow-xl p-6 space-y-4"
          style={{ backgroundColor: cardBg }}>
          {error && (
            <div className="rounded-lg px-3 py-2.5 text-sm flex items-start gap-2"
              style={{ backgroundColor: dark ? 'rgba(220,38,38,0.15)' : '#fef2f2', border: `1px solid ${dark ? 'rgba(220,38,38,0.4)' : '#fecaca'}`, color: dark ? '#fca5a5' : '#b91c1c' }}>
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: labelColor }}>Email address</label>
            <input type="email" required value={email} onChange={handleEmailChange}
              placeholder="you@company.com" autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none transition-all"
              style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: textMain }} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs" style={{ color: labelColor }}>Password</label>
              <Link to="/forgot-password" className="text-xs hover:underline" style={{ color: bg }}>Forgot password?</Link>
            </div>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} required value={password} onChange={handlePasswordChange}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 pr-10 rounded-lg text-sm focus:outline-none transition-all"
                style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: textMain }} />
              <button type="button" onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                style={{ color: textSub }}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-60 transition-all hover:opacity-90 shadow-sm"
            style={{ backgroundColor: bg }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-xs mt-4" style={{ color: footText }}>
          Contact your admin to create an account.
        </p>
      </div>
    </div>
  );
}
