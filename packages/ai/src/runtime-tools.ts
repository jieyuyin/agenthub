import { tool } from 'langchain'

export interface RuntimeToolHandlers {
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

/** Agent may only use these three tools (minimal closed loop). */
export function createRuntimeTools(handlers: RuntimeToolHandlers): ReturnType<typeof tool>[] {
  return [
    tool(
      async (input: { filepath: string }) => handlers.readFile(input),
      {
        name: 'read_file',
        description: 'Read the current contents of a file in the workspace runtime.'
      }
    ),
    tool(
      async (input: { filepath: string; oldContent: string; newContent: string }) => handlers.createPatch(input),
      {
        name: 'create_patch',
        description: 'Apply a file change: provide old and new full file contents to generate and persist a patch.'
      }
    ),
    tool(
      async (input: { command: string; timeout?: number }) => handlers.runTerminal(input),
      {
        name: 'run_terminal',
        description: 'Execute a shell command in the isolated runtime container. Returns stdout, stderr, and exitCode.'
      }
    )
  ]
}
