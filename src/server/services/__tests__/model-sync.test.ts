import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db/schema.js';

let testDb: Database.Database;

vi.mock('../../db/connection.js', () => ({
  getDatabase: () => testDb,
}));

// Mock the adapter module so we control probeModels() per test
const mockProbe = vi.fn();
vi.mock('../cli-adapters.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getAdapter: (tool: string) => ({
      ...actual.getAdapter(tool),
      probeModels: () => mockProbe(tool),
    }),
  };
});

const queries = await import('../../db/queries.js');
const { syncModels, maybeTriggerSync, lookupRegistry } = await import('../model-sync.js');

describe('model-sync', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    initDatabase(testDb);
    mockProbe.mockReset();
  });

  afterEach(() => {
    testDb.close();
  });

  it('inserts probed models with source=probe and records version', async () => {
    mockProbe.mockResolvedValueOnce([
      { value: 'claude-new-1', label: 'claude-new-1' },
      { value: 'claude-new-2', label: 'claude-new-2' },
    ]);

    await syncModels('claude', '2.9.9');

    const models = queries.getModelsByTool('claude');
    const values = models.map((m) => m.model_value);
    expect(values).toContain('claude-new-1');
    expect(values).toContain('claude-new-2');
    const newOne = models.find((m) => m.model_value === 'claude-new-1')!;
    expect(newOne.source).toBe('probe');
    expect(newOne.deprecated).toBe(0);

    const version = queries.getCliVersion('claude');
    expect(version?.last_version).toBe('2.9.9');
  });

  it('falls back to registry when probe returns null', async () => {
    mockProbe.mockResolvedValueOnce(null);

    await syncModels('claude', '2.0.0');

    const models = queries.getModelsByTool('claude');
    // Registry contains claude-opus-4-7 — it should have been inserted with source=registry
    const opus = models.find((m) => m.model_value === 'claude-opus-4-7');
    expect(opus).toBeDefined();
    expect(opus!.source).toBe('registry');
  });

  it('marks seed-sourced models absent from discovery as deprecated', async () => {
    // Seed already includes claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5
    mockProbe.mockResolvedValueOnce([
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      // haiku + opus-4-6 deliberately omitted
    ]);

    await syncModels('claude', '2.9.9');

    const models = queries.getModelsByTool('claude');
    const haiku = models.find((m) => m.model_value === 'claude-haiku-4-5');
    const opus = models.find((m) => m.model_value === 'claude-opus-4-6');
    const sonnet = models.find((m) => m.model_value === 'claude-sonnet-4-6');
    expect(haiku?.deprecated).toBe(1);
    expect(opus?.deprecated).toBe(1);
    expect(sonnet?.deprecated).toBe(0);
  });

  it('does not deprecate user-added models on reconciliation', async () => {
    queries.addModel('claude', 'my-custom-model', 'My Custom Model');

    mockProbe.mockResolvedValueOnce([
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ]);

    await syncModels('claude', '2.9.9');

    const custom = queries.getModelsByTool('claude').find((m) => m.model_value === 'my-custom-model');
    expect(custom).toBeDefined();
    expect(custom!.source).toBe('user');
    expect(custom!.deprecated).toBe(0);
  });

  it('isModelSupported returns false for deprecated entries', async () => {
    mockProbe.mockResolvedValueOnce([
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ]);

    await syncModels('claude', '2.9.9');

    // haiku was seeded but not in this probe → deprecated
    expect(queries.isModelSupported('claude', 'claude-haiku-4-5')).toBe(false);
    expect(queries.isModelSupported('claude', 'claude-sonnet-4-6')).toBe(true);
  });

  it('maybeTriggerSync skips when version is unchanged', async () => {
    mockProbe.mockResolvedValue([
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ]);

    // First call sets the version
    await syncModels('claude', '2.9.9');
    mockProbe.mockClear();

    // Same version → should not invoke probe
    maybeTriggerSync('claude', '2.9.9');
    // Give microtasks a tick (maybeTriggerSync is fire-and-forget)
    await Promise.resolve();
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it('lookupRegistry returns claude models for any version via wildcard', () => {
    const models = lookupRegistry('claude', '999.0.0');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.value === 'claude-sonnet-4-6')).toBe(true);
  });

  it('records version on gemini even when probe fails (registry fallback)', async () => {
    mockProbe.mockResolvedValueOnce(null);
    await syncModels('gemini', '1.0.0');
    const version = queries.getCliVersion('gemini');
    expect(version?.last_version).toBe('1.0.0');
  });
});
