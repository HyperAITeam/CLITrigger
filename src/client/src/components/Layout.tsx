import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import ParticleBackground from './ParticleBackground';
import type { WsEvent } from '../hooks/useWebSocket';
import { Menu } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  onLogout: () => void;
  authRequired: boolean;
  connected: boolean;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

export default function Layout({ children, onLogout, authRequired, connected, onEvent }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Sidebar - desktop: always visible, mobile: overlay */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-60 flex-shrink-0
          transform transition-transform duration-200 ease-in-out
          md:translate-x-0 md:static md:z-auto
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <Sidebar
          onLogout={onLogout}
          authRequired={authRequired}
          connected={connected}
          onEvent={onEvent}
          onClose={() => setSidebarOpen(false)}
        />
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center px-4 py-3 border-b glass z-20" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-theme-hover transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <Menu size={20} />
          </button>
          <span className="ml-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>CLITrigger</span>
        </div>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto relative">
          <ParticleBackground />
          <div className="relative" style={{ zIndex: 1 }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
