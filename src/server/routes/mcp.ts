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
    // --scope user: the default (local) scope only registers it for the folder the command ran in.
    { id: 'claude', label: 'Claude Code', command: `claude mcp add --scope user --transport http clitrigger ${url} ${header}` },
    { id: 'antigravity', label: 'Antigravity (agy)', command: `agy mcp add --transport http clitrigger ${url} ${header}` },
    { id: 'codex', label: 'Codex', command: `codex mcp add --transport http clitrigger ${url} ${header}` },
  ];
  // Set by Electron when its configured port was taken and it fell back to another.
  const preferredPort = Number(process.env.CLITRIGGER_PREFERRED_PORT) || null;
  res.json({ url, token, config, commands, preferredPort });
});

export default router;
