import { createAgent } from 'langchain'
import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from '@agenthub/shared'

export interface WorkflowPlanContext {
  workspaceId: string
  currentFiles: string[]
  existingTasks?: string[]
}

const WORKFLOW_PLAN_PROMPT = `You are building a LangGraph-style workflow for a multi-agent development task. Return only valid JSON with nodes and edges. Each node must include: id, name, type, description, agentRole, dependsOn. Edges should represent dependencies between nodes.\n\nTask Description:\n{{taskDescription}}\n\nContext:\n{{context}}`

export async function buildWorkflowGraph(taskDescription: string, context: WorkflowPlanContext, apiKey: string): Promise<WorkflowGraph> {
  const agent = createAgent({
    model: 'openai:gpt-4o-mini',
    tools: [],
    // Use the prompt directly in the messages below
  })

  const response = await agent.invoke({
    messages: [
      { role: 'system', content: WORKFLOW_PLAN_PROMPT },
      { role: 'user', content: `taskDescription: ${taskDescription}\ncontext: ${JSON.stringify(context, null, 2)}` }
    ]
  })

  const normalized = (response as any).content?.trim() ?? '{}'
  return JSON.parse(normalized) as WorkflowGraph
}

function topologicalSort(graph: WorkflowGraph): WorkflowNode[] {
  const nodes = new Map(graph.nodes.map((node: WorkflowNode) => [node.id, { ...node }]))
  const edges: WorkflowEdge[] = graph.edges.slice()
  const inDegree = new Map<string, number>()
  graph.nodes.forEach((node: WorkflowNode) => inDegree.set(node.id, 0))
  edges.forEach((edge: WorkflowEdge) => inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1))

  const queue: WorkflowNode[] = graph.nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0)
  const sorted: WorkflowNode[] = []

  while (queue.length > 0) {
    const node = queue.shift() as WorkflowNode
    sorted.push(node)
    edges
      .filter((edge: WorkflowEdge) => edge.from === node.id)
      .forEach((edge: WorkflowEdge) => {
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) - 1)
        if ((inDegree.get(edge.to) ?? 0) === 0) {
          const next = nodes.get(edge.to)
          if (next) queue.push(next)
        }
      })
  }

  return sorted
}

export async function executeWorkflowGraph(graph: WorkflowGraph, executor: any): Promise<Record<string, any>> {
  const orderedNodes = topologicalSort(graph)
  const results: Record<string, any> = {}

  for (const node of orderedNodes) {
    const prompt = `Execute graph node ${node.id} (${node.name}) using role ${node.agentRole}. Details: ${node.description}. Current results: ${JSON.stringify(results)}.`
    const output = await executor.invoke({ messages: [{ role: 'user', content: prompt }] })
    results[node.id] = output
  }

  return results
}
