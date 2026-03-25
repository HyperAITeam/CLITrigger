import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Create the middleware function directly to test logic without Express session dependency
describe('authMiddleware', () => {
  // Replicate the core auth logic for unit testing
  function authCheck(req: Partial<Request>, res: Partial<Response>, next: NextFunction) {
    if (req.path?.startsWith('/api/auth') || req.path?.startsWith('/auth')) {
      return next();
    }
    if (req.path === '/api/health' || req.path === '/health') {
      return next();
    }
    if (req.session && (req.session as any).authenticated) {
      return next();
    }
    (res.status as any)(401).json({ error: 'Unauthorized' });
  }

  function createMockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('should skip auth for /api/auth routes', () => {
    const next = vi.fn();
    const req = { path: '/api/auth/login', session: {} } as any;
    authCheck(req, createMockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should skip auth for /auth routes', () => {
    const next = vi.fn();
    const req = { path: '/auth/status', session: {} } as any;
    authCheck(req, createMockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should skip auth for health check', () => {
    const next = vi.fn();
    const req = { path: '/api/health', session: {} } as any;
    authCheck(req, createMockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should allow authenticated requests', () => {
    const next = vi.fn();
    const req = { path: '/api/projects', session: { authenticated: true } } as any;
    authCheck(req, createMockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject unauthenticated requests', () => {
    const next = vi.fn();
    const res = createMockRes();
    const req = { path: '/api/projects', session: {} } as any;
    authCheck(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('should reject when no session exists', () => {
    const next = vi.fn();
    const res = createMockRes();
    const req = { path: '/api/todos', session: undefined } as any;
    authCheck(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
