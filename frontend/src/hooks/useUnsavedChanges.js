// src/hooks/useUnsavedChanges.js
// Warns the user before they lose unsaved edits.
//  1) Hard navigation (refresh, tab close, external URL) -> native browser prompt.
//  2) In-app link navigation (sidebar, etc.) -> confirm dialog before React Router navigates.
// This app uses <BrowserRouter> (no data-router useBlocker), so we guard in-app
// navigation by intercepting link clicks in the capture phase.
import { useEffect } from 'react';

export default function useUnsavedChanges(isDirty, message = 'You have unsaved changes. Leave without saving?') {
  useEffect(() => {
    if (!isDirty) return;

    const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);

    const clickCapture = (e) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      // Skip links that don't navigate the SPA away:
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('http')
        || href.startsWith('blob:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      // Same page -> no data loss, don't nag.
      try { if (a.pathname === window.location.pathname) return; } catch { /* ignore */ }
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('click', clickCapture, true);

    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', clickCapture, true);
    };
  }, [isDirty, message]);
}
