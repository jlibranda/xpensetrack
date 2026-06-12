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
  const isAdmin = ['ADMIN','FINANCE'].includes(user?.role);
  const brandColor = settings?.primaryColor || '#1D9E75';
  const darkMode = settings?.darkMode || false;
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

  const sidebarBg = darkMode ? '#0f0f1a' : '#1a1a2e';
  const mainBg = darkMode ? 'bg-gray-900' : 'bg-gray-50';
  const headerBg = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100';
  const textPrimary = darkMode ? 'text-white' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-500';

  const navClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'text-white font-medium' : 'text-gray-400 hover:bg-white/10 hover:text-white'
    }`;

  return (
    <div className={`flex h-screen font-sans ${mainBg}`}>
      {/* Sidebar */}
      <aside className="w-52 flex flex-col shrink-0" style={{ backgroundColor: sidebarBg }}>
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate('/')}>
            {settings?.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-7 h-7 rounded-lg object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                style={{ backgroundColor: brandColor }}>
                {settings?.companyName?.[0] || 'X'}
              </div>
            )}
            <span className="font-medium text-white text-sm truncate">{settings?.companyName || 'XpenseTrack'}</span>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.exact} className={navClass}
              style={({isActive}) => isActive ? {backgroundColor:brandColor} : {}}>
              <span className="w-4 text-center text-xs">{item.icon}</span>
              {item.label}
              {item.to === '/expenses' && pendingCounts.myPending > 0 && (
                <span className="ml-auto bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pendingCounts.myPending}</span>
              )}
            </NavLink>
          ))}

          {canApprove && (
            <>
              <div className="pt-3 pb-1 px-3 text-xs text-gray-500 uppercase tracking-wider">Management</div>
              {MANAGER_NAV.map(item => (
                <NavLink key={item.to} to={item.to} className={navClass}
                  style={({isActive}) => isActive ? {backgroundColor:brandColor} : {}}>
                  <span className="w-4 text-center text-xs">{item.icon}</span>
                  {item.label}
                  {item.to === '/approvals' && pendingCounts.toApprove > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pendingCounts.toApprove}</span>
                  )}
                </NavLink>
              ))}
            </>
          )}

          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-3 text-xs text-gray-500 uppercase tracking-wider">Admin</div>
              {ADMIN_NAV.map(item => (
                <NavLink key={item.to} to={item.to} className={navClass}
                  style={({isActive}) => isActive ? {backgroundColor:brandColor} : {}}>
                  <span className="w-4 text-center text-xs">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0 hover:opacity-80"
              style={{ backgroundColor: brandColor }}>
              {initials}
            </button>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate('/profile')}>
              <p className="text-xs font-medium text-white truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-400 truncate">{user?.role}</p>
            </div>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-gray-400 hover:text-white text-sm" title="Sign out">⏻</button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className={`h-14 border-b flex items-center justify-end px-6 gap-3 shrink-0 ${headerBg}`}>
          {/* Dark mode toggle */}
          <button onClick={toggleDarkMode}
            className={`p-2 rounded-lg transition-colors text-lg ${darkMode ? 'bg-gray-700 text-yellow-400 hover:bg-gray-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            {darkMode ? '☀️' : '🌙'}
          </button>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button onClick={() => setShowNotif(!showNotif)}
              className={`relative p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}`}>
              <span className="text-lg">🔔</span>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-white flex items-center justify-center"
                  style={{backgroundColor:brandColor, fontSize:'10px'}}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotif && (
              <div className={`absolute right-0 top-12 w-80 rounded-xl border shadow-lg z-50 overflow-hidden ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                <div className={`flex items-center justify-between px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-50'}`}>
                  <p className={`text-sm font-medium ${textPrimary}`}>Notifications</p>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className={`text-xs ${textSecondary} hover:text-gray-600`}>Mark all read</button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className={`py-8 text-center text-xs ${textSecondary}`}>No notifications</div>
                  ) : notifications.map(n => (
                    <div key={n.id}
                      onClick={() => { navigate(n.link||'/'); setShowNotif(false); }}
                      className={`px-4 py-3 border-b cursor-pointer transition-colors ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'border-gray-50 hover:bg-gray-50'} ${!n.read ? (darkMode?'bg-gray-700/50':'bg-blue-50') : ''}`}>
                      <p className={`text-xs font-medium ${textPrimary}`}>{n.title}</p>
                      <p className={`text-xs mt-0.5 ${textSecondary}`}>{n.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString('en-PH')}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={toggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {currency === 'PHP' ? '₱ PHP' : '$ USD'} <span className="text-xs opacity-50">↕</span>
          </button>

          <button onClick={() => navigate('/expenses/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: brandColor }}>
            + New Expense
          </button>
        </header>

        <main className={`flex-1 overflow-y-auto p-6 ${darkMode ? 'text-gray-100' : ''}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
