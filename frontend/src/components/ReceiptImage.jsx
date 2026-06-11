// src/components/ReceiptImage.jsx
// Displays a receipt image by fetching it with auth token
import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function ReceiptImage({ receiptId, className = '', onClick }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!receiptId) return;
    const token = localStorage.getItem('token');
    // Add token as query param so img tag can load it
    const url = `${API_BASE}/ocr/receipt/${receiptId}?token=${encodeURIComponent(token)}`;
    setSrc(url);
    setLoading(false);
  }, [receiptId]);

  if (!receiptId) return null;
  if (error) return (
    <div className="bg-gray-50 rounded-lg p-3 text-center text-xs text-gray-400">
      Could not load receipt
    </div>
  );

  const openFull = () => {
    const token = localStorage.getItem('token');
    window.open(`${API_BASE}/ocr/receipt/${receiptId}?token=${encodeURIComponent(token)}`, '_blank');
  };

  return (
    <div className="relative">
      {loading && <div className="bg-gray-50 rounded-lg h-32 animate-pulse" />}
      {src && (
        <>
          <img
            src={src}
            alt="Receipt"
            className={`rounded-lg border border-gray-100 cursor-pointer hover:opacity-90 transition-opacity ${className}`}
            onLoad={() => setLoading(false)}
            onError={() => { setError(true); setLoading(false); }}
            onClick={onClick || openFull}
          />
          <button
            onClick={openFull}
            className="mt-1 text-xs text-brand-400 hover:text-brand-600 flex items-center gap-1"
          >
            🔍 View full size
          </button>
        </>
      )}
    </div>
  );
}
