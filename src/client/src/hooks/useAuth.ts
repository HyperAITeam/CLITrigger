import { useState, useEffect, useCallback } from 'react';
import * as authApi from '../api/auth';

export function useAuth() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi.getAuthStatus()
      .then((res) => setAuthenticated(res.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  // Listen for 401 events from the API client
  useEffect(() => {
    const handler = () => setAuthenticated(false);
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  const login = useCallback(async (password: string) => {
    await authApi.login(password);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setAuthenticated(false);
  }, []);

  return { authenticated, loading, login, logout };
}
