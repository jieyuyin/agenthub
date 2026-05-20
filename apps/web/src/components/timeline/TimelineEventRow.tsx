'use client'

import { useState } from 'react'
import type { TimelineEvent } from '@/lib/timeline'
import { JsonBlock } from './JsonBlock'

const TYPE_META: Record<
  TimelineEvent['type'],
  { label: string; icon: string; accent: string; border: string }
> = {
  agent_reasoning: {
    label: 'Agent thinking',
    icon: '🧠',
    accent: 'text-violet-300',
    border: 'border-violet-800/60'
  },
  tool_call: {
    label: 'Tool call',
    icon: '🔧',
    accent: 'text-amber-300',
    border: 'border-amber-800/60'
  },
  runtime_execution: {
    label: 'Runtime execution',
    icon: '▶',
    accent: 'text-cyan-300',
    border: 'border-cyan-800/60'
  }
}

function EventSummary({ event }: { event: TimelineEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString()

  if (event.type === 'agent_reasoning') {
    const tools = event.toolSelected?.length ? event.toolSelected.join(', ') : 'final response'
    return (
      <>
        <span className="text-slate-500">{time}</span>
        <span className="mx-2 text-slate-600">·</span>
        <span>Step {event.stepIndex + 1}</span>
        <span className="mx-2 text-slate-600">·</span>
        <span className="text-slate-400">{event.reasoning ? 'reasoning' : tools}</span>
      </>
    )
  }

  if (event.type === 'tool_call') {
    return (
      <>
        <span className="text-slate-500">{time}</span>
        <span className="mx-2 text-slate-600">·</span>
        <span className="font-mono text-sm">{event.toolName}</span>
        <span className="mx-2 text-slate-600">·</span>
        <span className={event.status === 'success' ? 'text-green-400' : 'text-red-400'}>
          {event.status}
        </span>
        <span className="mx-2 text-slate-600">·</span>
        <span className="text-slate-500">{event.duration}ms</span>
      </>
    )
  }

  return (
    <>
      <span className="text-slate-500">{time}</span>
      <span className="mx-2 text-slate-600">·</span>
      <span className="font-mono text-sm truncate">{event.command}</span>
      <span className="mx-2 text-slate-600">·</span>
      <span className={event.status === 'success' ? 'text-green-400' : 'text-red-400'}>
        exit {event.exitCode ?? '—'}
      </span>
    </>
  )
}

export function TimelineEventRow({
  event,
  nested = false
}: {
  event: TimelineEvent
  nested?: boolean
}) {
  const [open, setOpen] = useState(false)
  const meta = TYPE_META[event.type]

  return (
    <div
      className={`rounded-xl border bg-slate-900/80 ${meta.border} ${nested ? 'ml-6 border-l-2 border-l-slate-700 pl-4' : ''}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-800/50 rounded-xl transition-colors"
      >
        <span className="text-lg leading-none mt-0.5">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium ${meta.accent}`}>{meta.label}</div>
          <div className="mt-1 text-sm text-slate-300 truncate">
            <EventSummary event={event} />
          </div>
        </div>
        <span className="text-slate-500 text-sm shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 px-4 pb-4">
          {event.type === 'agent_reasoning' && (
            <>
              {event.reasoning && <JsonBlock label="Reasoning" value={event.reasoning} />}
              <JsonBlock label="LLM prompt (messages)" value={event.prompt} />
              {event.toolSelected && (
                <JsonBlock label="Tools selected" value={event.toolSelected} />
              )}
              <JsonBlock label="Step result" value={event.result} />
            </>
          )}
          {event.type === 'tool_call' && (
            <>
              <JsonBlock label="Input" value={event.input} />
              <JsonBlock label="Output" value={event.output} />
              {event.error && <JsonBlock label="Error" value={event.error} />}
            </>
          )}
          {event.type === 'runtime_execution' && (
            <>
              <JsonBlock label="Command" value={event.command} />
              <JsonBlock label="stdout" value={event.stdout ?? '(empty)'} />
              <JsonBlock label="stderr" value={event.stderr ?? '(empty)'} />
              <div className="mt-3 flex gap-4 text-xs text-slate-500">
                <span>exitCode: {event.exitCode ?? '—'}</span>
                <span>duration: {event.duration ?? '—'}ms</span>
                {event.executionId && <span>execution: {event.executionId}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
