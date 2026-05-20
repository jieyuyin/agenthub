'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'

export default function TasksIndexPage() {
  const router = useRouter()
  const [taskId, setTaskId] = useState('')

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-lg">
        <Link href={'/' as Route} className="text-slate-400 hover:text-slate-200 text-sm">
          ← Home
        </Link>
        <h1 className="mt-6 text-3xl font-semibold">Execution Timeline</h1>
        <p className="mt-2 text-slate-400 text-sm">
          Open a task&apos;s unified timeline: agent steps, tool calls, and runtime logs.
        </p>

        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const id = taskId.trim()
            if (id) router.push(`/tasks/${id}/timeline` as Route)
          }}
        >
          <label className="block text-sm text-slate-400">Task ID</label>
          <input
            type="text"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            placeholder="cuid from POST /api/tasks"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder:text-slate-600 focus:border-violet-600 focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-violet-600 py-3 font-medium text-white hover:bg-violet-500 transition-colors"
          >
            View timeline
          </button>
        </form>
      </div>
    </main>
  )
}
