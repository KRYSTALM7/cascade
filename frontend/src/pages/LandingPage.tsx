import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { SCENARIOS, HERO } from "../lib/scenarios";
import { agentName, agentStyle } from "../lib/format";
import { ImpactCards } from "../components/ImpactCards";

const MERCORA_URL = "https://demo-polish-web---mercora-web-gp5ciyqy6a-el.a.run.app/dashboard";

/** Main landing page with production-ready hero */
export function LandingPage() {
  const navigate = useNavigate();
  const [agent, setAgent] = useState(HERO.scenario.agent);
  const [text, setText] = useState(HERO.scenario.text);
  const [isSimulating, setIsSimulating] = useState(false);

  const AGENTS = ["customer-support", "order", "finance", "inventory", "crm"];

  const handleSimulate = () => {
    if (text.trim()) {
      setIsSimulating(true);
      navigate("/simulate", { state: { agent, text } });
    }
  };

  const handleScenario = (scenario: typeof SCENARIOS[number]) => {
    setAgent(scenario.agent);
    setText(scenario.text);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <section className="max-w-[1280px] mx-auto w-full px-4 md:px-6 lg:px-8 min-h-[calc(100vh-80px)] py-4">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16 min-h-[calc(100vh-80px-2rem)]">
          {/* Left Column */}
          <div className="space-y-3.5">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 shadow-sm">
              AI AGENTS CAN TRIGGER MORE THAN THEY INTEND
            </div>

            {/* Headline - wraps on mobile, 2 lines on desktop */}
            <h1 className="font-extrabold leading-[1.08] tracking-[-0.02em] text-slate-900" style={{ fontSize: 'clamp(2rem, 8vw, 2.75rem)' }}>
              <span className="xl:whitespace-nowrap">Know the consequences</span>
              <br className="hidden xl:inline" />{" "}
              <span className="xl:whitespace-nowrap">
                <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">before</span> AI acts.
              </span>
            </h1>

            {/* Supporting Copy */}
            <p className="text-[17px] leading-relaxed text-slate-600 max-w-[34rem]" style={{ marginTop: '12px', marginBottom: '20px' }}>
              Cascade simulates the downstream impact of every agent action across agents, tools, data and systems, helping you understand risk and decide whether it should execute.
            </p>

            {/* Proposed Action Card - stacks on mobile */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Proposed Action
              </div>
              
              <div className="space-y-3">
                {/* Stack on mobile, side by side on desktop */}
                <div className="flex flex-col lg:flex-row gap-3">
                  <div className="w-full lg:w-[220px] lg:shrink-0">
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Acting agent
                    </label>
                    <select
                      value={agent}
                      onChange={(e) => setAgent(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base lg:text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors min-h-[44px]"
                      style={{ color: agentStyle(agent).color, fontSize: '16px' }}
                    >
                      {AGENTS.map((a) => (
                        <option key={a} value={a}>
                          {agentName(a)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 min-w-0">
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      What should the agent do?
                    </label>
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="e.g. Cancel ORD-10482, customer wants out"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors min-h-[44px]"
                      style={{ fontSize: '16px' }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSimulate}
                  disabled={!text.trim() || isSimulating}
                  className="group flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 h-12"
                >
                  {isSimulating ? (
                    <>
                      <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Simulating...
                    </>
                  ) : (
                    <>
                      Simulate consequences
                      <svg className="h-5 w-5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Scenario Shortcuts */}
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">
                Try a scenario
              </div>
              <div className="flex flex-wrap gap-2">
                {SCENARIOS.slice(0, 4).map((scenario) => (
                  <button
                    key={scenario.key}
                    type="button"
                    onClick={() => handleScenario(scenario)}
                    className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors whitespace-nowrap min-h-[40px]"
                  >
                    {scenario.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Hero Image (hidden < 640px, shown centered 640-1023px, normal on lg+) */}
          <div className="relative hidden sm:flex lg:flex items-center justify-center order-first lg:order-last">
            <div className="relative w-full max-w-[420px] lg:max-w-[640px] mx-auto">
              {/* Subtle glow behind image - isolated to this div */}
              <div 
                className="absolute inset-0 rounded-full blur-3xl" 
                style={{ 
                  background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)',
                  animation: isSimulating ? 'pulse 2s ease-in-out infinite' : 'none'
                }}
              />
              
              {/* Hero image with float animation */}
              <img 
                src="/cascade-transparent-hero.webp"
                alt="Cascade agent network visualization"
                className="relative w-full h-auto object-contain"
                style={{
                  maxHeight: '70vh',
                  animation: 'float 6s ease-in-out infinite'
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Integration Section - Visible without scrolling */}
      <section className="max-w-[1280px] mx-auto w-full px-4 md:px-6 lg:px-8 py-8 border-t border-slate-200">
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 max-w-4xl mx-auto">
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            See Cascade in action.
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            From commerce operations to consequence-aware AI decisions.
          </p>
          
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-2 h-2 rounded-full bg-indigo-400 mt-1.5" />
              <div className="text-sm">
                <span className="font-semibold text-slate-900">Mercora:</span>{" "}
                <span className="text-slate-600">The operations layer — products, orders, customers and inventory.</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-2 h-2 rounded-full bg-violet-400 mt-1.5" />
              <div className="text-sm">
                <span className="font-semibold text-slate-900">Cascade:</span>{" "}
                <span className="text-slate-600">The consequence layer — simulate impact, assess risk and enforce policy before execution.</span>
              </div>
            </div>
          </div>

          <div className="mb-4 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
            <p className="text-sm font-medium text-slate-800 leading-relaxed text-center">
              Mercora runs the business. Cascade helps keep autonomous actions from putting it at risk.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={MERCORA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              Open Mercora Operations
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <Link
              to="/simulate"
              className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
            >
              Explore simulations
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Impact Cards - Challenges Addressed by Cascade */}
      <ImpactCards />

      {/* Business Value Section - Full Width */}
      <section className="max-w-[1280px] mx-auto w-full px-4 md:px-6 lg:px-8 py-16 border-t border-slate-200">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">
              One AI action. Consequences across the business.
            </h2>
            <p className="text-base text-slate-600 leading-relaxed max-w-3xl mx-auto">
              AI agents don't operate in isolation. A seemingly harmless change can trigger downstream actions across orders, inventory, finance, and customer communications. Cascade predicts those consequences before execution.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Feature Card 1 - Trace impact */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-2">Trace impact</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Discover cascading effects across connected agents and systems.
                </p>
              </div>
            </div>

            {/* Feature Card 2 - Prevent risky actions */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-2">Prevent risky actions</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Evaluate business rules and risk before an action proceeds.
                </p>
              </div>
            </div>

            {/* Feature Card 3 - Keep control */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-2">Keep control</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Require approvals where necessary and maintain an audit trail.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value Propositions */}
      <section className="max-w-[1280px] mx-auto w-full px-4 md:px-6 lg:px-8 border-t border-slate-200 py-12">
        <div className="grid gap-8 grid-cols-1 md:grid-cols-3">
          <div>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
              <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-slate-900">Deterministic simulation</h3>
            <p className="text-sm leading-relaxed text-slate-600">
              Same input always produces the same consequence graph. No guessing, no hallucination.
            </p>
          </div>

          <div>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
              <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-slate-900">Full blast radius</h3>
            <p className="text-sm leading-relaxed text-slate-600">
              Money out, affected agents, downstream actions, reversibility, and customer impact.
            </p>
          </div>

          <div>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
              <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-slate-900">Policy-driven decisions</h3>
            <p className="text-sm leading-relaxed text-slate-600">
              Auto-approve, block, or require human approval based on configurable risk thresholds.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Links */}
      <section className="max-w-[1280px] mx-auto w-full px-4 md:px-6 lg:px-8 border-t border-slate-200 py-10 pb-16">
        <div className="text-center">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Explore Cascade</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/dashboard"
              className="w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors min-h-[44px] inline-flex items-center justify-center"
            >
              View Dashboard
            </Link>
            <Link
              to="/agents"
              className="w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors min-h-[44px] inline-flex items-center justify-center"
            >
              Agents & Rules
            </Link>
            <Link
              to="/audit"
              className="w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors min-h-[44px] inline-flex items-center justify-center"
            >
              Audit Log
            </Link>
          </div>
        </div>
      </section>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        
        @media (prefers-reduced-motion: reduce) {
          * {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
