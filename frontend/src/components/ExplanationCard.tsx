import type { Explanation } from "../api/types";

const SOURCE: Record<string, string> = {
  gemini: "Gemini explanation · numbers checked against the report",
  rules: "Template explanation · generated from the report",
  template_fallback: "Template explanation · the LLM narrative failed a check",
};

/** Clearly labelled as narrative: it explains the decision, it never makes it. */
export function ExplanationCard({ explanation, label = "Explanation" }: { explanation: Explanation; label?: string }) {
  return (
    <section aria-label={label} className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-indigo-700">{label}</h3>
        <span className="text-[11px] text-slate-600">{SOURCE[explanation.source] ?? explanation.source}</span>
      </div>
      <p className="mt-2 text-slate-900 text-base leading-relaxed">{explanation.summary}</p>
      {explanation.bullets.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {explanation.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {explanation.rejected_figures.length > 0 && (
        <p className="mt-2 text-xs text-amber-800">Discarded unsupported figures: {explanation.rejected_figures.join(", ")}</p>
      )}
    </section>
  );
}
