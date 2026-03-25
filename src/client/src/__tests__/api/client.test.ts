import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get, post, put, del, ApiError } from '../../api/client';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should make GET request with credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'test' }),
    });

    const result = await get('/api/test');
    expect(result).toEqual({ data: 'test' });
    expect(mockFetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
  });

  it('should make POST request with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await post('/api/test', { key: 'value' });
    expect(mockFetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
    }));
  });

  it('should make PUT request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ updated: true }),
    });

    await put('/api/test/1', { name: 'new' });
    expect(mockFetch).toHaveBeenCalledWith('/api/test/1', expect.objectContaining({
      method: 'PUT',
    }));
  });

  it('should make DELETE request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    await del('/api/test/1');
    expect(mockFetch).toHaveBeenCalledWith('/api/test/1', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  it('should handle 204 No Content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await del('/api/test/1');
    expect(result).toBeUndefined();
  });

  it('should throw ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Server error'),
    });

    try {
      await get('/api/test');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });

  it('should dispatch auth:unauthorized event on 401', async () => {
    const listener = vi.fn();
    window.addEventListener('auth:unauthorized', listener);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(get('/api/test')).rejects.toThrow(ApiError);
    expect(listener).toHaveBeenCalled();

    window.removeEventListener('auth:unauthorized', listener);
  });
});
