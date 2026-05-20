'use client'

import { useMemo, useState } from 'react'
import type { TaskTimeline, TimelineFilter, TimelineEvent } from '@/lib/timeline'
import { FILTER_OPTIONS, matchesFilter } from '@/lib/timeline'
import { TimelineEventRow } from './TimelineEventRow'

type ViewMode = 'grouped' | 'flat'

export function ExecutionTimeline({ timeline }: { timeline: TaskTimeline }) {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')

  const flatEvents = useMemo(
    () => timeline.events.filter((e) => matchesFilter(e, filter)),
    [timeline.events, filter]
  )

  const groupedSteps = useMemo(() => {
    return timeline.steps
      .map((step) => {
        const reasoning =
          step.reasoning && matchesFilter(step.reasoning, filter) ? step.reasoning : null
        const children = step.children.filter((c) => matchesFilter(c, filter))
        if (!reasoning && children.length === 0) return null
        return { ...step, reasoning, children }
      })
      .filter(Boolean) as Array<{
      stepIndex: number
      timestamp: string
      reasoning: TimelineEvent | null
      children: TimelineEvent[]
    }>
  }, [timeline.steps, filter])

  const statusColor =
    timeline.task.status === 'completed'
      ? 'text-green-400'
      : timeline.task.status === 'in_progress'
        ? 'text-yellow-400'
        : timeline.task.status === 'blocked'
          ? 'text-red-400'
          : 'text-slate-400'

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-56 shrink-0 space-y-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-slate-300">Task</h2>
          <p className="mt-2 font-medium">{timeline.task.title}</p>
          <p className={`mt-2 text-sm font-medium uppercase ${statusColor}`}>
            {timeline.task.status}
          </p>
          <p className="mt-3 text-xs text-slate-500 line-clamp-3">{timeline.task.description}</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Filter</h2>
          <div className="space-y-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  filter === opt.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">View</h2>
          <div className="flex flex-col gap-1">
            {(
              [
                ['grouped', 'By agent step'],
                ['flat', 'By time']
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  viewMode === mode
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Execution Timeline</h2>
          <span className="text-sm text-slate-500">
            {flatEvents.length} event{flatEvents.length === 1 ? '' : 's'}
          </span>
        </div>

        {flatEvents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-12 text-center text-slate-500">
            No events for this filter. Run a task or change filters.
          </div>
        ) : viewMode === 'flat' ? (
          <div className="relative space-y-3">
            <div className="absolute left-[1.15rem] top-2 bottom-2 w-px bg-slate-700" aria-hidden />
            {flatEvents.map((event) => (
              <div key={event.id} className="relative pl-10">
                <span
                  className="absolute left-3 top-4 h-2.5 w-2.5 rounded-full bg-slate-600 ring-4 ring-slate-950"
                  aria-hidden
                />
                <TimelineEventRow event={event} />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {groupedSteps.map((step) => (
              <div key={step.stepIndex} className="relative">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-900/50 text-sm font-semibold text-violet-200 ring-2 ring-violet-800">
                    {step.stepIndex + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-200">Agent Step {step.stepIndex + 1}</h3>
                    <p className="text-xs text-slate-500">
                      {new Date(step.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="ml-4 space-y-3 border-l-2 border-slate-800 pl-6">
                  {step.reasoning && (
                    <TimelineEventRow event={step.reasoning as TimelineEvent} nested />
                  )}
                  {step.children.map((child) => (
                    <TimelineEventRow key={child.id} event={child} nested />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
