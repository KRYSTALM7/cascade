import type { Explanation } from "../api/types";

const SOURCE: Record<string, string> = {
  gemini: "Gemini explanation · numbers checked against the report",
  rules: "Template explanation · generated from the report",
  template_fallback: "Template explanation · the LLM narrative failed a check",
};

/** Clearly labelled as narrative: it explains the decision, it never makes it. */
export function ExplanationCard({ explanation, label = "Explanation" }: { explanation: Explanation; label?: string }) {
  return (
    <section aria-label={label} className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-indigo-300">{label}</h3>
        <span className="text-[11px] text-indigo-300/70">{SOURCE[explanation.source] ?? explanation.source}</span>
      </div>
      <p className="mt-2 text-slate-200">{explanation.summary}</p>
      {explanation.bullets.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
          {explanation.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {explanation.rejected_figures.length > 0 && (
        <p className="mt-2 text-xs text-amber-300">Discarded unsupported figures: {explanation.rejected_figures.join(", ")}</p>
      )}
    </section>
  );
}
