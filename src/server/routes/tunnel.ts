import { Router } from 'express';
import { tunnelManager } from '../services/tunnel-manager.js';

const router = Router();

// GET /api/tunnel/status
// Returns { status, url }
router.get('/status', (_req, res) => {
  const status = tunnelManager.getTunnelStatus();
  res.json(status);
});

// POST /api/tunnel/start
// Body: { port?: number }
// Manually start the tunnel
router.post('/start', async (req, res) => {
  try {
    const port = req.body.port || Number(process.env.PORT) || 3000;
    const tunnelName = process.env.TUNNEL_NAME;

    let url: string;
    if (tunnelName) {
      url = await tunnelManager.startNamedTunnel(tunnelName, port);
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
