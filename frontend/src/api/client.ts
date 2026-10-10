// Talks to the Nicked backend (backend/README.md). Every error the backend
// sends is { error, code } with a message written for the shop owner.

/**
 * Where the API lives. Empty = same origin (Vite's dev proxy, or a host that
 * proxies /api). Set VITE_API_URL to the backend's public URL on Vercel.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * Live mode talks to the backend; demo mode is the in-browser preview with
 * sample data. Live is on when VITE_API_URL is set or VITE_LIVE=true.
 */
export const LIVE = Boolean(API_BASE) || import.meta.env.VITE_LIVE === 'true';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * The worker that takes uploads and holds the footage (Dockerfile: API + YOLO + ffmpeg).
 * On Vercel the API runs as a function that can't take video, so set VITE_WORKER_URL.
 * Empty = the API host does it all (local dev, or the whole backend on one server).
 */
export const WORKER_BASE = (import.meta.env.VITE_WORKER_URL ?? '').replace(/\/$/, '') || API_BASE;

/** Absolute URL for an API path. */
export const apiUrl = (path: string | null | undefined) => (path ? `${API_BASE}${path}` : null);

/** Absolute URL for footage and frames (video, thumbnails, evidence, clip exports): they live on the worker. */
export const mediaUrl = (path: string | null | undefined) => (path ? `${WORKER_BASE}${path}` : null);

async function parse(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      body?.error || `Nicked's server answered ${res.status}. Try again in a moment.`,
      res.status,
      body?.code || 'HTTP_ERROR',
      body?.details,
    );
  }
  return body;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach Nicked's server. Check the connection and try again.", 0, 'NETWORK');
  }
  return parse(res);
}

/** Multipart upload with progress (fetch can't report upload progress). */
export function uploadClip(
  file: File,
  fields: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('clip', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${WORKER_BASE}/api/clips`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body?.error || `The upload failed (${xhr.status}).`, xhr.status, body?.code || 'UPLOAD_FAILED', body?.details));
    };
    xhr.onerror = () => reject(new ApiError('The upload stopped. Check the connection and try again.', 0, 'NETWORK'));
    xhr.send(form);
  });
}
