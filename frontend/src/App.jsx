// src/App.jsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { NotificationProvider } from './context/NotificationContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import Layout from './components/Layout';
import Toaster from './components/Toaster';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import DashboardPage from './pages/DashboardPage';
import ExpensesPage from './pages/ExpensesPage';
import AddExpensePage from './pages/AddExpensePage';
import ApprovalsPage from './pages/ApprovalsPage';
import ReportsPage from './pages/ReportsPage';
import LedgerPage from './pages/LedgerPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import TransactionsPage from './pages/TransactionsPage';
import AuditLogPage from './pages/AuditLogPage';
import EmployeePage from './pages/EmployeePage';
import ProfilePage from './pages/ProfilePage';
import ChangePasswordPage from './pages/ChangePasswordPage';

// Branded loading screen — shows the org logo + primary color. It prefers the
// cached branding (saved by the login/settings pages), but if the cache was
// cleared (e.g. after a "clear site data"), it falls back to the PUBLIC logo
// endpoint so the real logo still appears instead of a bare letter.
const LOADER_API = import.meta.env.VITE_API_URL || 'https://xpensetrack-production.up.railway.app/api';
function BrandedLoader() {
  let b = { companyName: 'Cashalo', primaryColor: '#1D9E75', logoUrl: null };
  try { const v = localStorage.getItem('cached_branding'); if (v) b = { ...b, ...JSON.parse(v) }; } catch {}
  const [imgOk, setImgOk] = useState(true);
  const logoSrc = b.logoUrl || `${LOADER_API}/settings/logo`;
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="relative w-16 h-16 mx-auto mb-3 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full animate-spin"
            style={{ border: '3px solid rgba(0,0,0,0.08)', borderTopColor: b.primaryColor || '#1D9E75' }} />
          {imgOk ? (
            <img src={logoSrc} alt={b.companyName} onError={() => setImgOk(false)}
              className="w-11 h-11 rounded-xl object-cover" />
          ) : (
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-lg font-bold"
              style={{ backgroundColor: b.primaryColor || '#1D9E75' }}>{(b.companyName || 'C')[0]}</div>
          )}
        </div>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}

function PrivateRoute({ children, roles, permission, anyPermission, feature }) {
  const { user, loading } = useAuth();
  const { settings } = useOrg();
  if (loading) return <BrandedLoader />;
  if (!user) return <Navigate to="/login" replace />;
  // Force a password change after logging in with a temporary password.
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  // ADMIN always allowed. A single `permission` checks the access-control list
  // for that key (falling back to `roles`). `anyPermission` grants access if the
  // role is in the base `roles` floor OR has been granted ANY of those perms.
  if (user.role !== 'ADMIN') {
    // In-development feature gate: if the feature is off, non-admins can't enter.
    if (feature && !(settings?.accessControl?.__features__ || {})[feature]) {
      return <Navigate to="/" replace />;
    }
    let blocked = false;
    if (permission) {
      const allowed = settings?.accessControl?.[permission] || roles || ['ADMIN'];
      if (!allowed.includes(user.role)) blocked = true;
    } else if (anyPermission) {
      const inFloor = roles ? roles.includes(user.role) : false;
      const granted = anyPermission.some(p => {
        const a = settings?.accessControl?.[p];
        return Array.isArray(a) && a.includes(user.role);
      });
      if (!inFloor && !granted) blocked = true;
    } else if (roles && !roles.includes(user.role)) {
      blocked = true;
    }
    if (blocked) return <Navigate to="/" replace />;
  }
  return children;
}

function AppRoutes() {
  const { loading } = useAuth();
  if (loading) return <BrandedLoader />;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="expenses/new" element={<AddExpensePage />} />
        <Route path="expenses/:id/edit" element={<AddExpensePage />} />
        <Route path="approvals" element={<PrivateRoute permission="view_approvals" roles={['MANAGER','FINANCE','ADMIN']}><ApprovalsPage /></PrivateRoute>} />
        <Route path="reports" element={<PrivateRoute permission="view_reports" roles={['MANAGER','FINANCE','ADMIN']}><ReportsPage /></PrivateRoute>} />
        <Route path="payables" element={<PrivateRoute permission="manage_ap_ar" roles={['FINANCE','ADMIN']}><LedgerPage key="ledger-add" mode="add" /></PrivateRoute>} />
        <Route path="ap-ar" element={<PrivateRoute anyPermission={['manage_ap_ar','view_approvals']} roles={['MANAGER','FINANCE','ADMIN']}><LedgerPage key="ledger-manage" mode="manage" /></PrivateRoute>} />
        <Route path="transactions" element={<PrivateRoute roles={['FINANCE','ADMIN']}><TransactionsPage /></PrivateRoute>} />
        <Route path="analytics" element={<PrivateRoute permission="view_analytics" roles={['FINANCE','ADMIN']}><AnalyticsPage /></PrivateRoute>} />
        <Route path="users" element={<PrivateRoute permission="manage_users"><UsersPage /></PrivateRoute>} />
        <Route path="users/:id" element={<PrivateRoute permission="manage_users"><EmployeePage /></PrivateRoute>} />
        <Route path="settings" element={<PrivateRoute roles={['ADMIN','FINANCE']} anyPermission={['manage_settings','edit_categories','manage_expense_types','manage_password','manage_access_control','upload_branding','change_branding']}><SettingsPage /></PrivateRoute>} />
        <Route path="audit" element={<PrivateRoute permission="view_audit_log" roles={['ADMIN']}><AuditLogPage /></PrivateRoute>} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OrgProvider>
          <CurrencyProvider>
            <NotificationProvider>
              <AppRoutes />
              <Toaster />
            </NotificationProvider>
          </CurrencyProvider>
        </OrgProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
