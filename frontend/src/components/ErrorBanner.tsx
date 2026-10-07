import { ApiError } from "../api/client";

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const api = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      {api ? (
        <>
          <span className="font-mono text-xs text-rose-300">{api.code}</span> — {api.message}
        </>
      ) : (
        String(error)
      )}
    </div>
  );
}
