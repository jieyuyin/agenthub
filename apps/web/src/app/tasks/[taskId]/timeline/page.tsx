'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { Route } from 'next'
import { fetchJson } from '@/lib/api'
import type { TaskTimeline } from '@/lib/timeline'
import { ExecutionTimeline } from '@/components/timeline/ExecutionTimeline'

const POLL_MS = 3000

export default function TaskTimelinePage() {
  const params = useParams()
  const taskId = typeof params.taskId === 'string' ? params.taskId : ''
  const [timeline, setTimeline] = useState<TaskTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!taskId) return
    try {
      const res = await fetchJson<{ data: TaskTimeline }>(`/tasks/${taskId}/timeline`)
      setTimeline(res.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useEffect(() => {
    if (!timeline) return
    const active = timeline.task.status === 'pending' || timeline.task.status === 'in_progress'
    if (!active) return
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [timeline?.task.status, load])

  if (!taskId) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <p>Invalid task id</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link href={'/tasks' as Route} className="text-slate-400 hover:text-slate-200 text-sm">
            ← Tasks
          </Link>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              load()
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>

        {loading && !timeline && (
          <p className="text-slate-400">Loading execution timeline…</p>
        )}

        {error && (
          <div className="rounded-2xl border border-red-900 bg-red-950/30 p-6 text-red-300">
            {error}
            <p className="mt-2 text-sm text-slate-500">
              Ensure API is running on port 3003 and task id exists.
            </p>
          </div>
        )}

        {timeline && <ExecutionTimeline timeline={timeline} />}

        {timeline &&
          (timeline.task.status === 'pending' || timeline.task.status === 'in_progress') && (
            <p className="mt-6 text-center text-xs text-slate-500 animate-pulse">
              Task running — timeline auto-refreshes every {POLL_MS / 1000}s
            </p>
          )}
      </div>
    </main>
  )
}
