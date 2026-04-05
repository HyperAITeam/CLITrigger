import crypto from 'crypto';
import session from 'express-session';
import type { RequestHandler, Express } from 'express';

// Session-based password authentication middleware
// Uses SESSION_SECRET (or falls back to a random secret per process)

const sessionSecret = process.env.SESSION_SECRET
  || process.env.AUTH_PASSWORD
  || crypto.randomBytes(32).toString('hex');

const isProduction = process.env.NODE_ENV === 'production';

export const sessionMiddleware: RequestHandler = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
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

  // Skip auth when no password is configured
  if (!process.env.AUTH_PASSWORD) {
    return next();
  }

  if (req.session && req.session.authenticated) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
};

export function initAuth(app: Express): void {
  app.use(sessionMiddleware);
  if (process.env.DISABLE_AUTH !== 'true') {
    app.use('/api', authMiddleware);
  }
}
