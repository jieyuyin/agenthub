'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Workspace } from '@agenthub/shared';

export default function WorkspacePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWorkspaces() {
      try {
        const response = await fetch('http://localhost:3003/api/workspaces');
        const data = await response.json();
        setWorkspaces(data.workspaces);
      } catch (error) {
        console.error('Failed to fetch workspaces:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchWorkspaces();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="mx-auto max-w-4xl">
          <p>Loading workspaces...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <Link href="/" className="text-slate-400 hover:text-slate-200">
            ← Back to Home
          </Link>
        </div>

        <h1 className="text-4xl font-semibold mb-8">Workspaces</h1>

        {workspaces.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-10 text-center">
            <h2 className="text-2xl font-semibold mb-4">No workspaces yet</h2>
            <p className="text-slate-400">Create your first workspace to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                <h2 className="text-2xl font-semibold">{workspace.name}</h2>
                <p className="mt-2 text-slate-400">{workspace.description}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-slate-500">
                    Status: {workspace.status}
                  </span>
                  <span className="text-sm text-slate-500">
                    Created: {new Date(workspace.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}