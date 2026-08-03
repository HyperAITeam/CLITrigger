import { useState, useEffect, useCallback } from 'react';
import * as authApi from '../api/auth';

export function useAuth() {
  const [authenticated, setAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi.getAuthStatus()
      .then((res) => {
        setAuthenticated(res.authenticated);
        setAuthRequired(res.authRequired);
        setSetupRequired(res.setupRequired);
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  // Listen for 401 events from the API client
  useEffect(() => {
    const handler = () => setAuthenticated(false);
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  const login = useCallback(async (password: string, remember: boolean) => {
    await authApi.login(password, remember);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setAuthenticated(false);
  }, []);

  const setup = useCallback(async (password: string, confirmPassword: string) => {
    await authApi.setupPassword(password, confirmPassword);
    setSetupRequired(false);
    setAuthenticated(true);
  }, []);

  // Change password from the login screen: sign in with the current password,
  // rotate it on the now-authenticated session, then enter the app.
  const changePassword = useCallback(async (
    oldPassword: string,
    newPassword: string,
    confirmPassword: string,
    remember: boolean,
  ) => {
    await authApi.login(oldPassword, remember);
    try {
      await authApi.changePassword(oldPassword, newPassword, confirmPassword);
    } catch (err) {
      await authApi.logout().catch(() => {});
      throw err;
    }
    setAuthenticated(true);
  }, []);

  return { authenticated, authRequired, setupRequired, loading, login, logout, setup, changePassword };
}
