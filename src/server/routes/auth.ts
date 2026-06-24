import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getSetting, setSetting } from '../db/app-settings.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

const router = Router();

const HASH_KEY = 'auth.password_hash';
const CHANGED_AT_KEY = 'auth.password_changed_at';
const MIN_LENGTH = 8;
const REMEMBER_ME_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// Rate limit auth attempts: max 10 per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function validatePasswordPair(password: unknown, confirmPassword: unknown):
  | { ok: true; password: string }
  | { ok: false; status: number; error: string } {
  if (typeof password !== 'string' || !password) {
    return { ok: false, status: 400, error: 'Password is required' };
  }
  if (password.length < MIN_LENGTH) {
    return { ok: false, status: 400, error: `Password must be at least ${MIN_LENGTH} characters` };
  }
  if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
    return { ok: false, status: 400, error: 'Passwords do not match' };
  }
  return { ok: true, password };
}

function markPasswordChanged(): void {
  setSetting(CHANGED_AT_KEY, String(Date.now()));
}

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { password } = req.body ?? {};
  const remember = req.body?.remember === true;
  const hash = getSetting(HASH_KEY);

  if (!hash) {
    res.status(503).json({ error: 'setup_required' });
    return;
  }
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  let ok = false;
  try {
    ok = await verifyPassword(password, hash);
  } catch {
    ok = false;
  }

  if (ok) {
    req.session.authenticated = true;
    req.session.createdAt = Date.now();
    if (remember) {
      req.session.cookie.maxAge = REMEMBER_ME_MAX_AGE;
    }
    res.json({ success: true });
  } else {
    console.warn(`Failed login attempt from ${req.ip}`);
    res.status(401).json({ error: 'Invalid password' });
  }
});

// POST /api/auth/setup
// Only available when no password has been set yet (initial bootstrap).
router.post('/setup', authLimiter, async (req, res) => {
  if (getSetting(HASH_KEY)) {
    res.status(409).json({ error: 'already_initialized' });
    return;
  }
  const { password, confirmPassword } = req.body ?? {};
  const validation = validatePasswordPair(password, confirmPassword);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  const hash = await hashPassword(validation.password);
  setSetting(HASH_KEY, hash);
  markPasswordChanged();

  req.session.authenticated = true;
  req.session.createdAt = Date.now();
  res.json({ success: true });
});

// PUT /api/auth/password
// Authenticated endpoint — middleware has already verified the session.
router.put('/password', authLimiter, async (req, res) => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { oldPassword, newPassword, confirmPassword } = req.body ?? {};
  const hash = getSetting(HASH_KEY);
  if (!hash) {
    res.status(503).json({ error: 'setup_required' });
    return;
  }
  if (typeof oldPassword !== 'string' || !oldPassword) {
    res.status(400).json({ error: 'Current password is required' });
    return;
  }

  let oldOk = false;
  try {
    oldOk = await verifyPassword(oldPassword, hash);
  } catch {
    oldOk = false;
  }
  if (!oldOk) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const validation = validatePasswordPair(newPassword, confirmPassword);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  const newHash = await hashPassword(validation.password);
  setSetting(HASH_KEY, newHash);
  markPasswordChanged();

  // Keep this session alive — refresh createdAt so the new password_changed_at
  // timestamp does not invalidate the requester. Other sessions (older
  // createdAt) will be rejected on their next request by authMiddleware.
  req.session.createdAt = Date.now();
  res.json({ success: true });
});

// POST /api/auth/logout
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
router.get('/status', (req, res) => {
  if (process.env.DISABLE_AUTH === 'true') {
    res.json({ authenticated: true, authRequired: false, setupRequired: false });
    return;
  }
  const setupRequired = !getSetting(HASH_KEY);
  res.json({
    authenticated: req.session?.authenticated === true,
    authRequired: true,
    setupRequired,
  });
});

export default router;
