import { get, post, del } from './client';

export interface ModelOption {
  value: string;
  label: string;
  id: string;
  isDefault: boolean;
  deprecated?: boolean;
}

export type ModelMap = Record<string, ModelOption[]>;

export function getModels(): Promise<ModelMap> {
  return get('/api/models');
}

export function addModel(cliTool: string, modelValue: string, modelLabel: string): Promise<ModelOption> {
  return post('/api/models', { cliTool, modelValue, modelLabel });
}

export function removeModel(id: string): Promise<void> {
  return del(`/api/models/${id}`);
}
