import { Router } from 'express';

const router = Router();

// POST /api/auth/login
// Body: { password: string }
// Compares with process.env.AUTH_PASSWORD
// Sets session.authenticated = true on success
router.post('/login', (req, res) => {
  const { password } = req.body;
  const authPassword = process.env.AUTH_PASSWORD;

  if (!authPassword) {
    res.status(500).json({ error: 'AUTH_PASSWORD not configured' });
    return;
  }

  if (password === authPassword) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
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
// Returns { authenticated: boolean }
router.get('/status', (req, res) => {
  res.json({ authenticated: req.session?.authenticated === true });
});

export default router;
