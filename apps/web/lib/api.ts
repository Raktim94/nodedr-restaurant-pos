const API_BASE = "/api/v1";

// Calls made by signed-out pages. A 401 there is expected (login form, public
// menu/kiosk), so it must never bounce the user to /login.
const PUBLIC_PREFIXES = ["/auth/", "/public/", "/display/", "/setup"];
const isPublicCall = (path: string) => PUBLIC_PREFIXES.some((p) => path.startsWith(p));

let onUnauthorized: (() => void) | null = null;
/** Lets the app shell override the fallback (e.g. React Query cache cleanup). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: unknown,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // A FormData body (file upload) must NOT get a manual Content-Type — the
  // browser sets one with the multipart boundary itself; forcing
  // application/json here makes the upload arrive unparseable server-side.
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    if (res.status === 401 && !isPublicCall(path) && typeof window !== "undefined") {
      // The JWT can expire mid-shift. Without this, every query fails 401 but
      // the shell keeps rendering the last cached user and the operator is
      // stuck in error states until they manually navigate to sign-in.
      if (onUnauthorized) onUnauthorized();
      else window.location.replace("/login");
    }
    throw new ApiError(body.message ?? "Request failed", res.status, body.issues, body.code);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
  upload: <T>(path: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<T>(path, { method: "POST", body: formData });
  },
};
