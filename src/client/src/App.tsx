import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import LoginPage from './components/LoginPage';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';

function App() {
  const { authenticated, loading, login, logout } = useAuth();
  const { connected, onEvent } = useWebSocket(authenticated);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-900 text-gray-100">
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
