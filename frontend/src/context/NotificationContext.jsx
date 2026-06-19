import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

const NotificationContext = createContext({
  notifications:[], unreadCount:0,
  pendingCounts:{myPending:0,toApprove:0},
  load:()=>{}, markAllRead:()=>{},
});

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingCounts, setPendingCounts] = useState({ myPending:0, toApprove:0 });
  const { user } = useAuth();

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [notif, counts] = await Promise.all([
        api.get('/notifications'),
        api.get('/expenses/pending-count'),
      ]);
      setNotifications(notif?.notifications || []);
      setUnreadCount(notif?.unreadCount || 0);
      setPendingCounts(counts || { myPending:0, toApprove:0 });
    } catch(e) {}
  }, [user]);

  useEffect(() => {
    if (!user) { setNotifications([]); setUnreadCount(0); setPendingCounts({myPending:0,toApprove:0}); return; }
    load();
    const interval = setInterval(load, 15000); // poll every 15s
    return () => clearInterval(interval);
  }, [user, load]);

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setUnreadCount(0);
      setNotifications(n => n.map(x => ({...x, read:true})));
    } catch(e) {}
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, pendingCounts, load, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
