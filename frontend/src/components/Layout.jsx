// src/components/Layout.jsx
import { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useNotifications } from '../context/NotificationContext';
import { useOrg } from '../context/OrgContext';
import api from '../lib/api';

const NAV = [
  { to:'/', label:'Dashboard', icon:'⊞', exact:true },
  { to:'/expenses', label:'My Expenses', icon:'🧾' },
  { to:'/expenses/new', label:'Add Expense', icon:'+' },
];
const MANAGER_NAV = [
  { to:'/approvals', label:'Approvals', icon:'✓' },
  { to:'/reports', label:'Reports', icon:'📊' },
  { to:'/analytics', label:'Analytics', icon:'📈' },
];
const ADMIN_NAV = [
  { to:'/users', label:'Users', icon:'👥' },
  { to:'/settings', label:'Settings', icon:'⚙' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { currency, toggle } = useCurrency();
  const { notifications, unreadCount, pendingCounts, markAllRead } = useNotifications();
  const { settings, refresh, applyTheme } = useOrg();
  const navigate = useNavigate();
  const [showNotif, setShowNotif] = useState(false);
  const notifRef = useRef();

  const canApprove = ['MANAGER','FINANCE','ADMIN'].includes(user?.role);
  const isManagerOnly = user?.role === 'MANAGER'; // managers don't get Analytics
  const isAdmin = ['ADMIN','FINANCE'].includes(user?.role);
  const brandColor = settings?.primaryColor || '#1D9E75';
  const darkMode = settings?.darkMode || false;
  const hasWallpaper = !!settings?.wallpaperUrl;
  const initials = `${user?.firstName?.[0]||''}${user?.lastName?.[0]||''}`.toUpperCase() || 'U';

  useEffect(() => {
    const handler = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleDarkMode = async () => {
    try {
      const updated = await api.patch('/settings', { darkMode: !darkMode });
      applyTheme(updated);
      refresh();
    } catch(e) {}
  };

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'text-white font-medium' : 'text-gray-300 hover:bg-white/10 hover:text-white'
    }`;

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
      {/* Sidebar */}
      <aside className="w-52 flex flex-col shrink-0 z-10" style={{ backgroundColor: sidebarBg }}>
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate('/')}>
            {settings?.logoUrl
              ? <img src={settings.logoUrl} alt="Logo" className="w-7 h-7 rounded-lg object-cover" />
              : <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: brandColor }}>
                  {settings?.companyName?.[0] || 'X'}
                </div>
            }
            <span className="font-semibold text-white text-sm truncate">{settings?.companyName || 'XpenseTrack'}</span>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.exact} className={navLinkClass}
              style={({ isActive }) => isActive ? { backgroundColor: brandColor } : {}}>
              <span className="w-4 text-center text-sm">{item.icon}</span>
              <span>{item.label}</span>
              {item.to === '/expenses' && pendingCounts.myPending > 0 && (
                <span className="ml-auto bg-amber-400 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">{pendingCounts.myPending}</span>
              )}
            </NavLink>
          ))}

          {canApprove && (
            <>
              <p className="pt-3 pb-1 px-3 text-xs text-gray-400 uppercase tracking-wider font-medium">Management</p>
              {MANAGER_NAV.filter(item => !(isManagerOnly && item.to === '/analytics')).map(item => (
                <NavLink key={item.to} to={item.to} className={navLinkClass}
                  style={({ isActive }) => isActive ? { backgroundColor: brandColor } : {}}>
                  <span className="w-4 text-center text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.to === '/approvals' && pendingCounts.toApprove > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">{pendingCounts.toApprove}</span>
                  )}
                </NavLink>
              ))}
            </>
          )}

          {isAdmin && (
            <>
              <p className="pt-3 pb-1 px-3 text-xs text-gray-400 uppercase tracking-wider font-medium">Admin</p>
              {ADMIN_NAV.map(item => (
                <NavLink key={item.to} to={item.to} className={navLinkClass}
                  style={({ isActive }) => isActive ? { backgroundColor: brandColor } : {}}>
                  <span className="w-4 text-center text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: brandColor }}>
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
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-end px-6 gap-3 shrink-0 z-10"
          style={darkMode ? { backgroundColor: '#1e293b', borderColor: '#334155' } : {}}>

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
                  style={{ backgroundColor: brandColor, fontSize: '9px' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {showNotif && (
              <div className="absolute right-0 top-12 w-80 rounded-xl border shadow-xl z-50 overflow-hidden bg-white"
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

          <button onClick={() => navigate('/expenses/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-semibold hover:opacity-90"
            style={{ backgroundColor: brandColor }}>
            + New Expense
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6"
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
