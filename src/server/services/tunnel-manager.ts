import { spawn, execFile, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join } from 'path';

export class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private url: string | null = null;
  private status: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
  private cloudflaredPath: string = 'cloudflared';

  /**
   * Start a quick (unnamed) cloudflared tunnel.
   * Runs: cloudflared tunnel --url http://localhost:<port>
   * Parses stderr for the generated trycloudflare.com URL.
   */
  async startTunnel(port: number): Promise<string> {
    if (this.status === 'running' || this.status === 'starting') {
      throw new Error('Tunnel is already running or starting');
    }

    const installed = await this.isCloudflaredInstalled();
    if (!installed) {
      throw new Error(
        'cloudflared is not installed. Install it with: winget install cloudflare.cloudflared (Windows) or brew install cloudflared (macOS)'
      );
    }

    this.status = 'starting';
    this.url = null;

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(this.cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      this.process = proc;

      const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
      let resolved = false;

      // A timeout so we don't hang forever waiting for a URL
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.status = 'error';
          this.emit('error', new Error('Timed out waiting for tunnel URL'));
          reject(new Error('Timed out waiting for tunnel URL (30s)'));
        }
      }, 30_000);

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(urlPattern);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.url = match[0];
          this.status = 'running';
          this.emit('url', this.url);
          resolve(this.url);
        }
      };

      // cloudflared outputs the URL to stderr
      proc.stderr?.on('data', handleOutput);
      // Also check stdout just in case
      proc.stdout?.on('data', handleOutput);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        this.status = 'error';
        this.process = null;
        this.emit('error', err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        this.process = null;
        if (this.status === 'running') {
          this.status = 'stopped';
          this.url = null;
          this.emit('exit', code);
        } else if (!resolved) {
          resolved = true;
          this.status = 'error';
          reject(new Error(`cloudflared exited with code ${code} before producing a URL`));
        }
      });
    });
  }

  /**
   * Start a named cloudflared tunnel.
   * Runs: cloudflared tunnel run <tunnelName>
   * The URL comes from the tunnel's DNS configuration (not parsed from output).
   */
  async startNamedTunnel(tunnelName: string, port: number): Promise<string> {
    if (this.status === 'running' || this.status === 'starting') {
      throw new Error('Tunnel is already running or starting');
    }

    const installed = await this.isCloudflaredInstalled();
    if (!installed) {
      throw new Error(
        'cloudflared is not installed. Install it with: winget install cloudflare.cloudflared (Windows) or brew install cloudflared (macOS)'
      );
    }

    this.status = 'starting';
    this.url = null;

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(this.cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`, 'run', tunnelName], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      this.process = proc;

      let resolved = false;

      // For named tunnels, look for a connection registration message
      const connPattern = /connection.*registered|Registered tunnel connection/i;
      const urlPattern = /https:\/\/[a-zA-Z0-9.-]+/;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Named tunnels may not output a URL, but the tunnel is running
          this.status = 'running';
          const inferredUrl = `https://${tunnelName}.cfargotunnel.com`;
          this.url = inferredUrl;
          this.emit('url', inferredUrl);
          resolve(inferredUrl);
        }
      }, 15_000);

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        if (connPattern.test(text) && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          // Try to find a URL in the output
          const match = text.match(urlPattern);
          this.url = match ? match[0] : `https://${tunnelName}.cfargotunnel.com`;
          this.status = 'running';
          this.emit('url', this.url);
          resolve(this.url);
        }
      };

      proc.stderr?.on('data', handleOutput);
      proc.stdout?.on('data', handleOutput);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        this.status = 'error';
        this.process = null;
        this.emit('error', err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        this.process = null;
        if (this.status === 'running') {
          this.status = 'stopped';
          this.url = null;
          this.emit('exit', code);
        } else if (!resolved) {
          resolved = true;
          this.status = 'error';
          reject(new Error(`cloudflared exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Stop the running cloudflared tunnel process.
   */
  async stopTunnel(): Promise<void> {
    if (!this.process) {
      this.status = 'stopped';
      this.url = null;
      return;
    }

    return new Promise<void>((resolve) => {
      const proc = this.process!;

      const forceKillTimeout = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Process may already be dead
        }
      }, 5_000);

      proc.once('exit', () => {
        clearTimeout(forceKillTimeout);
        this.process = null;
        this.status = 'stopped';
        this.url = null;
        resolve();
      });

      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may already be dead
        clearTimeout(forceKillTimeout);
        this.process = null;
        this.status = 'stopped';
        this.url = null;
        resolve();
      }
    });
  }

  /**
   * Get the current tunnel status and URL.
   */
  getTunnelStatus(): { status: string; url: string | null } {
    return { status: this.status, url: this.url };
  }

  /**
   * Resolve the full path to cloudflared, checking PATH first,
   * then common Windows installation locations (winget, Program Files).
   */
  private resolveCloudflaredPath(): string | null {
    // 1) Try PATH first (works if cloudflared is globally accessible)
    //    execFileSync would throw, so we just return the bare name and let the caller test it.
    //    We'll verify in isCloudflaredInstalled.

    if (process.platform === 'win32') {
      const home = process.env.USERPROFILE || process.env.HOME || '';
      const candidates = [
        // winget package location
        join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages',
          'Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe', 'cloudflared.exe'),
        // winget links
        join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
        // common manual install locations
        join('C:', 'Program Files', 'cloudflared', 'cloudflared.exe'),
        join('C:', 'Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Check if cloudflared is installed by running 'cloudflared --version'.
   * Falls back to known installation paths on Windows if not found in PATH.
   */
  async isCloudflaredInstalled(): Promise<boolean> {
    // First try the current cloudflaredPath (default: 'cloudflared' = from PATH)
    const inPath = await new Promise<boolean>((resolve) => {
      execFile('cloudflared', ['--version'], { shell: true }, (error) => {
        resolve(!error);
      });
    });

    if (inPath) {
      this.cloudflaredPath = 'cloudflared';
      return true;
    }

    // Fallback: try known installation paths
    const resolved = this.resolveCloudflaredPath();
    if (resolved) {
      const works = await new Promise<boolean>((resolve) => {
        execFile(resolved, ['--version'], (error) => {
          resolve(!error);
        });
      });
      if (works) {
        this.cloudflaredPath = resolved;
        return true;
      }
    }

    return false;
  }
}

export const tunnelManager = new TunnelManager();
