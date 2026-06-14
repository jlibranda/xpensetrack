// src/components/ReceiptImage.jsx
// Displays a receipt (image OR pdf) by fetching it with the auth token.
import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function ReceiptImage({ receiptId, className = '', onClick }) {
  const [src, setSrc] = useState('');
  const [isPdf, setIsPdf] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!receiptId) return;
    let revoked = '';
    const token = localStorage.getItem('token');
    const url = `${API_BASE}/ocr/receipt/${receiptId}?token=${encodeURIComponent(token)}`;
    // Fetch as a blob so we can detect the content type (image vs pdf).
    fetch(url)
      .then(r => { if (!r.ok) throw new Error('load failed'); return r.blob(); })
      .then(blob => {
        setIsPdf(blob.type === 'application/pdf');
        const obj = URL.createObjectURL(blob);
        revoked = obj;
        setSrc(obj);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [receiptId]);

  if (!receiptId) return null;
  if (error) return (
    <div className="bg-gray-50 rounded-lg p-3 text-center text-xs text-gray-400">
      Could not load receipt
    </div>
  );

  const openFull = () => { if (src) window.open(src, '_blank'); };

  return (
    <div className="relative">
      {loading && <div className="bg-gray-50 rounded-lg h-32 animate-pulse" />}
      {src && isPdf && (
        <>
          <iframe
            src={src}
            title="Receipt PDF"
            className={`rounded-lg border border-gray-100 w-full ${className}`}
            style={{ minHeight: '12rem' }}
          />
          <button onClick={openFull} className="mt-1 text-xs text-brand-400 hover:text-brand-600 flex items-center gap-1">
            📄 Open PDF
          </button>
        </>
      )}
      {src && !isPdf && (
        <>
          <img
            src={src}
            alt="Receipt"
            className={`rounded-lg border border-gray-100 cursor-pointer hover:opacity-90 transition-opacity ${className}`}
            onClick={onClick || openFull}
          />
          <button onClick={openFull} className="mt-1 text-xs text-brand-400 hover:text-brand-600 flex items-center gap-1">
            🔍 View full size
          </button>
        </>
      )}
    </div>
  );
}
