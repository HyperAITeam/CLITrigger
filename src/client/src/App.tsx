import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { useI18n } from './i18n';
import LoginPage from './components/LoginPage';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';

function App() {
  const { authenticated, loading, login, logout } = useAuth();
  const { connected, onEvent } = useWebSocket(authenticated);
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="min-h-screen bg-warm-100 flex items-center justify-center">
        <div className="text-warm-500 font-medium text-lg animate-fade-in">
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
      <div className="min-h-screen bg-warm-100 text-warm-800 font-sans">
        <Routes>
          <Route
            path="/"
            element={
              <ProjectList onEvent={onEvent} onLogout={logout} />
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProjectDetail onEvent={onEvent} connected={connected} />
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
