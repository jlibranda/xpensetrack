// src/pages/ForgotPasswordPage.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setSent(true);
      if (res.resetUrl) setDevUrl(res.resetUrl); // dev mode only
    } catch(err) {
      setError(err.error || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-400 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3">X</div>
          <h1 className="text-xl font-medium text-gray-900">Forgot password</h1>
          <p className="text-sm text-gray-500 mt-1">We'll send you a reset link</p>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <p className="text-3xl mb-3">📧</p>
            <p className="text-sm font-medium text-gray-900 mb-2">Check your email</p>
            <p className="text-sm text-gray-500 mb-4">If <b>{email}</b> is registered, we sent a password reset link. Check your inbox and spam folder.</p>
            {devUrl && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4 text-left">
                <p className="text-xs font-medium text-amber-700 mb-1">🛠 Dev mode — reset link:</p>
                <a href={devUrl} className="text-xs text-brand-400 break-all hover:underline">{devUrl}</a>
              </div>
            )}
            <Link to="/login" className="text-sm text-brand-400 hover:text-brand-600">← Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Email address</label>
              <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60">
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <Link to="/login" className="block text-center text-xs text-gray-400 hover:text-gray-600">← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
