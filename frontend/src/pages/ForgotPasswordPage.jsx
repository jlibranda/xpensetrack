// src/pages/ForgotPasswordPage.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-400 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3">X</div>
          <h1 className="text-xl font-medium text-gray-900">Forgot password</h1>
          <p className="text-sm text-gray-500 mt-1">Enter the user's email to generate a reset link</p>
        </div>

        {result ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            {result.emailSent ? (
              <div className="text-center">
                <p className="text-3xl mb-3">📧</p>
                <p className="text-sm font-medium text-gray-900 mb-2">Reset email sent!</p>
                <p className="text-sm text-gray-500">A password reset link was sent to <b>{email}</b>.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">🔗</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Reset link generated</p>
                    <p className="text-xs text-gray-500">Email not configured — copy and share this link with the user:</p>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
                  <p className="text-xs text-gray-600 break-all font-mono">{result.resetUrl}</p>
                </div>

                <button onClick={copyLink}
                  className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors mb-3 ${
                    copied ? 'bg-green-500 text-white' : 'bg-brand-400 text-white hover:bg-brand-600'
                  }`}>
                  {copied ? '✓ Copied!' : '📋 Copy reset link'}
                </button>

                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700">
                  <p className="font-medium mb-1">⚠️ How to share:</p>
                  <p>1. Copy the link above</p>
                  <p>2. Send it to <b>{email}</b> via SMS, chat, or email</p>
                  <p>3. Link expires in 1 hour</p>
                </div>
              </div>
            )}

            <div className="mt-4 text-center">
              <button onClick={() => setResult(null)} className="text-sm text-brand-400 hover:text-brand-600 mr-4">
                Generate another
              </button>
              <Link to="/login" className="text-sm text-gray-400 hover:text-gray-600">← Back to sign in</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">User's email address</label>
              <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="employee@company.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-brand-400 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60">
              {loading ? 'Generating...' : 'Generate reset link'}
            </button>
            <Link to="/login" className="block text-center text-xs text-gray-400 hover:text-gray-600">← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
