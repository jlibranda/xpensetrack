// src/context/NotificationContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingCounts, setPendingCounts] = useState({ myPending: 0, toApprove: 0 });
  const { user } = useAuth();

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [notif, counts] = await Promise.all([
        api.get('/notifications'),
        api.get('/expenses/pending-count'),
      ]);
      setNotifications(notif.notifications || []);
      setUnreadCount(notif.unreadCount || 0);
      setPendingCounts(counts);
    } catch(e) {}
  }, [user]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // poll every 30s
    return () => clearInterval(interval);
  }, [load]);

  const markAllRead = async () => {
    await api.patch('/notifications/read-all');
    setUnreadCount(0);
    setNotifications(n => n.map(x => ({ ...x, read: true })));
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, pendingCounts, load, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
