import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

interface NotificationContextValue {
  enabled: boolean;
  supported: boolean;
  toggleNotification: () => void;
  sendNotification: (title: string, body: string) => void;
}

export const NotificationContext = createContext<NotificationContextValue>({
  enabled: false,
  supported: false,
  toggleNotification: () => {},
  sendNotification: () => {},
});

export function useNotificationProvider(): NotificationContextValue {
  const supported = 'Notification' in window;

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (!supported) return false;
    return localStorage.getItem('clitrigger-notifications') === 'on' && Notification.permission === 'granted';
  });

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const toggleNotification = useCallback(async () => {
    if (!supported) return;

    if (enabledRef.current) {
      localStorage.setItem('clitrigger-notifications', 'off');
      setEnabled(false);
    } else {
      if (Notification.permission === 'denied') return;

      if (Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result !== 'granted') return;
      }

      localStorage.setItem('clitrigger-notifications', 'on');
      setEnabled(true);
    }
  }, [supported]);

  const sendNotification = useCallback((title: string, body: string) => {
    if (!enabledRef.current) return;
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }, []);

  return { enabled, supported, toggleNotification, sendNotification };
}

export function useNotification(): NotificationContextValue {
  return useContext(NotificationContext);
}
