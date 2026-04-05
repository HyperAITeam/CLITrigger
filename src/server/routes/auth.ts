import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limit login attempts: max 10 per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Timing-safe password comparison
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid short-circuit timing leak
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// POST /api/auth/login
// Body: { password: string }
// Compares with process.env.AUTH_PASSWORD
// Sets session.authenticated = true on success
router.post('/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  const authPassword = process.env.AUTH_PASSWORD;

  if (!authPassword) {
    console.error('AUTH_PASSWORD environment variable is not configured');
    res.status(500).json({ error: 'Server authentication not configured' });
    return;
  }

  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  if (safeCompare(password, authPassword)) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    console.warn(`Failed login attempt from ${req.ip}`);
    res.status(401).json({ error: 'Invalid password' });
  }
});

// POST /api/auth/logout
// Destroys session
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to logout' });
      return;
    }
    res.json({ success: true });
  });
});

// GET /api/auth/status
// Returns { authenticated: boolean, authRequired: boolean }
router.get('/status', (req, res) => {
  const authRequired = !!process.env.AUTH_PASSWORD;
  if (!authRequired) {
    res.json({ authenticated: true, authRequired: false });
  } else {
    res.json({ authenticated: req.session?.authenticated === true, authRequired: true });
  }
});

export default router;
