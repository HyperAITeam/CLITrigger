import { Router, Request, Response } from 'express';
import { getSetting } from '../db/app-settings.js';

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
  const command = `claude mcp add --transport http clitrigger ${url} --header "Authorization: Bearer ${token}"`;
  res.json({ url, token, config, command });
});

export default router;
