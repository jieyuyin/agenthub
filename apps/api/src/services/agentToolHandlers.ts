import * as runtimeService from './runtimeService'
import * as patchService from './patchService'
import { readWorkspaceFile, writeWorkspaceFile } from './workspaceFiles'

export interface AgentToolHandlers {
  readFile: (params: { filepath: string }) => Promise<string>
  createPatch: (params: { filepath: string; oldContent: string; newContent: string }) => Promise<{ patchId: string; patch: string }>
  runTerminal: (params: { command: string; timeout?: number }) => Promise<{
    executionId: string
    exitCode: number
    stdout: string
    stderr: string
    success: boolean
  }>
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
  return {
    readFile: async ({ filepath }) => {
      const content = await readWorkspaceFile(ctx.workspaceId, filepath)
      return content
    },

    createPatch: async ({ filepath, oldContent, newContent }) => {
      const diff = buildUnifiedDiff(filepath, oldContent, newContent)
      const patch = await patchService.createPatch({
        taskId: ctx.taskId,
        content: newContent,
        status: 'generated',
        createdBy: ctx.agentId,
        diff
      })
      await writeWorkspaceFile(ctx.workspaceId, filepath, newContent)
      return { patchId: patch.id, patch: diff }
    },

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
    }
  }
}
