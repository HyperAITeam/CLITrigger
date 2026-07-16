import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import ParticleBackground from './ParticleBackground';
import type { WsEvent } from '../hooks/useWebSocket';
import { Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import IconButton from './IconButton';
import { useI18n } from '../i18n';

interface LayoutProps {
  children: ReactNode;
  onLogout: () => void;
  authRequired: boolean;
  connected: boolean;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

export default function Layout({ children, onLogout, authRequired, connected, onEvent }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { t } = useI18n();
  // Desktop-only collapse to a 56px icon rail. Hydrated synchronously so the
  // first paint matches the persisted width (no expand→collapse flash).
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1');

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', next ? '1' : '0');
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-theme-bg">
      {/* Sidebar - desktop: always visible, mobile: overlay */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex-shrink-0
          transition-[transform,width] duration-200 ease-in-out
          md:translate-x-0 md:static md:z-auto
          ${collapsed ? 'w-60 md:w-14' : 'w-60'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <Sidebar
          onLogout={onLogout}
          authRequired={authRequired}
          connected={connected}
          onEvent={onEvent}
          onClose={() => setSidebarOpen(false)}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-overlay bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center px-4 py-3 border-b border-theme-border glass z-20">
          <IconButton
            onClick={() => setSidebarOpen(true)}
            label={t('sidebar.expand')}
            size="md"
          >
            <Menu size={20} />
          </IconButton>
          <span className="ml-3 text-sm font-semibold text-theme-text">CLITrigger</span>
        </div>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto relative">
          {location.pathname === '/' && <ParticleBackground />}
          <div className="relative" style={{ zIndex: 1 }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
