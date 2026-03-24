export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const options: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (res.status === 401) {
    // Redirect to login — trigger a full page state change
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

export function get<T>(url: string): Promise<T> {
  return request<T>('GET', url);
}

export function post<T>(url: string, body?: unknown): Promise<T> {
  return request<T>('POST', url, body);
}

export function put<T>(url: string, body?: unknown): Promise<T> {
  return request<T>('PUT', url, body);
}

export function del<T>(url: string): Promise<T> {
  return request<T>('DELETE', url);
}
