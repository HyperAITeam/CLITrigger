import { get, post } from './client';

export interface McpCommand {
  id: string;
  label: string;
  command: string;
}

export interface McpConnection {
  url: string;
  token: string;
  config: unknown;
  commands: McpCommand[];
  preferredPort: number | null;
}

export interface McpClientStatus {
  id: string;
  label: string;
  installed: boolean;
  /** 'stale' = registered, but with another address or token. */
  state: 'registered' | 'stale' | 'unregistered';
}

export interface McpCatalog {
  tools: { name: string; description: string }[];
  prompts: {
    name: string;
    title?: string;
    description: string;
    arguments: { name: string; description?: string; required?: boolean }[];
  }[];
}

export function getMcpCatalog(): Promise<McpCatalog> {
  return get('/api/mcp/catalog');
}

export function getMcpConnection(): Promise<McpConnection> {
  return get('/api/mcp/connection');
}

export function getMcpClients(): Promise<McpClientStatus[]> {
  return get('/api/mcp/clients');
}

/** Registers or unregisters one CLI; resolves to the refreshed client list. */
export function setMcpClientRegistered(id: string, registered: boolean): Promise<McpClientStatus[]> {
  return post(`/api/mcp/clients/${id}/${registered ? 'register' : 'unregister'}`);
}
