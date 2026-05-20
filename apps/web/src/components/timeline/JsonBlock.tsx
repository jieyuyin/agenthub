'use client'

function formatValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = formatValue(value)
  if (!text) return null

  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
        {text}
      </pre>
    </div>
  )
}
