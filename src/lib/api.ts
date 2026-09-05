import type { AdminArchiveList, AdminSession, ApiErrorBody, Archive, ArchiveList, CreateArchiveResult } from '../../shared/types';

export class ApiError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<Result>(path: string, options: RequestInit = {}): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.method && options.method !== 'GET' ? { 'X-Requested-With': 'Shiguang' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('暂时连接不到服务器，请检查网络后重试。', 'NETWORK_ERROR');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiError(result?.error || '请求失败，请稍后重试。', result?.code || 'REQUEST_FAILED');
  }
  if (response.status === 204) return undefined as Result;
  return response.json() as Promise<Result>;
}

export const api = {
  list: (signal?: AbortSignal) => request<ArchiveList>('/api/archives', { signal }),
  get: (id: string, signal?: AbortSignal) => request<Archive>(`/api/archives/${encodeURIComponent(id)}`, { signal }),
  create: async (url: string, html?: string) => {
    const result = await request<CreateArchiveResult>(html === undefined ? '/api/archives' : '/api/archives/import', {
      method: 'POST',
      body: JSON.stringify({ url, ...(html === undefined ? {} : { html }) }),
    });
    return { ...result, cacheUrl: new URL(result.cachePath, window.location.origin).href };
  },
  favorite: (id: string, favorite: boolean) => request<Archive>(`/api/archives/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ favorite }),
  }),
  remove: (id: string) => request<void>(`/api/archives/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const adminApi = {
  session: (signal?: AbortSignal) => request<AdminSession>('/api/admin/session', { signal }),
  login: (secret: string) => request<AdminSession>('/api/admin/login', { method: 'POST', body: JSON.stringify({ secret }) }),
  logout: () => request<void>('/api/admin/session', { method: 'DELETE' }),
  list: (query: string, page: number, signal?: AbortSignal) => request<AdminArchiveList>(`/api/admin/archives?${new URLSearchParams({ q: query, page: String(page) })}`, { signal }),
  remove: (id: string) => request<void>(`/api/admin/archives/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
