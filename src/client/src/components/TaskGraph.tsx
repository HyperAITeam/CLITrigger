import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  MarkerType,
  BackgroundVariant,
} from '@xyflow/react';
import { LayoutGrid, Plus } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import type { Todo, TaskLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import TaskNodeComponent, { type TaskNodeData } from './TaskNode';
import TaskNodeDetail from './TaskNodeDetail';
import TodoForm from './TodoForm';
import type { PendingImage } from './TodoForm';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';

const nodeTypes: NodeTypes = {
  taskNode: TaskNodeComponent,
};

const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;

function getLayoutedElements(todos: Todo[]): { nodePositions: Map<string, { x: number; y: number }> } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100 });

  for (const todo of todos) {
    g.setNode(todo.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const todo of todos) {
    if (todo.depends_on) {
      g.setEdge(todo.depends_on, todo.id);
    }
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const todo of todos) {
    const node = g.node(todo.id);
    if (node) {
      positions.set(todo.id, { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 });
    }
  }
  return { nodePositions: positions };
}

function wouldCreateCycle(todos: Todo[], sourceId: string, targetId: string): boolean {
  let current: string | null = targetId;
  const visited = new Set<string>();
  while (current) {
    if (current === sourceId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const todo = todos.find(t => t.id === current);
    current = todo?.depends_on ?? null;
  }
  return false;
}

const edgeStatusColor: Record<string, string> = {
  running: '#2196F3',
  completed: '#4CAF50',
  failed: '#E53935',
  stopped: '#FF9800',
  merged: '#9C27B0',
  pending: '#B8A88A',
};

interface TaskGraphProps {
  todos: Todo[];
  projectCliTool?: string;
  projectCliModel?: string;
  onAddTodo: (title: string, description: string, cliTool?: string, cliModel?: string, images?: PendingImage[], dependsOn?: string, maxTurns?: number) => Promise<void>;
  onStartTodo: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onStopTodo: (id: string) => Promise<void>;
  onDeleteTodo: (id: string) => Promise<void>;
  onEditTodo: (id: string, title: string, description: string, cliTool?: string, cliModel?: string, dependsOn?: string, maxTurns?: number) => Promise<void>;
  onMergeTodo: (id: string) => Promise<void>;
  onCleanupTodo: (id: string) => Promise<void>;
  onRetryTodo: (id: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onContinueTodo?: (id: string, prompt: string, mode?: 'headless' | 'interactive' | 'verbose') => Promise<void>;
  onFixTodo?: (todo: Todo, errorLogs: TaskLog[]) => Promise<void>;
  onUpdateDependency?: (todoId: string, dependsOnId: string | null) => Promise<void>;
  onUpdatePosition?: (todoId: string, x: number, y: number) => Promise<void>;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  onSendInput: (todoId: string, input: string) => void;
  interactiveTodos: Set<string>;
  debugLogging?: boolean;
  showTokenUsage?: boolean;
}

export default function TaskGraph({
  todos,
  projectCliTool,
  projectCliModel,
  onAddTodo,
  onStartTodo,
  onStopTodo,
  onDeleteTodo,
  onEditTodo,
  onMergeTodo,
  onCleanupTodo,
  onRetryTodo,
  onContinueTodo,
  onFixTodo,
  onUpdateDependency,
  onUpdatePosition,
  onEvent,
  onSendInput,
  interactiveTodos,
  debugLogging,
  showTokenUsage,
}: TaskGraphProps) {
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { t } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const handleSelectNode = useCallback((todoId: string) => {
    setSelectedTodoId(prev => prev === todoId ? null : todoId);
  }, []);

  // Build nodes and edges from todos
  const { initialNodes, initialEdges } = useMemo(() => {
    const needsLayout = todos.some(t => t.position_x == null || t.position_y == null);
    const layoutPositions = needsLayout ? getLayoutedElements(todos).nodePositions : null;

    const nodes: Node[] = todos.map(todo => ({
      id: todo.id,
      type: 'taskNode',
      position: {
        x: todo.position_x ?? layoutPositions?.get(todo.id)?.x ?? 0,
        y: todo.position_y ?? layoutPositions?.get(todo.id)?.y ?? 0,
      },
      data: {
        todo,
        allTodos: todos,
        selected: todo.id === selectedTodoId,
        onStart: onStartTodo,
        onStop: onStopTodo,
        onDelete: onDeleteTodo,
        onMerge: onMergeTodo,
        onCleanup: onCleanupTodo,
        onRetry: onRetryTodo,
        onFix: onFixTodo,
        onSelect: handleSelectNode,
      } satisfies TaskNodeData,
    }));

    const edges: Edge[] = todos
      .filter(t => t.depends_on)
      .map(todo => {
        const sourceStatus = todos.find(t => t.id === todo.depends_on)?.status ?? 'pending';
        return {
          id: `e-${todo.depends_on}-${todo.id}`,
          source: todo.depends_on!,
          target: todo.id,
          type: 'smoothstep',
          animated: sourceStatus === 'running',
          style: { stroke: edgeStatusColor[sourceStatus] ?? '#B8A88A', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeStatusColor[sourceStatus] ?? '#B8A88A' },
        };
      });

    return { initialNodes: nodes, initialEdges: edges };
  }, [todos, selectedTodoId, onStartTodo, onStopTodo, onDeleteTodo, onMergeTodo, onCleanupTodo, onRetryTodo, onFixTodo, handleSelectNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when todos change (status updates, new tasks, etc.)
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || !onUpdateDependency) return;
    // source (output) -> target (input): target depends_on source
    if (wouldCreateCycle(todos, connection.source, connection.target)) return;
    onUpdateDependency(connection.target, connection.source);
  }, [todos, onUpdateDependency]);

  const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    if (!onUpdateDependency) return;
    for (const edge of deletedEdges) {
      onUpdateDependency(edge.target, null);
    }
  }, [onUpdateDependency]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    if (onUpdatePosition) {
      onUpdatePosition(node.id, node.position.x, node.position.y);
    }
  }, [onUpdatePosition]);

  // Reconnect: drag edge endpoint to another node or drop on empty space to remove
  const edgeReconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    edgeReconnectSuccessful.current = true;
    if (!onUpdateDependency || !newConnection.source || !newConnection.target) return;
    // Remove old dependency
    onUpdateDependency(oldEdge.target, null);
    // Set new dependency (if not a cycle)
    if (!wouldCreateCycle(todos, newConnection.source, newConnection.target)) {
      onUpdateDependency(newConnection.target, newConnection.source);
    }
  }, [todos, onUpdateDependency]);

  const onReconnectEnd = useCallback((_event: MouseEvent | TouchEvent, edge: Edge) => {
    if (!edgeReconnectSuccessful.current && onUpdateDependency) {
      // Dropped on empty space → remove dependency
      onUpdateDependency(edge.target, null);
    }
    edgeReconnectSuccessful.current = true;
  }, [onUpdateDependency]);

  const handleAutoLayout = useCallback(() => {
    const { nodePositions } = getLayoutedElements(todos);
    setNodes(nds =>
      nds.map(n => {
        const pos = nodePositions.get(n.id);
        return pos ? { ...n, position: pos } : n;
      })
    );
    // Persist positions
    if (onUpdatePosition) {
      for (const [id, pos] of nodePositions) {
        onUpdatePosition(id, pos.x, pos.y);
      }
    }
  }, [todos, setNodes, onUpdatePosition]);

  const selectedTodo = selectedTodoId ? todos.find(t => t.id === selectedTodoId) : null;

  return (
    <div className="flex gap-0 h-[600px]">
      {/* Graph canvas */}
      <div className={`flex-1 rounded-xl border border-warm-200 overflow-hidden bg-warm-50 ${selectedTodo ? '' : ''}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onReconnectStart={onReconnectStart}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          deleteKeyCode="Delete"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={isDark ? '#4A4A60' : '#D4B896'} style={{ opacity: 0.3 }} />
          <Controls
            showInteractive={false}
            className="!bg-theme-card !border-warm-200 !shadow-soft !rounded-lg"
          />
          <MiniMap
            nodeColor={(n) => {
              const nd = n.data as unknown as TaskNodeData;
              const status = nd?.todo?.status ?? 'pending';
              return edgeStatusColor[status] ?? '#B8A88A';
            }}
            maskColor={isDark ? 'rgba(23, 23, 31, 0.7)' : 'rgba(245, 241, 235, 0.7)'}
            className="!bg-theme-card !border-warm-200 !shadow-soft !rounded-lg"
          />
        </ReactFlow>

        {/* Toolbar overlay */}
        <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
          <button
            onClick={handleAutoLayout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-theme-card border border-warm-200 rounded-lg shadow-soft hover:bg-warm-50 text-warm-600 transition-colors"
            title={t('graph.autoLayout')}
          >
            <LayoutGrid size={14} />
            {t('graph.autoLayout')}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary text-xs py-1.5"
          >
            <Plus size={14} />
            {t('todos.add')}
          </button>
        </div>
      </div>

      {/* Detail panel */}
      {selectedTodo && (
        <TaskNodeDetail
          todo={selectedTodo}
          allTodos={todos}
          onClose={() => setSelectedTodoId(null)}
          onEdit={onEditTodo}
          onStart={onStartTodo}
          onStop={onStopTodo}
          onMerge={onMergeTodo}
          onCleanup={onCleanupTodo}
          onRetry={onRetryTodo}
          onContinue={onContinueTodo}
          onFix={onFixTodo}
          onEvent={onEvent}
          isInteractive={interactiveTodos.has(selectedTodo.id)}
          onSendInput={onSendInput}
          debugLogging={debugLogging}
          showTokenUsage={showTokenUsage}
        />
      )}

      {/* Floating form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <TodoForm
              projectCliTool={projectCliTool}
              projectCliModel={projectCliModel}
              availableTodos={todos}
              onSave={async (title, description, cliTool, cliModel, images, dependsOn, maxTurns) => {
                await onAddTodo(title, description, cliTool, cliModel, images, dependsOn, maxTurns);
                setShowForm(false);
              }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
