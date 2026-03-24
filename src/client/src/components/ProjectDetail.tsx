import { useParams, Link } from 'react-router-dom';
import type { Project, Todo, TaskLog } from '../types';
import ProjectHeader from './ProjectHeader';
import TodoList from './TodoList';
import ProgressBar from './ProgressBar';

interface ProjectDetailProps {
  projects: Project[];
  todos: Todo[];
  logs: TaskLog[];
  onAddTodo: (projectId: string, title: string, description: string) => void;
  onStartTodo: (id: string) => void;
  onStopTodo: (id: string) => void;
  onDeleteTodo: (id: string) => void;
  onEditTodo: (id: string, title: string, description: string) => void;
  onStartAll: (projectId: string) => void;
  onStopAll: (projectId: string) => void;
}

export default function ProjectDetail({
  projects,
  todos,
  logs,
  onAddTodo,
  onStartTodo,
  onStopTodo,
  onDeleteTodo,
  onEditTodo,
  onStartAll,
  onStopAll,
}: ProjectDetailProps) {
  const { id } = useParams<{ id: string }>();
  const project = projects.find((p) => p.id === id);

  if (!project) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-12 text-center">
          <p className="text-gray-400 text-lg">Project not found.</p>
          <Link
            to="/"
            className="mt-4 inline-block text-blue-400 hover:text-blue-300 transition-colors"
          >
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const projectTodos = todos.filter((t) => t.project_id === project.id);
  const projectLogs = logs.filter((l) =>
    projectTodos.some((t) => t.id === l.todo_id)
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to projects
      </Link>

      <ProjectHeader
        project={project}
        todos={projectTodos}
        onStartAll={() => onStartAll(project.id)}
        onStopAll={() => onStopAll(project.id)}
      />

      <ProgressBar todos={projectTodos} />

      <TodoList
        todos={projectTodos}
        logs={projectLogs}
        onAddTodo={(title, description) => onAddTodo(project.id, title, description)}
        onStartTodo={onStartTodo}
        onStopTodo={onStopTodo}
        onDeleteTodo={onDeleteTodo}
        onEditTodo={onEditTodo}
      />
    </div>
  );
}
