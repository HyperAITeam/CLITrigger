import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  upsertDiscoveredModel,
  markDeprecatedExcept,
  setCliVersion,
  getCliVersion,
} from '../db/queries.js';
import { getAdapter, type CliTool, type ProbedModel } from './cli-adapters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../data/cli-models-registry.json');

/**
 * Bumped whenever syncModels' merge strategy or registry format changes in a
 * way that requires re-running reconciliation on existing databases. Stored
 * as a prefix on cli_versions.last_version so a bump causes maybeTriggerSync
 * to treat the current record as stale and resync on the next version probe.
 */
const SYNC_ALGORITHM_VERSION = '2';

function encodeStoredVersion(version: string): string {
  return `${SYNC_ALGORITHM_VERSION}|${version}`;
}

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

/**
 * Merge registry and probe results. Registry is authoritative for labels
 * (pretty names like "Claude Opus 4.6"), and a probe-reported value that is
 * NOT in the registry is included as a bonus with source='probe'. This
 * matches the user preference of "CLI probing + bundled registry" where
 * the registry acts as a safety net against incomplete --help output.
 */
function mergeDiscovered(
  registryModels: ProbedModel[],
  probedModels: ProbedModel[] | null
): Array<ProbedModel & { source: 'registry' | 'probe' }> {
  const merged = new Map<string, ProbedModel & { source: 'registry' | 'probe' }>();
  for (const m of registryModels) {
    if (!m.value) continue;
    merged.set(m.value, { ...m, source: 'registry' });
  }
  if (probedModels) {
    for (const m of probedModels) {
      if (!m.value) continue;
      if (!merged.has(m.value)) {
        merged.set(m.value, { ...m, source: 'probe' });
      }
    }
  }
  return Array.from(merged.values());
}

/**
 * Discover the current model set for a CLI tool and reconcile the cli_models
 * table. Registry entries (matched against the reported CLI version) are the
 * baseline; probe results merely supplement it with anything new the CLI
 * reports that the registry hasn't learned about yet.
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

  const registryModels = lookupRegistry(tool, version);
  const discovered = mergeDiscovered(registryModels, probed);

  if (discovered.length === 0) {
    // Neither probe nor registry had anything usable; record version and bail.
    setCliVersion(tool, encodeStoredVersion(version), now);
    return;
  }

  for (const model of discovered) {
    upsertDiscoveredModel(tool, model.value, model.label, model.source, now);
  }
  markDeprecatedExcept(tool, discovered.map((m) => m.value));
  setCliVersion(tool, encodeStoredVersion(version), now);
}

/**
 * Wrapper used by cli-status.ts. Triggers a real sync only when the newly
 * detected version differs from the last recorded one OR when the sync
 * algorithm version has been bumped since the last reconciliation. Returns
 * a promise that callers may await to know sync is done (e.g. so that a
 * subsequent read of cli_models reflects the reconciliation). Swallows
 * errors internally — failures must never propagate to cli-status callers.
 */
export async function maybeTriggerSync(tool: CliTool, version: string | null): Promise<void> {
  if (!version) return;
  const last = getCliVersion(tool);
  if (last?.last_version === encodeStoredVersion(version)) return;
  try {
    await syncModels(tool, version);
  } catch (err) {
    console.warn(`[model-sync] syncModels(${tool}) failed:`, err);
  }
}
