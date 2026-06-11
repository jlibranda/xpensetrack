// src/components/Layout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '⊞', exact: true },
  { to: '/expenses', label: 'My Expenses', icon: '🧾' },
  { to: '/expenses/new', label: 'Add Expense', icon: '+' },
];
const MANAGER_NAV = [
  { to: '/approvals', label: 'Approvals', icon: '✓' },
  { to: '/reports', label: 'Reports', icon: '📊' },
];
const ADMIN_NAV = [
  { to: '/users', label: 'Users', icon: '👥' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { currency, toggle } = useCurrency();
  const navigate = useNavigate();
  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const canApprove = ['MANAGER', 'FINANCE', 'ADMIN'].includes(user?.role);
  const isAdmin = ['ADMIN', 'FINANCE'].includes(user?.role);

  const navClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-brand-50 text-brand-600 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
    }`;

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      <aside className="w-52 bg-white border-r border-gray-100 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-400 flex items-center justify-center text-white text-sm font-medium">X</div>
            <span className="font-medium text-gray-900">XpenseTrack</span>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.exact} className={navClass}>
              <span className="w-4 text-center text-base">{item.icon}</span>{item.label}
            </NavLink>
          ))}
          {canApprove && <>
            <div className="pt-3 pb-1 px-3 text-xs text-gray-400 uppercase tracking-wider">Management</div>
            {MANAGER_NAV.map(item => <NavLink key={item.to} to={item.to} className={navClass}><span className="w-4 text-center text-base">{item.icon}</span>{item.label}</NavLink>)}
          </>}
          {isAdmin && <>
            <div className="pt-3 pb-1 px-3 text-xs text-gray-400 uppercase tracking-wider">Admin</div>
            {ADMIN_NAV.map(item => <NavLink key={item.to} to={item.to} className={navClass}><span className="w-4 text-center text-base">{item.icon}</span>{item.label}</NavLink>)}
          </>}
        </nav>
        <div className="p-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/profile')} className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xs font-medium shrink-0 hover:bg-brand-200 transition-colors">
              {initials}
            </button>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate('/profile')}>
              <p className="text-xs font-medium text-gray-900 truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 truncate">{user?.role}</p>
            </div>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-xs text-gray-400 hover:text-gray-600 px-1" title="Sign out">⏻</button>
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-end px-6 gap-3 shrink-0">
          <button onClick={toggle} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <span className="font-medium">{currency === 'PHP' ? '₱ PHP' : '$ USD'}</span>
            <span className="text-gray-400 text-xs">↕</span>
          </button>
          <button onClick={() => navigate('/expenses/new')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-400 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
            + New Expense
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-6"><Outlet /></main>
      </div>
    </div>
  );
}
