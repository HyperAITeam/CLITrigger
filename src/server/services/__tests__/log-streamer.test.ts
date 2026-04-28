import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { LogStreamer } from '../log-streamer.js';

// Mock dependencies
vi.mock('../../db/queries.js', () => ({
  createTaskLog: vi.fn(),
}));

vi.mock('../../websocket/broadcaster.js', () => ({
  broadcaster: {
    broadcast: vi.fn(),
  },
}));

const queries = await import('../../db/queries.js');
const { broadcaster } = await import('../../websocket/broadcaster.js');

describe('LogStreamer', () => {
  let streamer: LogStreamer;
  let mockStdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  let mockStderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    streamer = new LogStreamer();

    mockStdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    mockStderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  });

  it('should set encoding to utf8 on streams', () => {
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    expect(mockStdout.setEncoding).toHaveBeenCalledWith('utf8');
    expect(mockStderr.setEncoding).toHaveBeenCalledWith('utf8');
  });

  it('should log stdout lines as output', () => {
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    mockStdout.emit('data', 'Hello world\n');

    expect(queries.createTaskLog).toHaveBeenCalledWith('todo-1', 'output', 'Hello world', 1);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'todo:log', todoId: 'todo-1', logType: 'output' })
    );
  });

  it('should detect git commit messages in stdout', () => {
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    mockStdout.emit('data', 'commit abc1234567 fix: something\n');

    expect(queries.createTaskLog).toHaveBeenCalledWith(
      'todo-1', 'commit', 'commit abc1234567 fix: something', 1
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'todo:commit', todoId: 'todo-1' })
    );
  });

  it('should log stderr lines as error', () => {
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    mockStderr.emit('data', 'Error occurred\n');

    expect(queries.createTaskLog).toHaveBeenCalledWith('todo-1', 'error', 'Error occurred', 1);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'todo:log', logType: 'error' })
    );
  });

  it('should buffer incomplete lines', () => {
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    mockStdout.emit('data', 'partial');

    // Should not have logged yet (no newline)
    expect(queries.createTaskLog).not.toHaveBeenCalled();

    mockStdout.emit('data', ' line\n');
    expect(queries.createTaskLog).toHaveBeenCalledWith('todo-1', 'output', 'partial line', 1);
  });

  it('should flush buffer on stream end', () => {
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    mockStdout.emit('data', 'final output');
    mockStdout.emit('end');

    expect(queries.createTaskLog).toHaveBeenCalledWith('todo-1', 'output', 'final output', 1);
  });

  it('should skip empty lines', () => {
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    mockStdout.emit('data', '\n\n\n');

    expect(queries.createTaskLog).not.toHaveBeenCalled();
  });

  it('should trigger quota kill callback after 3 quota hits within window', () => {
    const killCb = vi.fn();
    streamer.setQuotaKillCallback(killCb);
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);

    const quotaLine = 'Attempt 1 failed: You have exhausted your capacity on this model. Your quota will reset after 1s..\n';
    mockStderr.emit('data', quotaLine);
    mockStderr.emit('data', quotaLine);
    expect(killCb).not.toHaveBeenCalled();
    expect(streamer.isContextExhausted('todo-1')).toBe(false);

    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);
    mockStderr.emit('data', quotaLine);
    expect(killCb).toHaveBeenCalledTimes(1);
    expect(killCb).toHaveBeenCalledWith('todo-1');
    expect(streamer.isContextExhausted('todo-1')).toBe(true);
  });

  it('should detect quota errors on stdout as well as stderr', () => {
    const killCb = vi.fn();
    streamer.setQuotaKillCallback(killCb);
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);

    const quotaLine = 'You have exhausted your capacity on this model.\n';
    mockStdout.emit('data', quotaLine);
    mockStdout.emit('data', quotaLine);
    mockStdout.emit('data', quotaLine);

    expect(killCb).toHaveBeenCalledWith('todo-1');
  });

  it('should not trigger fallback on a single transient quota hit', () => {
    const killCb = vi.fn();
    streamer.setQuotaKillCallback(killCb);
    streamer.streamToDb('todo-1', mockStdout as any, mockStderr as any);

    mockStderr.emit('data', 'You have exhausted your capacity on this model.\n');

    expect(killCb).not.toHaveBeenCalled();
    expect(streamer.isContextExhausted('todo-1')).toBe(false);
  });
});
