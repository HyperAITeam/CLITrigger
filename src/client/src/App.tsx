import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import LoginPage from './components/LoginPage';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';

function App() {
  const { authenticated, loading, login, logout } = useAuth();
  const { connected, onEvent, sendMessage } = useWebSocket(authenticated);

  if (loading) {
    return (
      <div className="min-h-screen bg-street-900 flex items-center justify-center">
        <div className="text-neon-green font-mono text-lg animate-flicker">
          LOADING<span className="animate-pulse">_</span>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-street-900 text-white font-display relative scanline">
        <div className="noise-overlay" />
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
              <ProjectDetail onEvent={onEvent} connected={connected} sendMessage={sendMessage} />
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
