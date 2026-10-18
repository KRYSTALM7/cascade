import { ApiError } from "../api/client";

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const api = error instanceof ApiError ? error : null;
  const fallbackMessage = error instanceof Error ? error.message : String(error);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="w-full min-w-0 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-950 [overflow-wrap:anywhere]"
    >
      {api ? (
        <div className="space-y-1">
          <p className="break-words">
            <span className="mr-2 inline-block rounded bg-rose-100 px-1.5 py-0.5 align-middle font-mono text-xs font-semibold text-rose-800 ring-1 ring-rose-300">
              {api.code}
            </span>
            <span>{api.message}</span>
          </p>
          {typeof api.details.reason === "string" && api.details.reason !== api.message && (
            <p className="break-words text-xs leading-5 text-rose-900">Details: {api.details.reason}</p>
          )}
          {api.requestId && <p className="break-words font-mono text-xs text-rose-800">Request ID: {api.requestId}</p>}
        </div>
      ) : (
        <p className="break-words">{fallbackMessage}</p>
      )}
    </div>
  );
}
