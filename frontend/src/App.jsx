// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CurrencyProvider } from './context/CurrencyContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ExpensesPage from './pages/ExpensesPage';
import AddExpensePage from './pages/AddExpensePage';
import ApprovalsPage from './pages/ApprovalsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';

function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="expenses" element={<ExpensesPage />} />
              <Route path="expenses/new" element={<AddExpensePage />} />
              <Route path="expenses/:id/edit" element={<AddExpensePage />} />
              <Route path="approvals" element={
                <PrivateRoute roles={['MANAGER','FINANCE','ADMIN']}><ApprovalsPage /></PrivateRoute>
              } />
              <Route path="reports" element={
                <PrivateRoute roles={['MANAGER','FINANCE','ADMIN']}><ReportsPage /></PrivateRoute>
              } />
              <Route path="users" element={
                <PrivateRoute roles={['ADMIN','FINANCE']}><UsersPage /></PrivateRoute>
              } />
              <Route path="settings" element={
                <PrivateRoute roles={['ADMIN','FINANCE']}><SettingsPage /></PrivateRoute>
              } />
            </Route>
          </Routes>
        </BrowserRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}
