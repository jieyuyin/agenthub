import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type ModelProvider = 'dashscope' | 'openai-compatible' | 'ollama' | 'mockllm'

export type ModelConfig = {
  id: string
  name: string
  provider: ModelProvider
  baseUrl: string
  modelId: string
  apiKey?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type ModelConfigInput = Pick<ModelConfig, 'provider' | 'baseUrl' | 'modelId'> & {
  name?: string
  apiKey?: string
}

const dataDir = path.resolve(process.cwd(), 'data')
const dataFile = path.join(dataDir, 'model-configs.json')

function readConfigs(): ModelConfig[] {
  try {
    return JSON.parse(readFileSync(dataFile, 'utf8')) as ModelConfig[]
  } catch {
    return []
  }
}

function writeConfigs(configs: ModelConfig[]) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(dataFile, JSON.stringify(configs, null, 2), { mode: 0o600 })
}

function publicConfig(config: ModelConfig) {
  return {
    ...config,
    apiKey: undefined,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyHint: config.apiKey ? `••••${config.apiKey.slice(-4)}` : ''
  }
}

export function listModelConfigs() {
  return readConfigs().map(publicConfig)
}

export function getActiveModelConfig() {
  return readConfigs().find((config) => config.active)
}

export function saveModelConfig(input: ModelConfigInput) {
  const configs = readConfigs()
  const now = new Date().toISOString()
  const config: ModelConfig = {
    id: randomUUID(),
    name: input.modelId.trim(),
    provider: input.provider,
    baseUrl: input.baseUrl.trim().replace(/\/$/, ''),
    modelId: input.modelId.trim(),
    apiKey: input.apiKey?.trim() || undefined,
    active: configs.length === 0,
    createdAt: now,
    updatedAt: now
  }
  writeConfigs([...configs, config])
  return publicConfig(config)
}

export function activateModelConfig(id: string) {
  const configs = readConfigs()
  const target = configs.find((config) => config.id === id)
  if (!target) return null
  const updated = configs.map((config) => ({ ...config, active: config.id === id, updatedAt: config.id === id ? new Date().toISOString() : config.updatedAt }))
  writeConfigs(updated)
  return publicConfig(updated.find((config) => config.id === id)!)
}

export function deleteModelConfig(id: string) {
  const configs = readConfigs()
  const target = configs.find((config) => config.id === id)
  if (!target) return false
  const remaining = configs.filter((config) => config.id !== id)
  if (target.active && remaining[0]) remaining[0].active = true
  writeConfigs(remaining)
  return true
}
