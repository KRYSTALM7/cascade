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
    <section aria-label="Clarification needed" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-indigo-900">Needs clarification</h3>
      <p className="mt-1 text-slate-700">{clarification.question}</p>
      {clarification.candidates.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {clarification.candidates.map((c) => (
            <button
              key={c.value}
              type="button"
              disabled={busy}
              onClick={() => onAnswer({ [c.field]: c.value })}
              className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
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
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-900 placeholder:text-slate-400"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            Answer
          </button>
        </form>
      )}
    </section>
  );
}
