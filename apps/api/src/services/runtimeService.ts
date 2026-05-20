import path from 'path'
import fs from 'fs'
import prisma from './prisma'
import type { Runtime, RuntimeExecResult } from '@agenthub/shared'
import * as observabilityService from './observabilityService'

export interface RuntimeExecMeta {
  taskId?: string
  stepIndex?: number
}

const managers = new Map<string, any>()

function getHostPortFromPreview(url?: string) {
  if (!url) return 30000
  const match = url.match(/:(\d+)(?:\/|$)/)
  return match ? Number(match[1]) : 30000
}

function getWorkspaceRuntimePath(workspaceId: string) {
  const base = path.resolve(process.cwd(), 'runtimes', workspaceId)
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })
  return base
}

function normalizeRuntimeRecord(runtime: any): Runtime {
  return {
    ...runtime,
    exposedPorts: runtime.exposedPorts
      ? runtime.exposedPorts.split(',').map((port: string) => Number(port))
      : [],
    resources: runtime.resources ? JSON.parse(runtime.resources) : undefined
  }
}

async function getOrCreateManager(runtime: any) {
  const normalizedRuntime = normalizeRuntimeRecord(runtime)
  if (managers.has(normalizedRuntime.id)) return managers.get(normalizedRuntime.id)
  const mod = await import('@agenthub/agent-runtime')
  const DockerRuntimeManager = (mod as any).DockerRuntimeManager
  const manager = new DockerRuntimeManager(getWorkspaceRuntimePath(normalizedRuntime.workspaceId))
  const hostPort = getHostPortFromPreview(normalizedRuntime.previewUrl)
  manager.registerRuntime(normalizedRuntime, hostPort)
  managers.set(normalizedRuntime.id, manager)
  return manager
}

export async function getRuntimeByWorkspace(workspaceId: string) {
  return prisma.runtime.findUnique({ where: { workspaceId } })
}

export async function getRuntimeById(id: string) {
  return prisma.runtime.findUnique({ where: { id } })
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
      exposedPorts: runtime.exposedPorts?.join(',') ?? null,
      filesystemRoot: runtime.filesystemRoot,
      resources: JSON.stringify(runtime.resources)
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

  const manager = await getOrCreateManager(runtime)
  const updated = await manager.start(runtime.id)

  return prisma.runtime.update({
    where: { id: runtime.id },
    data: { status: updated.status, startedAt: updated.startedAt }
  })
}

export async function startRuntimeById(runtimeId: string) {
  const runtime = await getRuntimeById(runtimeId)
  if (!runtime) {
    throw new Error('Runtime not found')
  }

  const manager = await getOrCreateManager(runtime)
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

  const manager = await getOrCreateManager(runtime)
  await manager.stop(runtime.id)

  return prisma.runtime.update({ where: { id: runtime.id }, data: { status: 'stopped' } })
}

export async function stopRuntimeById(runtimeId: string) {
  const runtime = await getRuntimeById(runtimeId)
  if (!runtime) {
    throw new Error('Runtime not found')
  }

  const manager = await getOrCreateManager(runtime)
  await manager.stop(runtime.id)

  return prisma.runtime.update({ where: { id: runtime.id }, data: { status: 'stopped' } })
}

export async function execInRuntimeById(
  runtimeId: string,
  command: string,
  timeout?: number,
  meta?: RuntimeExecMeta
) {
  const runtime = await getRuntimeById(runtimeId)
  if (!runtime) {
    throw new Error('Runtime not found')
  }

  const manager = await getOrCreateManager(runtime)
  const execution = await prisma.execution.create({
    data: {
      runtimeId: runtime.id,
      workspaceId: runtime.workspaceId,
      command,
      status: 'running'
    }
  })

  const started = Date.now()
  try {
    const result: RuntimeExecResult = await manager.exec(runtime.id, command, { timeout })
    const duration = Date.now() - started
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
    await observabilityService.recordRuntimeLog({
      runtimeId: runtime.id,
      taskId: meta?.taskId,
      stepIndex: meta?.stepIndex,
      executionId: execution.id,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      duration,
      status: result.exitCode === 0 ? 'success' : 'failed'
    })
    return { execution, result }
  } catch (error: any) {
    const duration = Date.now() - started
    const errMsg = error?.message || String(error)
    await prisma.execution.update({
      where: { id: execution.id },
      data: {
        status: 'failed',
        stderr: errMsg,
        completedAt: new Date()
      }
    })
    await observabilityService.recordRuntimeLog({
      runtimeId: runtime.id,
      taskId: meta?.taskId,
      stepIndex: meta?.stepIndex,
      executionId: execution.id,
      command,
      stderr: errMsg,
      duration,
      status: 'failed'
    })
    throw error
  }
}

export async function execInRuntime(
  workspaceId: string,
  command: string,
  timeout?: number,
  meta?: RuntimeExecMeta
) {
  const runtime = await getRuntimeByWorkspace(workspaceId)
  if (!runtime) {
    throw new Error('Runtime not created for this workspace')
  }

  return execInRuntimeById(runtime.id, command, timeout, meta)
}
