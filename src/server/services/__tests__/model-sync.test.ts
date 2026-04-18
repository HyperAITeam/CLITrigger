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

  it('inserts probe-only models with source=probe and records version', async () => {
    // claude-brand-new is not in registry → must come from probe with source=probe
    mockProbe.mockResolvedValueOnce([
      { value: 'claude-brand-new', label: 'claude-brand-new' },
    ]);

    await syncModels('claude', '2.9.9');

    const models = queries.getModelsByTool('claude');
    const newOne = models.find((m) => m.model_value === 'claude-brand-new')!;
    expect(newOne).toBeDefined();
    expect(newOne.source).toBe('probe');
    expect(newOne.deprecated).toBe(0);

    const version = queries.getCliVersion('claude');
    expect(version?.last_version).toBe('3|2.9.9');
  });

  it('uses registry even when probe succeeds (union strategy)', async () => {
    // Probe reports only sonnet, but registry also has opus-4-7, opus-4-6, haiku
    mockProbe.mockResolvedValueOnce([
      { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    ]);

    await syncModels('claude', '2.0.0');

    const models = queries.getModelsByTool('claude');
    const opus47 = models.find((m) => m.model_value === 'claude-opus-4-7');
    const opus46 = models.find((m) => m.model_value === 'claude-opus-4-6');
    const haiku = models.find((m) => m.model_value === 'claude-haiku-4-5');
    expect(opus47).toBeDefined();
    expect(opus47!.source).toBe('registry');
    expect(opus46?.deprecated).toBe(0);
    expect(haiku?.deprecated).toBe(0);
  });

  it('uses registry label over raw probe value', async () => {
    // Probe returns ugly label (equal to value); registry has pretty label
    mockProbe.mockResolvedValueOnce([
      { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    ]);

    await syncModels('claude', '2.0.0');

    const sonnet = queries.getModelsByTool('claude').find((m) => m.model_value === 'claude-sonnet-4-6');
    expect(sonnet?.model_label).toBe('Claude Sonnet 4.6');
  });

  it('deprecates seeded models that are absent from both registry and probe', async () => {
    // Add a fake seed-sourced entry that's in neither registry nor probe
    const db = testDb;
    db.prepare(
      `INSERT INTO cli_models (id, cli_tool, model_value, model_label, sort_order, is_default, source)
       VALUES ('fake-1', 'claude', 'claude-ancient-3-0', 'Claude Ancient 3.0', 99, 0, 'seed')`
    ).run();
    mockProbe.mockResolvedValueOnce(null);

    await syncModels('claude', '2.0.0');

    const ancient = queries.getModelsByTool('claude').find((m) => m.model_value === 'claude-ancient-3-0');
    expect(ancient?.deprecated).toBe(1);
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
    // Seed a stale model that is NOT in registry or probe so it will be deprecated
    testDb.prepare(
      `INSERT INTO cli_models (id, cli_tool, model_value, model_label, sort_order, is_default, source)
       VALUES ('stale-1', 'claude', 'claude-stale-2-0', 'Claude Stale 2.0', 99, 0, 'seed')`
    ).run();
    mockProbe.mockResolvedValueOnce([
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ]);

    await syncModels('claude', '2.9.9');

    expect(queries.isModelSupported('claude', 'claude-stale-2-0')).toBe(false);
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
    expect(version?.last_version).toBe('3|1.0.0');
  });
});
