// src/components/Layout.jsx
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useNotifications } from '../context/NotificationContext';
import { useOrg } from '../context/OrgContext';
import api from '../lib/api';

const NAV = [
  { to:'/', label:'Dashboard', icon:'⊞', exact:true },
  { to:'/expenses', label:'My Expenses', icon:'🧾', exact:true },
  { to:'/expenses/new', label:'Add Expense', icon:'+' },
];
const MANAGER_NAV = [
  { to:'/approvals', label:'My Approvals', icon:'✓', perm:'view_approvals' },
  { to:'/reports', label:'Reports', icon:'📊', perm:'view_reports' },
  { to:'/analytics', label:'Analytics', icon:'📈', perm:'view_analytics' },
];
const ADMIN_NAV = [
  { to:'/users', label:'Users', icon:'👥' },
  { to:'/settings', label:'Settings', icon:'⚙' },
];

// Mobile header brand: auto-shrinks the company name so the FULL name fits the
// available middle space (no truncation). Measures on mount, name change, resize.
// Auto-fit the company name into the available width by shrinking the font size
// until the WHOLE name fits (never truncated). Re-fits when the web font finishes
// loading and whenever the container resizes — the earlier version measured before
// the bold font loaded, so long names were being clipped.
function AutoFitText({ text, color, onClick, max = 20, min = 9, weight = 'bold', className = '' }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current, txt = textRef.current;
      if (!wrap || !txt || !text) return;
      const avail = wrap.clientWidth - 2;
      if (avail <= 0) return;
      let s = max;
      txt.style.fontSize = s + 'px';
      // Shrink one px at a time, measuring the real rendered width each step,
      // so kerning/rounding can't leave the last characters clipped.
      while (s > min && txt.scrollWidth > avail) { s -= 1; txt.style.fontSize = s + 'px'; }
      setSize(s);
    };
    fit();
    let ro;
    if (typeof ResizeObserver !== 'undefined' && wrapRef.current) {
      ro = new ResizeObserver(fit);
      ro.observe(wrapRef.current);
    }
    // Re-fit once the brand/web font is ready (fallback-font width differs).
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(() => {});
    window.addEventListener('resize', fit);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [text, max, min]);
  return (
    <div ref={wrapRef} className={`min-w-0 overflow-hidden ${className}`}>
      {text && (
        <span ref={textRef} onClick={onClick}
          className={`whitespace-nowrap leading-none ${weight === 'bold' ? 'font-bold' : 'font-semibold'} ${onClick ? 'cursor-pointer' : ''}`}
          style={{ fontSize: size, color }}>
          {text}
        </span>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { currency, toggle } = useCurrency();
  const { notifications, unreadCount, pendingCounts, markAllRead } = useNotifications();
  const { settings, loaded } = useOrg();
  const navigate = useNavigate();
  const [showNotif, setShowNotif] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const notifRef = useRef();

  const canApprove = ['MANAGER','FINANCE','ADMIN'].includes(user?.role);
  const isManagerOnly = user?.role === 'MANAGER'; // managers don't get Analytics
  // Permission check driven by Access Control settings (ADMIN always allowed).
  const DEFAULT_NAV_PERMS = {
    view_approvals: ['MANAGER','FINANCE','ADMIN'],
    view_reports: ['MANAGER','FINANCE','ADMIN'],
    manage_ap_ar: ['FINANCE','ADMIN'],
    view_analytics: ['FINANCE','ADMIN'],
  };
  const can = (perm) => {
    if (user?.role === 'ADMIN') return true;
    const allowed = settings?.accessControl?.[perm] || DEFAULT_NAV_PERMS[perm] || ['ADMIN'];
    return allowed.includes(user?.role);
  };
  // The Management section shows if the user can see any item in it (incl. an
  // Employee granted approvals or AP/AR access), or Transactions (Finance/Admin).
  const showManagement = MANAGER_NAV.some(item => can(item.perm)) || can('manage_ap_ar') || ['FINANCE','ADMIN'].includes(user?.role);
  // A nav item tagged with an in-development `feature` is visible to Admin always,
  // and to permitted roles only once the feature is switched on in Access Control.
  const navVisible = (item) => {
    if (item.feature && !(settings?.accessControl?.__features__ || {})[item.feature]) {
      return user?.role === 'ADMIN';
    }
    return can(item.perm);
  };
  // Settings/Users are reachable by their base roles OR any role granted the
  // relevant permission via Access Control.
  const SETTINGS_PERMS = ['manage_settings','edit_categories','manage_expense_types','manage_password','manage_access_control','upload_branding','change_branding'];
  const canSettings = ['ADMIN','FINANCE'].includes(user?.role) || SETTINGS_PERMS.some(p => can(p));
  const canUsers = user?.role === 'ADMIN' || can('manage_users');
  const canAudit = user?.role === 'ADMIN' || (settings?.accessControl?.view_audit_log || ['ADMIN']).includes(user?.role);
  const showAdmin = canSettings || canUsers || canAudit;
  const isAdmin = ['ADMIN','FINANCE'].includes(user?.role);
  const brandColor = settings?.primaryColor || '#1D9E75';
  const canManageApAr = user?.role === 'ADMIN' || (settings?.accessControl?.manage_ap_ar || ['FINANCE', 'ADMIN']).includes(user?.role);
  // Dark mode is a PERSONAL, per-device preference. If the user hasn't chosen,
  // fall back to the org default. Stored in localStorage so each user picks their own.
  const storedPref = (() => {
    const v = localStorage.getItem('personal_dark');
    return v === null ? null : v === 'true';
  })();
  const [darkMode, setDarkMode] = useState(storedPref !== null ? storedPref : (settings?.darkMode || false));
  const hasWallpaper = !!settings?.wallpaperUrl;
  const initials = `${user?.firstName?.[0]||''}${user?.lastName?.[0]||''}`.toUpperCase() || 'U';

  // Apply the personal dark preference to the DOM whenever it changes.
  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  // If the org default changes and the user has no personal choice yet, follow it.
  useEffect(() => {
    if (localStorage.getItem('personal_dark') === null && typeof settings?.darkMode === 'boolean') {
      setDarkMode(settings.darkMode);
    }
  }, [settings?.darkMode]);

  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('personal_dark', String(next)); // remember this user's choice on this device
  };

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'font-medium' : 'text-gray-300 hover:bg-white/10 hover:text-white'
    }`;
  // Active menu item: brand background with contrast-aware text (black when the
  // brand color is light, e.g. yellow) so the label stays readable.
  const navLinkStyle = ({ isActive }) => isActive
    ? { backgroundColor: brandColor, color: 'var(--brand-contrast,#fff)' }
    : {};

  const sidebarBg = darkMode ? '#0f172a' : '#1e293b';

  const adminToken = localStorage.getItem('admin_token');
  const adminName = localStorage.getItem('admin_name');
  const isImpersonating = !!adminToken;

  const returnToAdmin = () => {
    localStorage.setItem('token', adminToken);
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_name');
    window.location.href = '/users';
  };

  return (
    <div className="flex flex-col h-screen">
      {isImpersonating && (
        <div className="flex items-center justify-between px-4 py-2 text-white text-xs font-medium z-50 shrink-0"
          style={{backgroundColor:'#7c3aed'}}>
          <span>👁 Viewing as <strong>{user?.firstName} {user?.lastName}</strong> ({user?.role}) — accessed by admin {adminName}</span>
          <button onClick={returnToAdmin}
            className="px-3 py-1 bg-white text-purple-700 rounded-lg font-bold hover:bg-purple-50">
            ← Return to Admin
          </button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
      {/* Mobile backdrop when nav is open */}
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      {/* Sidebar: off-canvas drawer on mobile, fixed column on desktop */}
      <aside className={`w-52 flex flex-col shrink-0 z-30 fixed inset-y-0 left-0 transform transition-transform md:static md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ backgroundColor: sidebarBg }}>
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate('/')}>
            {settings?.logoUrl
              ? <img src={settings.logoUrl} alt="Logo" className="w-7 h-7 rounded-lg object-cover" />
              : <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: brandColor, color: 'var(--brand-contrast,#fff)' }}>
                  {settings?.companyName?.[0] || 'X'}
                </div>
            }
            <span className="flex-1 min-w-0 font-semibold text-white text-sm leading-tight break-words">{settings?.companyName || 'Cashalo'}</span>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto" onClick={() => setMobileNavOpen(false)}>
          {NAV.filter(item => !(showManagement && item.to === '/expenses')).map(item => (
            <NavLink key={item.to} to={item.to} end={item.exact} className={navLinkClass}
              style={navLinkStyle}>
              <span className="w-4 text-center text-sm">{item.icon}</span>
              <span>{item.label}</span>
              {item.to === '/expenses' && (pendingCounts.myPending > 0 || pendingCounts.myReturned > 0) && (
                <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">{(pendingCounts.myPending || 0) + (pendingCounts.myReturned || 0)}</span>
              )}
            </NavLink>
          ))}

          {/* AP & AR Invoice — grouped with Add Expense, gated like before */}
          {navVisible({ perm:'manage_ap_ar' }) && (
            <NavLink to="/payables" className={navLinkClass}
              style={navLinkStyle}>
              <span className="w-4 text-center text-sm">+</span>
              <span>Add AP &amp; AR Invoice</span>
            </NavLink>
          )}

          {showManagement && (
            <>
              <p className="pt-3 pb-1 px-3 text-xs text-gray-400 uppercase tracking-wider font-medium">Management</p>
              {['FINANCE','ADMIN'].includes(user?.role) && (
                <NavLink to="/transactions" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">💳</span>
                  <span>Transactions</span>
                </NavLink>
              )}
              {navVisible({ perm:'view_approvals' }) && (
                <NavLink to="/approvals" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">✓</span>
                  <span>My Approvals</span>
                  {(pendingCounts.toApprove + (pendingCounts.toApproveLedger || 0)) > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">{pendingCounts.toApprove + (pendingCounts.toApproveLedger || 0)}</span>
                  )}
                </NavLink>
              )}
              <NavLink to="/expenses" end className={navLinkClass}
                style={navLinkStyle}>
                <span className="w-4 text-center text-sm">🧾</span>
                <span>My Expenses</span>
                {(pendingCounts.myPending > 0 || pendingCounts.myReturned > 0) && (
                  <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">{(pendingCounts.myPending || 0) + (pendingCounts.myReturned || 0)}</span>
                )}
              </NavLink>
              {(navVisible({ perm:'manage_ap_ar' }) || navVisible({ perm:'view_approvals' })) && (
                <NavLink to="/ap-ar" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">📑</span>
                  <span>My AP &amp; AR Invoices</span>
                </NavLink>
              )}
              {navVisible({ perm:'view_reports' }) && (
                <NavLink to="/reports" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">📊</span>
                  <span>Reports</span>
                </NavLink>
              )}
              {navVisible({ perm:'view_analytics' }) && (
                <NavLink to="/analytics" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">📈</span>
                  <span>Analytics</span>
                </NavLink>
              )}
            </>
          )}

          {showAdmin && (
            <>
              <p className="pt-3 pb-1 px-3 text-xs text-gray-400 uppercase tracking-wider font-medium">Admin</p>
              {canUsers && (
                <NavLink to="/users" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">👥</span>
                  <span>Users</span>
                </NavLink>
              )}
              {canSettings && (
                <NavLink to="/settings" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">⚙</span>
                  <span>Settings</span>
                </NavLink>
              )}
              {canAudit && (
                <NavLink to="/audit" className={navLinkClass}
                  style={navLinkStyle}>
                  <span className="w-4 text-center text-sm">📋</span>
                  <span>Audit Logs</span>
                </NavLink>
              )}
            </>
          )}
        </nav>

        {settings?.tin && (
          <div className="md:hidden px-3 py-3 border-t border-white/10">
            <p className="text-xs text-gray-400">Employer TIN</p>
            <p className="text-sm font-semibold text-white tracking-wide">{settings.tin}</p>
          </div>
        )}
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: brandColor, color: 'var(--brand-contrast,#fff)' }}>
              {initials}
            </button>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate('/profile')}>
              <p className="text-xs font-semibold text-white truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-400">{user?.role}</p>
            </div>
          </div>
          <button onClick={() => { logout(); navigate('/login'); }}
            className="mt-3 w-full flex items-center justify-center px-4 py-3 rounded-lg text-base font-bold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-md tracking-wide">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 md:px-6 gap-3 shrink-0 z-10"
          style={darkMode ? { backgroundColor: '#1e293b', borderColor: '#334155' } : {}}>

          {/* Left: hamburger (mobile) + employer TIN */}
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button onClick={() => setMobileNavOpen(true)}
              className="p-2 rounded-lg text-xl md:hidden"
              style={darkMode ? { backgroundColor:'#334155', color:'#e2e8f0' } : { backgroundColor:'#f1f5f9', color:'#475569' }}
              aria-label="Open menu">
              ☰
            </button>
            {settings?.tin && (
              <span className="hidden md:inline text-sm font-medium whitespace-nowrap"
                style={{ color: darkMode ? '#cbd5e1' : '#475569' }}>
                <span style={{ color: darkMode ? '#64748b' : '#94a3b8' }}>TIN: </span>{settings.tin}
              </span>
            )}
          </div>

          {/* Center (mobile): company name auto-fit into the vacant middle space */}
          <AutoFitText text={loaded ? (settings?.companyName || '') : ''} color={darkMode ? '#f1f5f9' : '#111827'}
            onClick={() => navigate('/')} max={20} min={11}
            className="flex-1 flex justify-center md:justify-start md:hidden" />

          <div className="flex items-center gap-3 shrink-0 ml-auto">
          {/* + New AP/AR Invoice (desktop; mobile uses the FAB) */}
          {canManageApAr && (
            <button onClick={() => navigate('/payables')}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90 shrink-0"
              style={{ backgroundColor: brandColor, color: 'var(--brand-contrast,#fff)' }}>
              + New AP/AR Invoice
            </button>
          )}

          <button onClick={() => navigate('/expenses/new')}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90 shrink-0"
            style={{ backgroundColor: brandColor, color: 'var(--brand-contrast,#fff)' }}>
            + New Expense
          </button>

          {/* Dark/Light toggle */}
          <button onClick={toggleDarkMode}
            className="p-2 rounded-lg text-lg transition-colors"
            style={darkMode ? { backgroundColor:'#334155', color:'#fbbf24' } : { backgroundColor:'#f1f5f9', color:'#475569' }}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            {darkMode ? '☀️' : '🌙'}
          </button>

          {/* Bell */}
          <div className="relative" ref={notifRef}>
            <button onClick={() => setShowNotif(!showNotif)}
              className="relative p-2 rounded-lg transition-colors"
              style={darkMode ? { backgroundColor:'#334155' } : { backgroundColor:'#f1f5f9' }}>
              <span className="text-lg">🔔</span>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-white flex items-center justify-center font-bold"
                  style={{ backgroundColor: brandColor, fontSize: '9px', color: 'var(--brand-contrast,#fff)' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {showNotif && (
              <div className="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-80 rounded-xl border shadow-xl z-50 overflow-hidden bg-white"
                style={darkMode ? { backgroundColor:'#1e293b', borderColor:'#334155' } : { borderColor:'#e5e7eb' }}>
                <div className="flex items-center justify-between px-4 py-3 border-b"
                  style={{ borderColor: darkMode ? '#334155' : '#f3f4f6' }}>
                  <p className="text-sm font-semibold" style={{ color: darkMode ? '#f1f5f9' : '#111827' }}>Notifications</p>
                  {unreadCount > 0 && <button onClick={markAllRead} className="text-xs text-gray-400 hover:text-gray-600">Mark all read</button>}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0
                    ? <div className="py-8 text-center text-xs text-gray-400">No notifications</div>
                    : notifications.map(n => (
                      <div key={n.id} onClick={() => { navigate(n.link||'/'); setShowNotif(false); }}
                        className="px-4 py-3 border-b cursor-pointer"
                        style={{
                          borderColor: darkMode ? '#334155' : '#f9fafb',
                          backgroundColor: !n.read ? (darkMode ? '#1e3a5f' : '#eff6ff') : 'transparent',
                        }}>
                        <p className="text-xs font-semibold" style={{ color: darkMode ? '#f1f5f9' : '#111827' }}>{n.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: darkMode ? '#94a3b8' : '#6b7280' }}>{n.message}</p>
                        <p className="text-xs mt-1 text-gray-400">{new Date(n.createdAt).toLocaleString('en-PH')}</p>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>

          <button onClick={toggle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors"
            style={darkMode ? { borderColor:'#475569', color:'#e2e8f0', backgroundColor:'#334155' } : { borderColor:'#e5e7eb', color:'#374151' }}>
            {currency === 'PHP' ? '₱ PHP' : '$ USD'} <span className="opacity-40 text-xs">↕</span>
          </button>
          </div>
        </header>

        {/* Mobile speed-dial: one “+” that lets you pick Expense or AP/AR */}
        <div className="md:hidden">
          {fabOpen && <div className="fixed inset-0 z-30" onClick={() => setFabOpen(false)} />}
          <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
            {fabOpen && (
              <>
                <button onClick={() => { setFabOpen(false); navigate('/expenses/new'); }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-gray-800 text-sm font-medium shadow-lg border border-gray-100">
                  🧾 New Expense
                </button>
                {navVisible({ perm:'manage_ap_ar' }) && (
                  <button onClick={() => { setFabOpen(false); navigate('/payables'); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-gray-800 text-sm font-medium shadow-lg border border-gray-100">
                    📑 New AP / AR
                  </button>
                )}
              </>
            )}
            <button onClick={() => setFabOpen(o => !o)}
              className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
              style={{ backgroundColor: brandColor, color: 'var(--brand-contrast,#fff)' }} aria-label="Quick add">
              <span className={`text-3xl leading-none transition-transform ${fabOpen ? 'rotate-45' : ''}`}>+</span>
            </button>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6"
          style={hasWallpaper
            ? { backgroundColor: 'transparent' }
            : (darkMode ? { backgroundColor: '#0f172a' } : { backgroundColor: '#f8fafc' })}>
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}
