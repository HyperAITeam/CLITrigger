import { get } from './client';

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

export function getMcpConnection(): Promise<McpConnection> {
  return get('/api/mcp/connection');
}
