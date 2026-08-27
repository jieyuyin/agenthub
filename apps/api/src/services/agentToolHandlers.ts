import * as runtimeService from './runtimeService'
import * as patchService from './patchService'
import { readWorkspaceFile, writeWorkspaceFile } from './workspaceFiles'
import fs from 'fs'
import path from 'path'
import { getWorkspaceRuntimePath, resolveWorkspaceFilePath } from './workspaceFiles'

export interface AgentToolHandlers {
  searchCode: (params: { query: string; path?: string; maxResults?: number }) => Promise<Array<{ filepath: string; line: number; text: string }>>
  readFile: (params: { filepath: string }) => Promise<string>
  writeFile: (params: { filepath: string; content: string }) => Promise<{ filepath: string; bytes: number }>
  applyPatch: (params: { filepath: string; oldContent: string; newContent: string }) => Promise<{ patchId: string; patch: string }>
  createPatch: (params: { filepath: string; oldContent: string; newContent: string }) => Promise<{ patchId: string; patch: string }>
  runTerminal: (params: { command: string; timeout?: number }) => Promise<{
    executionId: string
    exitCode: number
    stdout: string
    stderr: string
    success: boolean
  }>
  gitDiff: () => Promise<{ diff: string }>
}

export interface AgentToolContext {
  taskId: string
  workspaceId: string
  runtimeId: string
  agentId: string
  stepIndex: number
}

function buildUnifiedDiff(filepath: string, oldContent: string, newContent: string) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const hunk: string[] = [`--- a/${filepath}`, `+++ b/${filepath}`, `@@`]
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max; i++) {
    const o = oldLines[i]
    const n = newLines[i]
    if (o === n) continue
    if (o !== undefined) hunk.push(`-${o}`)
    if (n !== undefined) hunk.push(`+${n}`)
  }
  return hunk.join('\n')
}

export function createAgentToolHandlers(ctx: AgentToolContext): AgentToolHandlers {
  const applyPatch = async ({ filepath, oldContent, newContent }: { filepath: string; oldContent: string; newContent: string }) => {
    const current = await readWorkspaceFile(ctx.workspaceId, filepath)
    if (current !== oldContent) throw new Error(`Patch conflict: ${filepath} changed since it was read`)
    const diff = buildUnifiedDiff(filepath, oldContent, newContent)
    const patch = await patchService.createPatch({ taskId: ctx.taskId, content: newContent, status: 'generated', createdBy: ctx.agentId, diff })
    await writeWorkspaceFile(ctx.workspaceId, filepath, newContent)
    return { patchId: patch.id, patch: diff }
  }
  return {
    searchCode: async ({ query, path: relativePath = '.', maxResults = 100 }) => {
      const root = getWorkspaceRuntimePath(ctx.workspaceId)
      const start = resolveWorkspaceFilePath(ctx.workspaceId, relativePath)
      const results: Array<{ filepath: string; line: number; text: string }> = []
      const visit = (target: string) => {
        if (results.length >= Math.min(maxResults, 500)) return
        const stat = fs.statSync(target)
        if (stat.isDirectory()) {
          for (const entry of fs.readdirSync(target)) {
            if (['.git', 'node_modules', 'dist', 'build'].includes(entry)) continue
            visit(path.join(target, entry))
          }
          return
        }
        if (stat.size > 1_000_000) return
        let content = ''
        try { content = fs.readFileSync(target, 'utf8') } catch { return }
        content.split(/\r?\n/).forEach((text, index) => {
          if (results.length < maxResults && text.toLowerCase().includes(query.toLowerCase())) {
            results.push({ filepath: path.relative(root, target).replace(/\\/g, '/'), line: index + 1, text: text.slice(0, 500) })
          }
        })
      }
      visit(start)
      return results
    },
    readFile: async ({ filepath }) => {
      const content = await readWorkspaceFile(ctx.workspaceId, filepath)
      return content
    },
    writeFile: async ({ filepath, content }) => { await writeWorkspaceFile(ctx.workspaceId, filepath, content); return { filepath, bytes: Buffer.byteLength(content) } },
    applyPatch,
    createPatch: applyPatch,

    runTerminal: async ({ command, timeout }) => {
      const { execution, result } = await runtimeService.execInRuntimeById(ctx.runtimeId, command, timeout, {
        taskId: ctx.taskId,
        stepIndex: ctx.stepIndex
      })
      return {
        executionId: execution.id,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        success: result.exitCode === 0
      }
    },
    gitDiff: async () => {
      const { result } = await runtimeService.execInRuntimeById(ctx.runtimeId, 'git diff --no-ext-diff -- .', 30_000, { taskId: ctx.taskId, stepIndex: ctx.stepIndex })
      if (result.exitCode !== 0) throw new Error(result.stderr || 'git diff failed')
      return { diff: result.stdout }
    }
  }
}
