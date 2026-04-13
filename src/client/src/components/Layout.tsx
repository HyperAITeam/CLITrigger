import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import type { WsEvent } from '../hooks/useWebSocket';

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
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
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
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <span className="ml-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>CLITrigger</span>
        </div>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
