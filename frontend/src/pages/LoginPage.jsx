// src/pages/LoginPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState({ companyName:'XpenseTrack', primaryColor:'#1D9E75', logoUrl:null, wallpaperUrl:null });
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Login screen is always light — clear any dark theme left over from a prior session
    document.documentElement.classList.remove('dark');
    fetch(`${API_BASE}/settings/public`)
      .then(r => r.json())
      .then(s => { if (s?.primaryColor) setBranding(s); })
      .catch(() => {});
  }, []);

  const bg = branding.primaryColor || '#1D9E75';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch(err) {
      // Error stays visible — never auto-dismisses
      setError(err.error || 'Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Clear error only when user starts typing again
  const handleEmailChange = (e) => { setEmail(e.target.value); if (error) setError(''); };
  const handlePasswordChange = (e) => { setPassword(e.target.value); if (error) setError(''); };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative"
      style={branding.wallpaperUrl ? {
        backgroundImage: `url(${branding.wallpaperUrl})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
      } : { backgroundColor: '#f3f4f6' }}>

      {branding.wallpaperUrl && <div className="absolute inset-0 bg-black/50" />}

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
          <h1 className={`text-xl font-semibold ${branding.wallpaperUrl ? 'text-white' : 'text-gray-900'}`}>
            {branding.companyName || 'XpenseTrack'}
          </h1>
          <p className={`text-sm mt-1 ${branding.wallpaperUrl ? 'text-white/70' : 'text-gray-500'}`}>
            Sign in to your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          {/* Error stays until user types again */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700 flex items-start gap-2">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Email address</label>
            <input type="email" required value={email} onChange={handleEmailChange}
              placeholder="you@company.com" autoFocus
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-500">Password</label>
              <Link to="/forgot-password" className="text-xs hover:underline" style={{ color: bg }}>
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} required value={password} onChange={handlePasswordChange}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all" />
              <button type="button" onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1">
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
        <p className={`text-center text-xs mt-4 ${branding.wallpaperUrl ? 'text-white/60' : 'text-gray-400'}`}>
          Contact your admin to create an account.
        </p>
      </div>
    </div>
  );
}
