import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { useI18n } from './i18n';
import { Skeleton } from './components/Skeleton';
import LoginPage from './components/LoginPage';
import Layout from './components/Layout';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';
import DiscussionDetail from './components/DiscussionDetail';

function App() {
  const { authenticated, authRequired, loading, login, logout } = useAuth();
  const { connected, onEvent, sendMessage } = useWebSocket(authenticated);
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        {/* Sidebar Skeleton */}
        <div className="hidden md:flex flex-col w-64 border-r border-theme-border p-4 space-y-6">
          <Skeleton className="h-8 w-32 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
          <div className="mt-auto space-y-3 pt-4 border-t border-theme-border">
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
            </div>
          </div>
        </div>
        
        {/* Main Content Skeleton */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="md:hidden h-14 border-b border-theme-border flex items-center px-4">
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <div className="flex justify-between items-center">
              <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-10 w-24 rounded-xl" />
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card p-5 space-y-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-16" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <BrowserRouter>
      <Layout
        onLogout={logout}
        authRequired={authRequired}
        connected={connected}
        onEvent={onEvent}
      >
        <Routes>
          <Route
            path="/"
            element={
              <ProjectList onEvent={onEvent} />
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProjectDetail onEvent={onEvent} connected={connected} sendMessage={sendMessage} />
            }
          />
          <Route
            path="/projects/:id/discussions/:discussionId"
            element={
              <DiscussionDetail onEvent={onEvent} connected={connected} />
            }
          />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
