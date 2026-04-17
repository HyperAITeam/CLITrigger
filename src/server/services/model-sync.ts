import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  upsertDiscoveredModel,
  markDeprecatedExcept,
  setCliVersion,
  getCliVersion,
  type ModelSource,
} from '../db/queries.js';
import { getAdapter, type CliTool, type ProbedModel } from './cli-adapters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../data/cli-models-registry.json');

interface RegistryEntry {
  versionPrefix: string;
  models: Array<{ value: string; label: string }>;
}

type RegistryFile = Record<string, RegistryEntry[]>;

let cachedRegistry: RegistryFile | null = null;

function loadRegistry(): RegistryFile {
  if (cachedRegistry) return cachedRegistry;
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // Strip any "$comment" keys from the top-level for cleanliness
    delete parsed.$comment;
    cachedRegistry = parsed as RegistryFile;
    return cachedRegistry;
  } catch (err) {
    console.warn('[model-sync] Could not load registry:', err);
    cachedRegistry = {};
    return cachedRegistry;
  }
}

export function lookupRegistry(tool: CliTool, version: string): ProbedModel[] {
  const registry = loadRegistry();
  const entries = registry[tool];
  if (!entries || entries.length === 0) return [];

  // Prefer the longest matching versionPrefix; '*' is the wildcard fallback.
  let bestMatch: RegistryEntry | null = null;
  let bestPrefixLength = -1;
  for (const entry of entries) {
    if (entry.versionPrefix === '*') {
      if (!bestMatch) bestMatch = entry;
      continue;
    }
    if (version.startsWith(entry.versionPrefix) && entry.versionPrefix.length > bestPrefixLength) {
      bestMatch = entry;
      bestPrefixLength = entry.versionPrefix.length;
    }
  }
  return bestMatch ? bestMatch.models.map((m) => ({ ...m })) : [];
}

function dedupByValue(list: ProbedModel[]): ProbedModel[] {
  const seen = new Map<string, ProbedModel>();
  for (const m of list) {
    if (!m.value) continue;
    if (!seen.has(m.value)) seen.set(m.value, m);
  }
  return Array.from(seen.values());
}

/**
 * Discover the current model set for a CLI tool and reconcile the cli_models
 * table. Probe is tried first; if it returns null/empty, the bundled registry
 * (matched against the reported CLI version) is used. If neither yields any
 * models, the existing seed data is left alone.
 *
 * Records the synced version in cli_versions regardless, so that repeated
 * --version polls do not retrigger sync on every request.
 */
export async function syncModels(tool: CliTool, version: string): Promise<void> {
  const now = new Date().toISOString();
  const adapter = getAdapter(tool);

  let probed: ProbedModel[] | null = null;
  if (adapter.probeModels) {
    try {
      probed = await adapter.probeModels();
    } catch (err) {
      console.warn(`[model-sync] probeModels(${tool}) threw:`, err);
      probed = null;
    }
  }

  let source: ModelSource;
  let discovered: ProbedModel[];
  if (probed && probed.length > 0) {
    discovered = dedupByValue(probed);
    source = 'probe';
  } else {
    discovered = dedupByValue(lookupRegistry(tool, version));
    source = 'registry';
  }

  if (discovered.length === 0) {
    // Neither probe nor registry had anything usable; record version and bail.
    setCliVersion(tool, version, now);
    return;
  }

  for (const model of discovered) {
    upsertDiscoveredModel(tool, model.value, model.label, source, now);
  }
  markDeprecatedExcept(tool, discovered.map((m) => m.value));
  setCliVersion(tool, version, now);
}

/**
 * Fire-and-forget wrapper used by cli-status.ts. Only triggers a real sync
 * when the newly detected version differs from the last recorded one.
 */
export function maybeTriggerSync(tool: CliTool, version: string | null): void {
  if (!version) return;
  const last = getCliVersion(tool);
  if (last?.last_version === version) return;
  syncModels(tool, version).catch((err) => {
    console.warn(`[model-sync] syncModels(${tool}) failed:`, err);
  });
}
