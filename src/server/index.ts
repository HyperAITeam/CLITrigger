import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- Auth middleware (Phase 7) ---
// import { initAuth } from './middleware/auth';
// initAuth(app);

// --- Routes ---
// import { initRoutes } from './routes';
// initRoutes(app);

// --- WebSocket (Phase 5) ---
// import { initWebSocket } from './websocket';
// initWebSocket(server);

// --- Tunnel (Phase 7) ---
// import { initTunnel } from './services/tunnel-manager';
// if (process.env.TUNNEL_ENABLED === 'true') initTunnel(PORT);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

server.listen(PORT, () => {
  console.log(`CLITrigger server running on http://localhost:${PORT}`);
});

export { app, server };
