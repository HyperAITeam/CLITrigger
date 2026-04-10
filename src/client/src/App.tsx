import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { useI18n } from './i18n';
import LoginPage from './components/LoginPage';
import Layout from './components/Layout';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';
import PipelineDetail from './components/PipelineDetail';
import DiscussionDetail from './components/DiscussionDetail';

function App() {
  const { authenticated, authRequired, loading, login, logout } = useAuth();
  const { connected, onEvent, sendMessage } = useWebSocket(authenticated);
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="font-medium text-lg animate-fade-in" style={{ color: 'var(--color-text-muted)' }}>
          {t('detail.loading')}
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
            path="/projects/:id/pipelines/:pipelineId"
            element={
              <PipelineDetail onEvent={onEvent} connected={connected} />
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
