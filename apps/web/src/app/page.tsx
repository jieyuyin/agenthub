import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-4xl rounded-3xl border border-slate-800 bg-slate-900 p-10 shadow-xl shadow-slate-900/20">
        <h1 className="text-4xl font-semibold">AgentHub</h1>
        <p className="mt-4 text-lg leading-8 text-slate-300">
          AI Native Collaboration OS for multi-agent software development.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Link href="/workspace">
            <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6 cursor-pointer hover:bg-slate-900 transition-colors">
              <h2 className="text-2xl font-semibold">Workspace</h2>
              <p className="mt-3 text-sm text-slate-400">Chat, tasks, files, runtime sandbox and deploy.</p>
            </div>
          </Link>
          <Link href="/agents">
            <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6 cursor-pointer hover:bg-slate-900 transition-colors">
              <h2 className="text-2xl font-semibold">Agent Collaboration</h2>
              <p className="mt-3 text-sm text-slate-400">PM, Frontend and Backend agents working together.</p>
            </div>
          </Link>
          <Link href="/chat">
            <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6 cursor-pointer hover:bg-slate-900 transition-colors">
              <h2 className="text-2xl font-semibold">Chat</h2>
              <p className="mt-3 text-sm text-slate-400">Real-time chat with agents (streaming, typing).</p>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
