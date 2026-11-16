import { Router, Request, Response } from 'express';
import { getSetting } from '../db/app-settings.js';
import {
  isMcpClient,
  listMcpClients,
  mcpClientManuals,
  registerMcpClient,
  unregisterMcpClient,
} from '../services/mcp-clients.js';

const router = Router();

// GET /api/mcp/connection - ready-to-paste MCP client config (session-auth).
// Only a logged-in user sees their local token.
router.get('/mcp/connection', (req: Request, res: Response) => {
  const token = getSetting('mcp.token') || '';
  const host = req.get('host') || `localhost:${req.socket.localPort}`;
  const url = `${req.protocol}://${host}/mcp`;
  const config = {
    mcpServers: {
      clitrigger: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
  // Manual registration text for each supported CLI.
  const commands = mcpClientManuals(url, token);
  // Set by Electron when its configured port was taken and it fell back to another.
  const preferredPort = Number(process.env.CLITRIGGER_PREFERRED_PORT) || null;
  res.json({ url, token, config, commands, preferredPort });
});

// One-click registration configures the CLIs on this machine, so it always
// targets loopback on the actually-bound port — never the request's Host header.
function localEndpoint(req: Request): { url: string; token: string } {
  return { url: `http://127.0.0.1:${req.socket.localPort}/mcp`, token: getSetting('mcp.token') || '' };
}

// GET /api/mcp/clients - install + registration state of each supported CLI.
router.get('/mcp/clients', async (req: Request, res: Response) => {
  const { url, token } = localEndpoint(req);
  res.json(await listMcpClients(url, token));
});

// POST /api/mcp/clients/:id/register|unregister - returns the refreshed list.
const changeClient = (register: boolean) => async (req: Request<{ id: string }>, res: Response) => {
  const { url, token } = localEndpoint(req);
  const id = req.params.id;
  if (!isMcpClient(id)) {
    res.status(404).json({ error: 'Unknown MCP client' });
    return;
  }
  try {
    if (register) await registerMcpClient(id, url, token);
    else await unregisterMcpClient(id);
    res.json(await listMcpClients(url, token));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
};
router.post('/mcp/clients/:id/register', changeClient(true));
router.post('/mcp/clients/:id/unregister', changeClient(false));

export default router;
