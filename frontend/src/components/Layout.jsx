// src/components/Layout.jsx
import { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useNotifications } from '../context/NotificationContext';
import { useOrg } from '../context/OrgContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '⊞', exact: true },
  { to: '/expenses', label: 'My Expenses', icon: '🧾' },
  { to: '/expenses/new', label: 'Add Expense', icon: '+' },
];
const MANAGER_NAV = [
  { to: '/approvals', label: 'Approvals', icon: '✓' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/analytics', label: 'Analytics', icon: '📈' },
];
const ADMIN_NAV = [
  { to: '/users', label: 'Users', icon: '👥' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { currency, toggle } = useCurrency();
  const { notifications, unreadCount, pendingCounts, markAllRead } = useNotifications();
  const { settings } = useOrg();
  const navigate = useNavigate();
  const [showNotif, setShowNotif] = useState(false);
  const notifRef = useRef();

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const canApprove = ['MANAGER', 'FINANCE', 'ADMIN'].includes(user?.role);
  const isAdmin = ['ADMIN', 'FINANCE'].includes(user?.role);
  const brandColor = settings?.primaryColor || '#1D9E75';

  useEffect(() => {
    const handler = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const navClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'text-white font-medium' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
    }`;

  const activeStyle = { backgroundColor: brandColor + '33' };

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col shrink-0" style={{ backgroundColor: '#1a1a2e' }}>
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            {settings?.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-7 h-7 rounded-lg object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                style={{ backgroundColor: brandColor }}>X</div>
            )}
            <span className="font-medium text-white text-sm truncate">{settings?.companyName || 'XpenseTrack'}</span>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.exact}
              className={navClass}
              style={({ isActive }) => isActive ? { backgroundColor: brandColor, color: 'white' } : {}}>
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
              {item.to === '/expenses' && pendingCounts.myPending > 0 && (
                <span className="ml-auto bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {pendingCounts.myPending}
                </span>
              )}
            </NavLink>
          ))}

          {canApprove && (
            <>
              <div className="pt-3 pb-1 px-3 text-xs text-gray-500 uppercase tracking-wider">Management</div>
              {MANAGER_NAV.map(item => (
                <NavLink key={item.to} to={item.to} className={navClass}
                  style={({ isActive }) => isActive ? { backgroundColor: brandColor, color: 'white' } : {}}>
                  <span className="w-4 text-center">{item.icon}</span>
                  {item.label}
                  {item.to === '/approvals' && pendingCounts.toApprove > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {pendingCounts.toApprove}
                    </span>
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
                  style={({ isActive }) => isActive ? { backgroundColor: brandColor, color: 'white' } : {}}>
                  <span className="w-4 text-center">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-gray-700">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0 hover:opacity-80"
              style={{ backgroundColor: brandColor }}>
              {initials}
            </button>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate('/profile')}>
              <p className="text-xs font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 truncate">{user?.role}</p>
            </div>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-gray-400 hover:text-white text-sm" title="Sign out">⏻</button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-end px-6 gap-3 shrink-0">
          {/* Notification bell */}
          <div className="relative" ref={notifRef}>
            <button onClick={() => setShowNotif(!showNotif)}
              className="relative p-2 rounded-lg hover:bg-gray-50 transition-colors">
              <span className="text-lg">🔔</span>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-white text-xs flex items-center justify-center"
                  style={{ backgroundColor: brandColor, fontSize: '10px' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotif && (
              <div className="absolute right-0 top-12 w-80 bg-white rounded-xl border border-gray-100 shadow-lg z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                  <p className="text-sm font-medium text-gray-900">Notifications</p>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-gray-400 hover:text-gray-600">Mark all read</button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-gray-400">No notifications</div>
                  ) : notifications.map(n => (
                    <div key={n.id}
                      onClick={() => { navigate(n.link || '/'); setShowNotif(false); }}
                      className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${!n.read ? 'bg-blue-50' : ''}`}>
                      <p className="text-xs font-medium text-gray-900">{n.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                      <p className="text-xs text-gray-300 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={toggle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
            <span className="font-medium">{currency === 'PHP' ? '₱ PHP' : '$ USD'}</span>
            <span className="text-gray-400 text-xs">↕</span>
          </button>
          <button onClick={() => navigate('/expenses/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: brandColor }}>
            + New Expense
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
