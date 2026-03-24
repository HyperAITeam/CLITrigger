import session from 'express-session';
import type { RequestHandler, Express } from 'express';

// Session-based password authentication middleware
// Reads AUTH_PASSWORD from process.env

export const sessionMiddleware: RequestHandler = session({
  secret: process.env.AUTH_PASSWORD || 'default-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,  // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
  },
});

// Auth check middleware - skip for /api/auth/* routes
export const authMiddleware: RequestHandler = (req, res, next) => {
  // Skip auth for login/status endpoints
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/auth')) {
    return next();
  }
  // Skip auth for health check
  if (req.path === '/api/health' || req.path === '/health') {
    return next();
  }

  if (req.session && req.session.authenticated) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
};

export function initAuth(app: Express): void {
  app.use(sessionMiddleware);
  app.use('/api', authMiddleware);
}
