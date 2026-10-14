interface ImpactCard {
  title: string;
  incident: string;
  source: string;
  capability: string;
}

const IMPACT_CARDS: ImpactCard[] = [
  {
    title: "Unintended actions",
    incident:
      "In October 2026, Business Insider reportedly described a personal finance agent posting private banking details to a company Slack channel rather than the intended private group.",
    source:
      "https://www.businessinsider.com/personal-ai-agent-grok-bot-posted-bank-details-company-slack-2026-10",
    capability:
      "Simulate proposed actions, validate destinations and permissions, and block or require approval when configured policies are violated.",
  },
  {
    title: "Cascading consequences",
    incident:
      "The Register reported in April 2026 that an AI coding agent deleted PocketOS's production database and volume-level backups through an API call to Railway, disrupting customer operations.",
    source:
      "https://www.theregister.com/software/2026/04/27/cursor-opus-agent-snuffs-out-startups-production-database/",
    capability:
      "Simulate downstream consequences before execution, identify critical resources and dependencies at risk, and apply configured risk policies to destructive actions.",
  },
  {
    title: "Approval integrity",
    incident:
      "The Register reported on GhostApproval, a vulnerability affecting AI coding assistants that could undermine intended sandbox boundaries.",
    source:
      "https://www.theregister.com/security/2026/07/08/bug-in-top-ai-coding-agents-shows-that-unix-era-security-headaches-never-really-die/",
    capability:
      "Bind approval to the exact proposed action and relevant state/configuration, then revalidate and re-simulate before execution. Reject stale or changed proposals according to the existing implementation.",
  },
];

export function ImpactCards() {
  return (
    <section className="max-w-[1280px] mx-auto w-full px-4 md:px-6 lg:px-8 py-12 border-t border-slate-200">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">
            Challenges addressed by Cascade
          </h2>
          <p className="text-base text-slate-600 leading-relaxed max-w-3xl mx-auto">
            Real-world incidents that motivate Cascade's design approach to AI
            agent governance and consequence simulation.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {IMPACT_CARDS.map((card, index) => (
            <div
              key={index}
              className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-md transition-all"
            >
              <div className="flex flex-col h-full">
                {/* Title */}
                <h3 className="text-base font-semibold text-slate-900 mb-3">
                  {card.title}
                </h3>

                {/* Incident */}
                <div className="mb-4 flex-grow">
                  <p className="text-sm text-slate-600 leading-relaxed mb-2">
                    <span className="font-medium text-slate-700">Incident:</span>{" "}
                    {card.incident}
                  </p>
                </div>

                {/* Cascade Capability */}
                <div className="mb-4">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    <span className="font-medium text-slate-700">
                      Cascade capability:
                    </span>{" "}
                    {card.capability}
                  </p>
                </div>

                {/* Source Link */}
                <div className="mt-auto pt-3 border-t border-slate-100">
                  <a
                    href={card.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                  >
                    <span>Read source</span>
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500 leading-relaxed max-w-3xl mx-auto">
            These are real-world examples that motivate Cascade's design. They
            are not experimentally validated Cascade results, and Cascade does
            not claim to have reproduced or prevented these specific incidents.
          </p>
        </div>
      </div>
    </section>
  );
}
