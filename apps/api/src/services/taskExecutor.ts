import OpenAI from 'openai'
import * as taskService from './taskService'
import * as agentExecutionService from './agentExecutionService'
import * as observabilityService from './observabilityService'
import { createAgentToolHandlers, type AgentToolHandlers } from './agentToolHandlers'
import { createChatCompletion } from './aiService'
import { addToolContext, updateTaskState } from './contextEngineService'
import { DiagnosticWorkflow } from './diagnosticWorkflow'
import { ComplexityEvaluator, ContextManager, SubagentScheduler } from '@agenthub/agent-runtime/dist/coding-worker'

const MAX_TOOL_ROUNDS = 24
const MAX_TERMINAL_FAILURE_RETRIES = 3

const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search relevant project files without loading the whole repository.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] }
    }
  },
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
      name: 'write_file',
      description: 'Create or replace a file in the workspace.',
      parameters: { type: 'object', properties: { filepath: { type: 'string' }, content: { type: 'string' } }, required: ['filepath', 'content'] }
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
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Return the current workspace Git diff.',
      parameters: { type: 'object', properties: {} }
    }
  }
]

const SYSTEM_PROMPT = `You are an autonomous coding agent in an isolated Docker runtime.
You may ONLY use these tools: search_code, read_file, write_file, create_patch, run_terminal, git_diff.
Plan briefly, read files as needed, patch code, run commands to verify.
Dynamically discover only relevant code instead of loading the whole repository.
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
      case 'search_code':
        result = await handlers.searchCode({ query: String(args.query), path: args.path ? String(args.path) : undefined, maxResults: args.maxResults ? Number(args.maxResults) : undefined })
        break
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
      case 'write_file':
        result = await handlers.writeFile({ filepath: String(args.filepath), content: String(args.content) })
        break
      case 'run_terminal':
        result = await handlers.runTerminal({
          command: String(args.command),
          timeout: args.timeout != null ? Number(args.timeout) : undefined
        })
        break
      case 'git_diff':
        result = await handlers.gitDiff()
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
    return false
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
  updateTaskState({ projectId: workspace.id, goal: task.title, phase: 'execution', status: 'running', nextStep: execution.title })
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
  const workerContext = new ContextManager({
    goal: task.title,
    constraints: ['Work only inside the workspace', 'Do not claim completion without verification'],
    acceptanceCriteria: ['Requested change is implemented', 'Relevant verification succeeds'],
    background: task.description
  })
  const complexityEvaluator = new ComplexityEvaluator()
  const subagentScheduler = new SubagentScheduler(async ({ kind, reason, context }) => {
    const specialist = await createChatCompletion({
      model: process.env.LOCAL_AI_MODEL || process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a read-only ${kind} subagent. Analyze the supplied coding-worker state. Return concise findings and a recommended next action. Do not claim that you changed files.` },
        { role: 'user', content: `Reason: ${reason}\n\nState:\n${JSON.stringify(context).slice(0, 24_000)}` }
      ]
    })
    return specialist.choices?.[0]?.message?.content ?? 'Subagent returned no findings.'
  })
  const usedSubagents = new Set<string>()

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
  const diagnostic = new DiagnosticWorkflow(`${agentId} ${task.title}\n${task.description}`)

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
        messages,
        tools: AGENT_TOOLS
      })

      const choice = completion.choices?.[0]?.message
      if (!choice) break

      if (!choice.tool_calls?.length) {
        await observabilityService.recordAgentTrace({
          taskId: task.id,
          stepIndex: round,
          prompt: promptSnapshot,
          reasoning: choice.content ?? null,
          result: choice.content ?? null
        })
        const required = diagnostic.nextRequiredInstruction()
        if (required) {
          messages.push({ role: 'assistant', content: choice.content ?? '继续完成诊断。' })
          messages.push({ role: 'system', content: required })
          continue
        }
        const completionAssessment = complexityEvaluator.assess(workerContext, 0.2)
        const reviewKind = subagentScheduler.select(completionAssessment, workerContext, true)
        if (reviewKind && !usedSubagents.has(reviewKind)) {
          usedSubagents.add(reviewKind)
          const review = await subagentScheduler.run(reviewKind, completionAssessment, workerContext)
          messages.push({ role: 'assistant', content: choice.content ?? 'Implementation complete; requesting specialist review.' })
          messages.push({ role: 'system', content: `${reviewKind} subagent findings:\n${String(review)}\nAddress material findings, then verify again.` })
          continue
        }
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
        workerContext.record({
          tool: fn.name,
          input: parsed,
          output: result,
          success: !(fn.name === 'run_terminal' && result && typeof result === 'object' && 'success' in result && !(result as any).success),
          durationMs: 0,
          createdAt: new Date().toISOString()
        })
        diagnostic.afterTool(fn.name, result)
        addToolContext({
          projectId: workspace.id,
          conversationId: task.conversationId,
          tool: fn.name,
          summary: JSON.stringify(result).slice(0, 4000)
        })
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

      const uncertainty = terminalFailed ? Math.min(1, 0.45 + terminalFailureRetries * 0.2) : 0.2
      const assessment = complexityEvaluator.assess(workerContext, uncertainty)
      const subagentKind = subagentScheduler.select(assessment, workerContext, false)
      if (subagentKind && !usedSubagents.has(subagentKind)) {
        usedSubagents.add(subagentKind)
        const findings = await subagentScheduler.run(subagentKind, assessment, workerContext)
        messages.push({ role: 'system', content: `${subagentKind} subagent findings:\n${String(findings)}\nUse these findings as advice; you remain responsible for the next action.` })
      }

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
          return false
        }
        messages.push({
          role: 'user',
          content: `Command failed (attempt ${terminalFailureRetries}/${MAX_TERMINAL_FAILURE_RETRIES}). exitCode=${lastTerminalResult.exitCode}\nstderr:\n${lastTerminalResult.stderr}\nstdout:\n${lastTerminalResult.stdout}\nRe-plan: read files, create_patch to fix, then run_terminal again.`
        })
      }
    }

    if (completed) {
      updateTaskState({ projectId: workspace.id, goal: task.title, phase: 'verification', status: 'completed', nextStep: '由 Project Assistant 汇总结果' })
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
  } catch (error: any) {
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
