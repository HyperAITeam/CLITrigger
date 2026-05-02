import { Router } from 'express';
import { tunnelManager } from '../services/tunnel-manager.js';
import { getSetting, setSetting } from '../db/app-settings.js';

const router = Router();

const TUNNEL_NAME_KEY = 'tunnel.name';
const TUNNEL_HOSTNAME_KEY = 'tunnel.hostname';

const HOSTNAME_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

function readTunnelConfig(): { tunnelName: string; customHostname: string } {
  return {
    tunnelName: getSetting(TUNNEL_NAME_KEY) ?? process.env.TUNNEL_NAME ?? '',
    customHostname: getSetting(TUNNEL_HOSTNAME_KEY) ?? process.env.TUNNEL_HOSTNAME ?? '',
  };
}

// GET /api/tunnel/status
// Returns { status, url }
router.get('/status', (_req, res) => {
  const status = tunnelManager.getTunnelStatus();
  res.json(status);
});

// GET /api/tunnel/config
router.get('/config', (_req, res) => {
  res.json(readTunnelConfig());
});

// PUT /api/tunnel/config
// Body: { tunnelName?: string, customHostname?: string }
router.put('/config', (req, res) => {
  const tunnelNameRaw = typeof req.body?.tunnelName === 'string' ? req.body.tunnelName.trim() : '';
  const customHostnameRaw =
    typeof req.body?.customHostname === 'string' ? req.body.customHostname.trim() : '';

  if (customHostnameRaw) {
    const lower = customHostnameRaw.toLowerCase();
    if (lower === 'localhost' || lower === '127.0.0.1' || /\s/.test(customHostnameRaw)) {
      return res.status(400).json({ error: 'customHostname must be a public domain (e.g. app.your-domain.com)' });
    }
    if (!HOSTNAME_PATTERN.test(customHostnameRaw)) {
      return res.status(400).json({ error: 'customHostname is not a valid domain name' });
    }
    if (!tunnelNameRaw) {
      return res.status(400).json({ error: 'tunnelName is required when customHostname is set' });
    }
  }

  setSetting(TUNNEL_NAME_KEY, tunnelNameRaw || null);
  setSetting(TUNNEL_HOSTNAME_KEY, customHostnameRaw || null);

  res.json(readTunnelConfig());
});

// POST /api/tunnel/start
// Body: { port?: number }
// Manually start the tunnel
router.post('/start', async (req, res) => {
  try {
    const port = req.body.port || Number(process.env.PORT) || 3000;
    const { tunnelName, customHostname } = readTunnelConfig();

    let url: string;
    if (tunnelName) {
      url = await tunnelManager.startNamedTunnel(tunnelName, port, customHostname || undefined);
    } else {
      url = await tunnelManager.startTunnel(port);
    }

    res.json({ success: true, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start tunnel';
    res.status(500).json({ error: message });
  }
});

// POST /api/tunnel/stop
// Manually stop the tunnel
router.post('/stop', async (_req, res) => {
  try {
    await tunnelManager.stopTunnel();
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to stop tunnel';
    res.status(500).json({ error: message });
  }
});

export default router;
