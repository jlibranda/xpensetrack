// src/pages/ResetPasswordPage.jsx
import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../lib/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError('');
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch(err) {
      setError(err.error || 'Reset failed. The link may have expired.');
    } finally { setLoading(false); }
  };

  if (!token) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-red-600 mb-2">Invalid reset link.</p>
        <Link to="/forgot-password" className="text-brand-400 text-sm">Request a new one →</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-400 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3">X</div>
          <h1 className="text-xl font-medium text-gray-900">Set new password</h1>
        </div>

        {success ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <p className="text-3xl mb-3">✅</p>
            <p className="text-sm font-medium text-gray-900">Password reset successfully!</p>
            <p className="text-xs text-gray-500 mt-2">Redirecting to sign in...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">New password</label>
              <input type="password" required value={password} onChange={e=>setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Confirm new password</label>
              <input type="password" required value={confirm} onChange={e=>setConfirm(e.target.value)}
                placeholder="Repeat password"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60">
              {loading ? 'Resetting...' : 'Reset password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
