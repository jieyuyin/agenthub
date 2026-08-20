'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Agent, AgentExecution } from '@agenthub/shared';

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAgents() {
      try {
        const [agentsResponse, executionsResponse] = await Promise.all([
          fetch('http://localhost:3003/api/agents'),
          fetch('http://localhost:3003/api/agent-executions')
        ]);

        const agentsData = await agentsResponse.json();
        const executionsData = await executionsResponse.json();

        setAgents(agentsData.agents);
        setExecutions(executionsData.executions);
      } catch (error) {
        console.error('Failed to fetch agents:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAgents();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'idle': return 'text-green-400';
      case 'busy': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      case 'paused': return 'text-gray-400';
      default: return 'text-slate-400';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'pm': return '👔';
      case 'frontend': return '🎨';
      case 'backend': return '⚙️';
      default: return '🤖';
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="mx-auto max-w-6xl">
          <p>Loading agents...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <Link href="/" className="text-slate-400 hover:text-slate-200">
            ← Back to Home
          </Link>
        </div>

        <h1 className="text-4xl font-semibold mb-8">Agent Collaboration</h1>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-12">
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{getRoleIcon(agent.role)}</span>
                  <div>
                    <h3 className="text-xl font-semibold">{agent.name}</h3>
                    <p className="text-sm text-slate-400 capitalize">{agent.role} Agent</p>
                  </div>
                </div>
                <div className={`text-sm font-medium ${getStatusColor(agent.status)}`}>
                  {agent.status.toUpperCase()}
                </div>
              </div>

              <div className="space-y-2 text-sm text-slate-400">
                <p>Model: {agent.model}</p>
                <p>Version: {agent.version}</p>
                <p>Tools: {agent.tools.length}</p>
                {agent.lastActivityAt && (
                  <p>Last Activity: {new Date(agent.lastActivityAt).toLocaleString()}</p>
                )}
              </div>

              <div className="mt-4">
                <div className="text-xs text-slate-500 mb-1">System Prompt Preview</div>
                <p className="text-sm text-slate-300 line-clamp-2">
                  {agent.systemPrompt.substring(0, 100)}...
                </p>
              </div>
            </div>
          ))}
        </div>

        <h2 className="text-2xl font-semibold mb-6">Recent Executions</h2>
        <div className="space-y-4">
          {executions.length === 0 ? (
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-10 text-center">
              <p className="text-slate-400">No recent executions</p>
            </div>
          ) : (
            executions.slice(0, 10).map((execution) => {
              const agent = agents.find(a => a.id === execution.agentId);
              return (
                <div key={execution.id} className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{agent ? getRoleIcon(agent.role) : '🤖'}</span>
                      <div>
                        <h3 className="text-lg font-semibold">
                          {agent?.name || 'Unknown Agent'}
                        </h3>
                        <p className="text-sm text-slate-400">
                          Task: {execution.taskId}
                        </p>
                      </div>
                    </div>
                    <div className={`text-sm font-medium ${getStatusColor(execution.status)}`}>
                      {execution.status.toUpperCase()}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm text-slate-400">
                    <div>
                      <span className="text-slate-500">Started:</span>
                      <br />
                      {new Date(execution.startedAt).toLocaleString()}
                    </div>
                    {execution.completedAt && (
                      <div>
                        <span className="text-slate-500">Completed:</span>
                        <br />
                        {new Date(execution.completedAt).toLocaleString()}
                      </div>
                    )}
                  </div>

                  {execution.error && (
                    <div className="mt-4 p-3 bg-red-900/20 border border-red-800 rounded-lg">
                      <p className="text-sm text-red-400">
                        <strong>Error:</strong> {execution.error}
                      </p>
                    </div>
                  )}

                  {execution.logs.length > 0 && (
                    <div className="mt-4">
                      <details className="text-sm">
                        <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                          View Logs ({execution.logs.length} entries)
                        </summary>
                        <div className="mt-2 max-h-32 overflow-y-auto bg-slate-800 p-3 rounded">
                          {execution.logs.map((log, index) => (
                            <div key={index} className="text-xs text-slate-300 font-mono">
                              {log}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}