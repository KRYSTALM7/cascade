import { useState } from "react";
import type { Clarification } from "../api/types";

/** The backend asks; the UI only relays. Candidates come from the backend, never guessed here. */
export function ClarificationPrompt({
  clarification,
  onAnswer,
  busy,
}: {
  clarification: Clarification;
  onAnswer: (answers: Record<string, string>) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <section aria-label="Clarification needed" className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-300">Needs clarification</h3>
      <p className="mt-1 text-slate-100">{clarification.question}</p>
      {clarification.candidates.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {clarification.candidates.map((c) => (
            <button
              key={c.value}
              type="button"
              disabled={busy}
              onClick={() => onAnswer({ [c.field]: c.value })}
              className="rounded-lg border border-violet-400/40 bg-slate-900 px-3 py-1.5 text-sm text-violet-100 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onAnswer({ [clarification.field]: value.trim() });
          }}
        >
          <input
            aria-label={clarification.field}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={clarification.field}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Answer
          </button>
        </form>
      )}
    </section>
  );
}
