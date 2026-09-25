"use client";

import useSWR, { type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh() {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

/** Fetch against the API through the web origin (/api -> API). Retries once after refreshing the session. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await refresh()) return api<T>(path, init, true);
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/panel")) window.location.href = "/login";
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? res.statusText);
  return data as T;
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, (p: string) => api<T>(p), { revalidateOnFocus: true, ...config });
}
