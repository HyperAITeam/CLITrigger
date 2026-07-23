import { get } from './client';

export interface McpConnection {
  url: string;
  token: string;
  config: unknown;
  command: string;
}

export function getMcpConnection(): Promise<McpConnection> {
  return get('/api/mcp/connection');
}
