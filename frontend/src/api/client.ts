/** Typed fetch wrapper that understands the backend error envelope. */

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    request_id: string | null;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

/** Network-level failure (backend down, CORS, DNS) — distinct from an HTTP error response. */
export const NETWORK_ERROR = "NETWORK_ERROR";

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

function isEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const err = (value as { error: unknown }).error;
  return typeof err === "object" && err !== null && "code" in err && "message" in err;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, NETWORK_ERROR, "Cannot reach the Cascade backend.");
  }

  const requestId = response.headers.get("X-Request-Id");
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isEnvelope(body)) {
      const { code, message, details, request_id } = body.error;
      throw new ApiError(response.status, code, message, details ?? {}, request_id ?? requestId);
    }
    throw new ApiError(response.status, "HTTP_ERROR", `Request failed with status ${response.status}.`, {}, requestId);
  }
  return body as T;
}
