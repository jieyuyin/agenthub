import path from 'path'
import fs from 'fs'
import prisma from '../services/prisma'
import type { Runtime, RuntimeExecResult } from '@agenthub/shared'

const managers = new Map<string, any>()

function getHostPortFromPreview(url?: string) {
  if (!url) return 30000
  const match = url?.match(/:(\d+)(?:\/|$)/)
  return match ? Number(match[1]) : 30000
}

function getWorkspaceRuntimePath(workspaceId: string) {
  const base = path.resolve(process.cwd(), 'runtimes', workspaceId)
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })
  return base
}

async function getOrCreateManager(runtime: Runtime) {
  if (managers.has(runtime.id)) return managers.get(runtime.id)
  const mod = await import('@agenthub/agent-runtime')
  const DockerRuntimeManager = (mod as any).DockerRuntimeManager
  const manager = new DockerRuntimeManager(getWorkspaceRuntimePath(runtime.workspaceId))
  manager.registerRuntime(runtime, getHostPortFromPreview(runtime.previewUrl))
  managers.set(runtime.id, manager)
  return manager
}

export async function getRuntimeByWorkspace(workspaceId: string) {
  return prisma.runtime.findUnique({ where: { workspaceId } })
}

export async function createRuntimeForWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`)
  }

  const workspacePath = getWorkspaceRuntimePath(workspaceId)
  const mod = await import('@agenthub/agent-runtime')
  const DockerRuntimeManager = (mod as any).DockerRuntimeManager
  const manager = new DockerRuntimeManager(workspacePath)
  const runtime = await manager.create(workspaceId, workspacePath)
  manager.registerRuntime(runtime, getHostPortFromPreview(runtime.previewUrl))
  managers.set(runtime.id, manager)

  const created = await prisma.runtime.create({
    data: {
      id: runtime.id,
      workspaceId,
      type: runtime.type,
      containerId: runtime.containerId,
      status: runtime.status,
      previewUrl: runtime.previewUrl,
      exposedPorts: runtime.exposedPorts,
      filesystemRoot: runtime.filesystemRoot,
      resources: runtime.resources as any
    }
  })

  await prisma.workspace.update({ where: { id: workspaceId }, data: { runtimeId: created.id } })
  return created
}

export async function startRuntime(workspaceId: string) {
  const runtime = await getRuntimeByWorkspace(workspaceId)
  if (!runtime) {
    throw new Error('Runtime not created for this workspace')
  }

  const manager = await getOrCreateManager(runtime as unknown as Runtime)
  const updated = await manager.start(runtime.id)
  return prisma.runtime.update({
    where: { id: runtime.id },
    data: { status: updated.status, startedAt: updated.startedAt }
  })
}

export async function stopRuntime(workspaceId: string) {
  const runtime = await getRuntimeByWorkspace(workspaceId)
  if (!runtime) {
    throw new Error('Runtime not created for this workspace')
  }

  const manager = await getOrCreateManager(runtime as unknown as Runtime)
  await manager.stop(runtime.id)
  return prisma.runtime.update({ where: { id: runtime.id }, data: { status: 'stopped' } })
}

export async function execInRuntime(workspaceId: string, command: string, timeout?: number) {
  const runtime = await getRuntimeByWorkspace(workspaceId)
  if (!runtime) {
    throw new Error('Runtime not created for this workspace')
  }

  const manager = await getOrCreateManager(runtime as unknown as Runtime)
  const execution = await prisma.execution.create({
    data: {
      runtimeId: runtime.id,
      workspaceId,
      command,
      status: 'running'
    }
  })

  try {
    const result: RuntimeExecResult = await manager.exec(runtime.id, command, { timeout })
    await prisma.execution.update({
      where: { id: execution.id },
      data: {
        status: 'completed',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        completedAt: new Date()
      }
    })
    return { executionId: execution.id, result }
  } catch (error: any) {
    await prisma.execution.update({
      where: { id: execution.id },
      data: {
        status: 'failed',
        stderr: error?.message ?? String(error),
        completedAt: new Date()
      }
    })
    throw error
  }
}
