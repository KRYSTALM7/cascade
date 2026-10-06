import { BackendStatus } from "./components/BackendStatus";

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cascade</h1>
          <p className="text-slate-400">What happens if we allow this action?</p>
        </div>
        <BackendStatus />
      </header>
      <section className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-500">
        Action simulation arrives in Phase 7.
      </section>
    </main>
  );
}
