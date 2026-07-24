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
  const header = `--header "Authorization: Bearer ${token}"`;
  // One-command registration for each supported CLI (all over HTTP transport).
  // ponytail: only the Claude syntax is verified in this project; agy/codex flags
  // follow the same documented pattern — confirm with `<cli> mcp add --help`.
  const commands = [
    { id: 'claude', label: 'Claude Code', command: `claude mcp add --transport http clitrigger ${url} ${header}` },
    { id: 'antigravity', label: 'Antigravity (agy)', command: `agy mcp add --transport http clitrigger ${url} ${header}` },
    { id: 'codex', label: 'Codex', command: `codex mcp add --transport http clitrigger ${url} ${header}` },
  ];
  res.json({ url, token, config, commands });
});

export default router;
