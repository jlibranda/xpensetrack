// src/components/ReceiptImage.jsx
// Displays a receipt (image OR pdf). Clicking an image opens an in-app zoom
// modal (no new browser window), matching the Add Expense receipt zoom.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function ReceiptImage({ receiptId, className = '', onClick }) {
  const [src, setSrc] = useState('');
  const [isPdf, setIsPdf] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [pdfOpen, setPdfOpen] = useState(false);

  useEffect(() => {
    if (!receiptId) return;
    let revoked = '';
    const token = localStorage.getItem('token');
    const url = `${API_BASE}/ocr/receipt/${receiptId}?token=${encodeURIComponent(token)}`;
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

  const openZoom = () => { setZoomScale(1); setZoomOpen(true); };

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
          <button onClick={() => setPdfOpen(true)} className="mt-1 text-xs text-brand-400 hover:text-brand-600 flex items-center gap-1">
            🔍 View larger
          </button>
        </>
      )}

      {src && !isPdf && (
        <>
          <img
            src={src}
            alt="Receipt"
            className={`rounded-lg border border-gray-100 cursor-zoom-in hover:opacity-90 transition-opacity ${className}`}
            onClick={onClick || openZoom}
          />
          <button onClick={openZoom} className="mt-1 text-xs text-brand-400 hover:text-brand-600 flex items-center gap-1">
            🔍 Tap to zoom
          </button>
        </>
      )}

      {/* In-app zoom modal */}
      {zoomOpen && src && !isPdf && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 flex flex-col" onClick={() => setZoomOpen(false)}>
          <div className="flex items-center justify-between p-3 text-white text-sm">
            <span>Receipt</span>
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <button onClick={() => setZoomScale(s => Math.max(1, +(s - 0.5).toFixed(1)))}
                className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-lg leading-none">−</button>
              <span className="w-12 text-center">{Math.round(zoomScale * 100)}%</span>
              <button onClick={() => setZoomScale(s => Math.min(3, +(s + 0.5).toFixed(1)))}
                className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-lg leading-none">+</button>
              <button onClick={() => setZoomOpen(false)}
                className="ml-3 px-4 h-10 rounded-lg bg-white text-gray-900 font-semibold text-sm flex items-center gap-1.5 shadow-lg hover:bg-gray-100">
                ✕ Close
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 flex items-start justify-center" onClick={e => e.stopPropagation()}>
            <img src={src} alt="Receipt full"
              onClick={() => setZoomScale(s => (s >= 2.5 ? 1 : +(s + 0.5).toFixed(1)))}
              style={{ transform: `scale(${zoomScale})`, transformOrigin: 'top center', transition: 'transform 0.15s', cursor: zoomScale >= 2.5 ? 'zoom-out' : 'zoom-in' }}
              className="max-w-full max-h-[70vh] object-contain rounded-lg" />
          </div>
          <p className="text-center text-white/60 text-xs pb-3">Tap image to zoom · tap outside to close</p>
        </div>,
        document.body
      )}

      {/* In-app PDF viewer (browser's built-in PDF controls handle zoom/scroll) */}
      {pdfOpen && src && isPdf && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/85 flex flex-col" onClick={() => setPdfOpen(false)}>
          <div className="flex items-center justify-between p-3 text-white text-sm">
            <span>Receipt (PDF)</span>
            <button onClick={() => setPdfOpen(false)}
              className="px-4 h-10 rounded-lg bg-white text-gray-900 font-semibold text-sm flex items-center gap-1.5 shadow-lg hover:bg-gray-100">
              ✕ Close
            </button>
          </div>
          <div className="flex-1 px-3 pb-3" onClick={e => e.stopPropagation()}>
            <iframe src={src} title="Receipt PDF full" className="w-full h-full rounded-lg bg-white" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
