import { createAgent } from 'langchain'
import type { RuntimeToolHandlers } from './runtime-tools'
import { createRuntimeTools } from './runtime-tools'

export interface LangChainAgentConfig {
  openAIApiKey: string
  model?: string
  temperature?: number
}

export async function createAgentExecutor(config: LangChainAgentConfig, handlers: RuntimeToolHandlers): Promise<any> {
  const tools = createRuntimeTools(handlers)

  const agent = createAgent({
    model: config.model ?? 'openai:gpt-4o-mini',
    tools,
    // Optionally provide a system prompt or responseFormat here.
  })

  return agent
}
