import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { Project, Todo, TaskLog } from './types';
import { mockProjects, mockTodos, mockLogs } from './mockData';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';

function App() {
  const [projects, setProjects] = useState<Project[]>(mockProjects);
  const [todos, setTodos] = useState<Todo[]>(mockTodos);
  const [logs] = useState<TaskLog[]>(mockLogs);

  const handleAddProject = (name: string, path: string) => {
    const newProject: Project = {
      id: `proj-${Date.now()}`,
      name,
      path,
      default_branch: 'main',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setProjects((prev) => [...prev, newProject]);
  };

  const handleAddTodo = (projectId: string, title: string, description: string) => {
    const projectTodos = todos.filter((t) => t.project_id === projectId);
    const newTodo: Todo = {
      id: `todo-${Date.now()}`,
      project_id: projectId,
      title,
      description,
      status: 'pending',
      priority: projectTodos.length + 1,
      branch_name: null,
      worktree_path: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setTodos((prev) => [...prev, newTodo]);
  };

  const handleStartTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: 'running' as const, updated_at: new Date().toISOString() } : t
      )
    );
  };

  const handleStopTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: 'stopped' as const, updated_at: new Date().toISOString() } : t
      )
    );
  };

  const handleDeleteTodo = (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const handleEditTodo = (id: string, title: string, description: string) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, title, description, updated_at: new Date().toISOString() } : t
      )
    );
  };

  const handleStartAll = (projectId: string) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.project_id === projectId &&
        (t.status === 'pending' || t.status === 'failed' || t.status === 'stopped')
          ? { ...t, status: 'running' as const, updated_at: new Date().toISOString() }
          : t
      )
    );
  };

  const handleStopAll = (projectId: string) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.project_id === projectId && t.status === 'running'
          ? { ...t, status: 'stopped' as const, updated_at: new Date().toISOString() }
          : t
      )
    );
  };

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <Routes>
          <Route
            path="/"
            element={
              <ProjectList
                projects={projects}
                todos={todos}
                onAddProject={handleAddProject}
              />
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProjectDetail
                projects={projects}
                todos={todos}
                logs={logs}
                onAddTodo={handleAddTodo}
                onStartTodo={handleStartTodo}
                onStopTodo={handleStopTodo}
                onDeleteTodo={handleDeleteTodo}
                onEditTodo={handleEditTodo}
                onStartAll={handleStartAll}
                onStopAll={handleStopAll}
              />
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
