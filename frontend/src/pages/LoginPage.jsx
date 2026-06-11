// src/pages/LoginPage.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.error || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-400 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3">X</div>
          <h1 className="text-xl font-medium text-gray-900">XpenseTrack</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Email</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-500">Password</label>
              <Link to="/forgot-password" className="text-xs text-brand-400 hover:text-brand-600">Forgot password?</Link>
            </div>
            <input type="password" required value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60 transition-colors">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-xs text-gray-400 mt-4">Contact your admin to create an account.</p>
      </div>
    </div>
  );
}
