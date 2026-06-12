// src/App.jsx
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { NotificationProvider } from './context/NotificationContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import ExpensesPage from './pages/ExpensesPage';
import AddExpensePage from './pages/AddExpensePage';
import ApprovalsPage from './pages/ApprovalsPage';
import ReportsPage from './pages/ReportsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import EmployeePage from './pages/EmployeePage';
import ProfilePage from './pages/ProfilePage';

function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-3"
          style={{ backgroundColor: 'var(--brand-color, #1D9E75)' }}>X</div>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-3"
          style={{ backgroundColor: 'var(--brand-color, #1D9E75)' }}>X</div>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="expenses/new" element={<AddExpensePage />} />
        <Route path="expenses/:id/edit" element={<AddExpensePage />} />
        <Route path="approvals" element={<PrivateRoute roles={['MANAGER','FINANCE','ADMIN']}><ApprovalsPage /></PrivateRoute>} />
        <Route path="reports" element={<PrivateRoute roles={['MANAGER','FINANCE','ADMIN']}><ReportsPage /></PrivateRoute>} />
        <Route path="analytics" element={<PrivateRoute roles={['MANAGER','FINANCE','ADMIN']}><AnalyticsPage /></PrivateRoute>} />
        <Route path="users" element={<PrivateRoute roles={['ADMIN','FINANCE','MANAGER']}><UsersPage /></PrivateRoute>} />
        <Route path="users/:id" element={<PrivateRoute roles={['ADMIN','FINANCE','MANAGER']}><EmployeePage /></PrivateRoute>} />
        <Route path="settings" element={<PrivateRoute roles={['ADMIN','FINANCE']}><SettingsPage /></PrivateRoute>} />
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
            </NotificationProvider>
          </CurrencyProvider>
        </OrgProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
