import OpenAI from 'openai'
import * as taskService from './taskService'
import * as agentExecutionService from './agentExecutionService'
import * as observabilityService from './observabilityService'
import { createAgentToolHandlers, type AgentToolHandlers } from './agentToolHandlers'
import { createChatCompletion } from './aiService'

const MAX_TOOL_ROUNDS = 24
const MAX_TERMINAL_FAILURE_RETRIES = 3

const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the current contents of a file in the workspace runtime.',
      parameters: {
        type: 'object',
        properties: { filepath: { type: 'string', description: 'Path relative to workspace root' } },
        required: ['filepath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_patch',
      description: 'Update a file by providing old and new full contents.',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string' },
          oldContent: { type: 'string' },
          newContent: { type: 'string' }
        },
        required: ['filepath', 'oldContent', 'newContent']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description: 'Execute a shell command in the isolated runtime container.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        },
        required: ['command']
      }
    }
  }
]

const SYSTEM_PROMPT = `You are an autonomous coding agent in an isolated Docker runtime.
You may ONLY use these tools: read_file, run_terminal, create_patch.
Plan briefly, read files as needed, patch code, run commands to verify.
When run_terminal returns success:false, analyze stderr, fix with create_patch, and retry the command.`

async function dispatchTool(
  taskId: string,
  stepIndex: number,
  name: string,
  args: Record<string, unknown>,
  handlers: AgentToolHandlers
): Promise<unknown> {
  const started = Date.now()
  try {
    let result: unknown
    switch (name) {
      case 'read_file':
        result = await handlers.readFile({ filepath: String(args.filepath) })
        break
      case 'create_patch':
        result = await handlers.createPatch({
          filepath: String(args.filepath),
          oldContent: String(args.oldContent),
          newContent: String(args.newContent)
        })
        break
      case 'run_terminal':
        result = await handlers.runTerminal({
          command: String(args.command),
          timeout: args.timeout != null ? Number(args.timeout) : undefined
        })
        break
      default:
        throw new Error(`Tool not allowed: ${name}`)
    }
    await observabilityService.recordToolExecution({
      taskId,
      stepIndex,
      toolName: name,
      input: args,
      output: result,
      status: 'success',
      duration: Date.now() - started
    })
    return result
  } catch (error: any) {
    await observabilityService.recordToolExecution({
      taskId,
      stepIndex,
      toolName: name,
      input: args,
      status: 'failed',
      error: error?.message ?? String(error),
      duration: Date.now() - started
    })
    throw error
  }
}

export async function runAgentExecution(executionId: string): Promise<boolean> {
  const execution = await agentExecutionService.getAgentExecutionById(executionId)
  if (!execution) {
    console.error(`[taskExecutor] execution ${executionId} not found`)
    return false
  }

  const task = await taskService.getTaskById(execution.taskId)
  if (!task) {
    console.error(`[taskExecutor] task ${execution.taskId} not found`)
    return
  }

  const workspace = task.conversation?.workspace
  const runtimeId = workspace?.runtimeId ?? workspace?.runtime?.id
  if (!workspace || !runtimeId) {
    console.error(`[taskExecutor] task ${task.id}: workspace or runtime missing`)
    await agentExecutionService.updateAgentExecutionStatus({
      id: executionId,
      status: 'failed',
      error: 'Workspace or runtime missing',
      completedAt: new Date()
    })
    return false
  }

  await taskService.updateTaskStatus(task.id, 'running', { startedAt: new Date() })
  await agentExecutionService.updateAgentExecutionStatus({
    id: executionId,
    status: 'running',
    startedAt: new Date()
  })

  const agentId = execution.agentId ?? task.assignedAgentId ?? 'agent-executor'
  const toolCtx = {
    taskId: task.id,
    workspaceId: workspace.id,
    runtimeId,
    agentId,
    stepIndex: 0
  }
  const handlers = createAgentToolHandlers(toolCtx)

  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Task: ${task.title}\n\n${task.description}\n\nExecution: ${execution.title}\n\n${JSON.stringify(
        execution.input ?? {}
      )}\n\nRuntime is ready. Use run_terminal to verify changes.`
    }
  ]

  let terminalFailureRetries = 0
  let completed = false

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      toolCtx.stepIndex = round
      const promptSnapshot = messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '[non-text]'
      }))

      const completion: {
        choices?: Array<{ message?: { content?: string; tool_calls?: any[] } }>
      } = await createChatCompletion({
        model: process.env.LOCAL_AI_MODEL || process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages
      })

      const choice = completion.choices?.[0]?.message
      if (!choice) break

      if (!choice.tool_calls?.length) {
        await observabilityService.recordAgentTrace({
          taskId,
          stepIndex: round,
          prompt: promptSnapshot,
          reasoning: choice.content ?? null,
          result: choice.content ?? null
        })
        completed = true
        break
      }

      const toolNames = (choice.tool_calls ?? [])
        .filter((tc: any) => tc.type === 'function')
        .map((tc: any) => tc.function.name)

      messages.push(choice)

      let terminalFailed = false
      let lastTerminalResult: { exitCode: number; stdout: string; stderr: string } | null = null
      const toolResults: Array<{ tool: string; result: unknown }> = []

      for (const toolCall of (choice.tool_calls ?? []) as any[]) {
        if (toolCall.type !== 'function') continue
        const fn = toolCall.function
        let parsed: Record<string, unknown> = {}
        try {
          parsed = JSON.parse(fn.arguments || '{}') as Record<string, unknown>
        } catch {
          parsed = {}
        }

        const result = await dispatchTool(task.id, round, fn.name, parsed, handlers)
        toolResults.push({ tool: fn.name, result })
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        })

        if (fn.name === 'run_terminal' && result && typeof result === 'object' && 'success' in result) {
          const r = result as { success: boolean; exitCode: number; stdout: string; stderr: string }
          if (!r.success) {
            terminalFailed = true
            lastTerminalResult = r
          }
        }
      }

      await observabilityService.recordAgentTrace({
        taskId: task.id,
        stepIndex: round,
        prompt: promptSnapshot,
        reasoning: choice.content ?? null,
        toolSelected: JSON.stringify(toolNames),
        result: toolResults
      })

      if (terminalFailed && lastTerminalResult) {
        terminalFailureRetries += 1
        if (terminalFailureRetries >= MAX_TERMINAL_FAILURE_RETRIES) {
          await agentExecutionService.updateAgentExecutionStatus({
            id: executionId,
            status: 'failed',
            error: `Terminal failed after ${terminalFailureRetries} retries`,
            completedAt: new Date()
          })
          console.error(`[taskExecutor] task ${task.id} failed after ${terminalFailureRetries} terminal failures`)
          return
        }
        messages.push({
          role: 'user',
          content: `Command failed (attempt ${terminalFailureRetries}/${MAX_TERMINAL_FAILURE_RETRIES}). exitCode=${lastTerminalResult.exitCode}\nstderr:\n${lastTerminalResult.stderr}\nstdout:\n${lastTerminalResult.stdout}\nRe-plan: read files, create_patch to fix, then run_terminal again.`
        })
      }
    }

    if (completed) {
      await agentExecutionService.updateAgentExecutionStatus({
        id: executionId,
        status: 'completed',
        output: { result: 'completed' },
        completedAt: new Date()
      })
    } else {
      await agentExecutionService.updateAgentExecutionStatus({
        id: executionId,
        status: 'failed',
        completedAt: new Date()
      })
    }
  } catch (error) {
    console.error(`[taskExecutor] task ${task.id} failed`, error)
    await agentExecutionService.updateAgentExecutionStatus({
      id: executionId,
      status: 'failed',
      error: error?.message ?? String(error),
      completedAt: new Date()
    })
    return false
  }
  return completed
}

export async function runTaskAgent(taskId: string): Promise<void> {
  const task = await taskService.getTaskById(taskId)
  if (!task) {
    console.error(`[taskExecutor] task ${taskId} not found`)
    return
  }

  let assignedAgentIds: string[] | null = null
  if (Array.isArray(task.assignedAgentIds)) {
    assignedAgentIds = task.assignedAgentIds as string[]
  } else if (typeof task.assignedAgentIds === 'string' && task.assignedAgentIds.length > 0) {
    try {
      assignedAgentIds = JSON.parse(task.assignedAgentIds) as string[]
    } catch {
      assignedAgentIds = null
    }
  }
  if (!assignedAgentIds) {
    assignedAgentIds = task.assignedAgentId ? [task.assignedAgentId] : null
  }

  if (!assignedAgentIds || assignedAgentIds.length === 0) {
    console.error(`[taskExecutor] task ${task.id} has no assigned agents`)
    await taskService.updateTaskStatus(task.id, 'blocked', { completedAt: new Date() })
    return
  }

  const executions = await Promise.all(
    assignedAgentIds.map(async (agentId) =>
      agentExecutionService.createAgentExecution({
        taskId: task.id,
        agentId,
        title: `${task.title} — ${agentId}`,
        input: { title: task.title, description: task.description }
      })
    )
  )

  await Promise.all(executions.map((execution) => runAgentExecution(execution.id)))

  const finalExecutions = await agentExecutionService.listAgentExecutionsByTask(task.id)
  const hasFailed = finalExecutions.some((execution) => execution.status === 'failed')
  await taskService.updateTaskStatus(task.id, hasFailed ? 'failed' : 'completed', { completedAt: new Date() })
}
