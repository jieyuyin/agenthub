import fs from 'fs'
import path from 'path'

export function getWorkspaceRuntimePath(workspaceId: string) {
  const base = path.resolve(process.cwd(), 'runtimes', workspaceId)
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })
  return base
}

export function resolveWorkspaceFilePath(workspaceId: string, filepath: string) {
  const root = getWorkspaceRuntimePath(workspaceId)
  const normalized = path.normalize(filepath).replace(/^(\.\.(\/|\\|$))+/, '')
  const full = path.resolve(root, normalized)
  if (!full.startsWith(root)) {
    throw new Error('Path escapes workspace root')
  }
  return full
}

export async function readWorkspaceFile(workspaceId: string, filepath: string) {
  const full = resolveWorkspaceFilePath(workspaceId, filepath)
  if (!fs.existsSync(full)) {
    throw new Error(`File not found: ${filepath}`)
  }
  return fs.readFileSync(full, 'utf-8')
}

export async function writeWorkspaceFile(workspaceId: string, filepath: string, content: string) {
  const full = resolveWorkspaceFilePath(workspaceId, filepath)
  const dir = path.dirname(full)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
}
