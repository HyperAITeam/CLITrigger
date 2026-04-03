import type { ComponentType } from 'react';
import type { Project } from '../types';

export interface PluginPanelProps {
  project: Project;
  onImportAsTask: (title: string, description: string) => void;
}

export interface PluginSettingsProps {
  project: Project;
  config: Record<string, any>;
  onConfigChange: (updates: Record<string, any>) => void;
}

export interface ClientPluginManifest {
  id: string;
  displayName: string;
  displayNameKo: string;
  PanelComponent?: ComponentType<PluginPanelProps>;
  SettingsComponent: ComponentType<PluginSettingsProps>;
  hasTab: boolean;
  isEnabled: (project: Project) => boolean;
  translations: {
    en: Record<string, string>;
    ko: Record<string, string>;
  };
}
