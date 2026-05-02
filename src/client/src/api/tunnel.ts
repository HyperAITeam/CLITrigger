import { get, post, put } from './client';

export interface TunnelStatus {
  status: 'stopped' | 'starting' | 'running' | 'error';
  url: string | null;
}

export interface TunnelConfig {
  tunnelName: string;
  customHostname: string;
}

export function getTunnelStatus(): Promise<TunnelStatus> {
  return get('/api/tunnel/status');
}

export function getTunnelConfig(): Promise<TunnelConfig> {
  return get('/api/tunnel/config');
}

export function updateTunnelConfig(data: TunnelConfig): Promise<TunnelConfig> {
  return put('/api/tunnel/config', data);
}

export function startTunnel(port?: number): Promise<{ success: true; url: string }> {
  return post('/api/tunnel/start', port ? { port } : {});
}

export function stopTunnel(): Promise<{ success: true }> {
  return post('/api/tunnel/stop');
}
