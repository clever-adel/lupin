/**
 * Browser-side API client. Same-origin /api (proxied by the Worker); auth lives in HttpOnly cookies.
 * Not named *.client.ts on purpose: React Router empties such modules on the server, and ApiError is
 * referenced while components render there.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface UploadedImage {
  publicId: string;
  url: string;
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

async function csrfToken(): Promise<string> {
  const existing = readCookie("XSRF-TOKEN");
  if (existing) return existing;
  const response = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-XSRF-TOKEN"] = await csrfToken();
  return fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit a 401 together. */
function refreshSession(): Promise<boolean> {
  refreshing ??= send("POST", "/api/v1/auth/refresh")
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response = await send(method, path, body);
  const isAuthCall = path.startsWith("/api/v1/auth/") && path !== "/api/v1/auth/me";
  if (response.status === 401 && !isAuthCall && (await refreshSession())) {
    response = await send(method, path, body);
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as
    | { code?: string; message?: string; fields?: Record<string, string> }
    | null;
  if (!response.ok) {
    throw new ApiError(response.status, payload?.code ?? "ERROR", payload?.message ?? "", payload?.fields);
  }
  return payload as T;
}

/** Upload images directly to the same-origin Worker, which stores them in private R2 and serves them publicly. */
export async function uploadImages(files: File[]): Promise<UploadedImage[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const sendUpload = async () => fetch("/media/upload", {
    method: "POST",
    headers: { "X-XSRF-TOKEN": await csrfToken(), Accept: "application/json" },
    credentials: "same-origin",
    body: form,
  });
  let response = await sendUpload();
  if (response.status === 401 && await refreshSession()) response = await sendUpload();
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiError(response.status, "IMAGE_UPLOAD_FAILED", payload?.message ?? "Could not upload the selected images.");
  }
  return await response.json() as UploadedImage[];
}

export async function deleteUploadedImage(publicId: string): Promise<void> {
  const response = await fetch(`/media/${encodeURIComponent(publicId)}`, {
    method: "DELETE",
    headers: { "X-XSRF-TOKEN": await csrfToken(), Accept: "application/json" },
    credentials: "same-origin",
  });
  if (response.status === 401 && await refreshSession()) {
    const retry = await fetch(`/media/${encodeURIComponent(publicId)}`, {
      method: "DELETE",
      headers: { "X-XSRF-TOKEN": await csrfToken(), Accept: "application/json" },
      credentials: "same-origin",
    });
    if (retry.ok || retry.status === 404) return;
    throw new ApiError(retry.status, "IMAGE_DELETE_FAILED", "Could not remove an image from storage.");
  }
  if (!response.ok && response.status !== 404) {
    throw new ApiError(response.status, "IMAGE_DELETE_FAILED", "Could not remove an image from storage.");
  }
}
