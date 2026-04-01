import { useState, useEffect, useCallback } from 'react';
import { loadModels, refreshModels, getToolConfig, type CliTool, type CliToolConfig } from '../cli-tools';

export function useModels() {
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    loadModels().then(() => setLoaded(true));
  }, []);

  const refresh = useCallback(() => {
    refreshModels().then(() => setTick((t) => t + 1));
  }, []);

  const getConfig = useCallback((tool: CliTool): CliToolConfig => {
    return getToolConfig(tool);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return { loaded, refresh, getToolConfig: getConfig };
}
