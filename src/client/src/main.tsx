import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import { NotificationContext, useNotificationProvider } from './hooks/useNotification';
import { initPlugins } from './plugins/init';
import './index.css';

initPlugins();

function Root() {
  const themeValue = useThemeProvider();
  const notificationValue = useNotificationProvider();

  return (
    <ThemeContext.Provider value={themeValue}>
      <NotificationContext.Provider value={notificationValue}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </NotificationContext.Provider>
    </ThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
