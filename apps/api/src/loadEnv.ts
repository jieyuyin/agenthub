import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(apiRoot, '../..')

const candidates = [
  path.join(apiRoot, '.env'),
  path.join(apiRoot, '.env.local'),
  path.join(repoRoot, '.env'),
  path.join(repoRoot, '.env.local')
]

export const loadedEnvFiles: string[] = []

const hasApiEnv = fs.existsSync(path.join(apiRoot, '.env'))

for (const file of candidates) {
  if (!fs.existsSync(file)) continue
  // Later files override earlier; do not let repo .env override apps/api/.env
  dotenv.config({ path: file, override: loadedEnvFiles.length > 0 })
  loadedEnvFiles.push(file)
}

// Only if apps/api/.env is missing entirely
if (
  !hasApiEnv &&
  !process.env.LOCAL_AI_BASE &&
  !process.env.OPENAI_API_KEY &&
  !process.env.AI_API_KEY
) {
  const examplePath = path.join(apiRoot, '.env.example')
  if (fs.existsSync(examplePath)) {
    dotenv.config({ path: examplePath, override: false })
    loadedEnvFiles.push(`${examplePath} (fallback)`)
    console.warn(
      '[loadEnv] 未找到 apps/api/.env，已临时使用 .env.example。请执行: copy .env.example .env'
    )
  }
}
