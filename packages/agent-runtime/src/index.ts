import crypto from 'crypto'
import Docker from 'dockerode'
import type { Runtime, RuntimeStatus, RuntimeExecResult, RuntimeManager } from '@agenthub/shared'
export * from './coding-worker.js'

const DEFAULT_IMAGE = 'node:20-alpine'
const DEFAULT_MEMORY = 512 * 1024 * 1024 // 512 MB
const DEFAULT_CPUS = 0.5

interface DockerRuntimeOptions {
  image?: string
  memory?: number
  cpus?: number
  exposedPort?: number
}

interface RuntimeMetadata {
  runtime: Runtime
  hostPort: number
}

export class DockerRuntimeManager implements RuntimeManager {
  private docker: any
  private runtimeMetadata = new Map<string, RuntimeMetadata>()

  constructor(private workspaceRoot: string, docker?: any) {
    this.docker = docker ?? new Docker()
  }

  private generateRuntimeId() {
    return crypto.randomUUID()
  }

  private normalizeRuntimeStatus(state: any): RuntimeStatus {
    if (!state) {
      return 'stopped'
    }
    if (state.Running && !state.Paused) {
      return 'ready'
    }
    if (state.Running && state.Paused) {
      return 'starting'
    }
    if (state.Status === 'exited' || state.Status === 'dead') {
      return 'stopped'
    }
    return 'error'
  }

  public async create(workspaceId: string, workspacePath: string): Promise<Runtime> {
    const hostPort = 30000 + Math.floor(Math.random() * 10000)
    const runtimeId = this.generateRuntimeId()
    const image = DEFAULT_IMAGE
    const containerName = `agenthub-runtime-${runtimeId}`

    const container = await this.docker.createContainer({
      Image: image,
      name: containerName,
      Cmd: ['sh', '-lc', 'while true; do sleep 1; done'],
      Tty: false,
      HostConfig: {
        Binds: [`${workspacePath}:/workspace`],
        PortBindings: {
          '3000/tcp': [{ HostPort: String(hostPort) }]
        },
        Memory: DEFAULT_MEMORY,
        NanoCPUs: Math.floor(DEFAULT_CPUS * 1e9)
      },
      ExposedPorts: {
        '3000/tcp': {}
      }
    })

    const runtime: Runtime = {
      id: runtimeId,
      workspaceId,
      type: 'docker',
      containerId: container.id,
      status: 'starting',
      previewUrl: `http://localhost:${hostPort}`,
      exposedPorts: [3000],
      filesystemRoot: '/workspace',
      resources: {
        memory: '512MB',
        cpus: '0.5'
      },
      createdAt: new Date()
    }

    this.runtimeMetadata.set(runtimeId, { runtime, hostPort })
    return runtime
  }

  public async start(runtimeId: string): Promise<Runtime> {
    const metadata = this.runtimeMetadata.get(runtimeId)
    if (!metadata) {
      throw new Error(`Runtime ${runtimeId} not found`)
    }

    const container = this.docker.getContainer(metadata.runtime.containerId)
    await container.start()
    const inspected = await container.inspect()
    metadata.runtime.status = this.normalizeRuntimeStatus(inspected.State)
    metadata.runtime.startedAt = new Date()
    return metadata.runtime
  }

  public registerRuntime(runtime: Runtime, hostPort: number) {
    this.runtimeMetadata.set(runtime.id, { runtime, hostPort })
  }

  public async stop(runtimeId: string): Promise<void> {
    const metadata = this.runtimeMetadata.get(runtimeId)
    if (!metadata) {
      throw new Error(`Runtime ${runtimeId} not found`)
    }

    const container = this.docker.getContainer(metadata.runtime.containerId)
    await container.stop()
    metadata.runtime.status = 'stopped'
  }

  public async exec(runtimeId: string, command: string, options?: { cwd?: string; timeout?: number }): Promise<RuntimeExecResult> {
    const metadata = this.runtimeMetadata.get(runtimeId)
    if (!metadata) {
      throw new Error(`Runtime ${runtimeId} not found`)
    }

    const container = this.docker.getContainer(metadata.runtime.containerId)
    const exec = await container.exec({
      Cmd: ['sh', '-lc', command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: options?.cwd ?? '/workspace'
    })

    const stream = await exec.start({ hijack: true, stdin: false })
    let stdout = ''
    let stderr = ''

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        stdout += text
      })
      stream.on('end', resolve)
      stream.on('error', reject)
    })

    const inspect = await exec.inspect()
    return {
      exitCode: inspect.ExitCode ?? 0,
      stdout,
      stderr,
      durationMs: options?.timeout ?? 0
    }
  }

  public async getPreviewUrl(runtimeId: string): Promise<string | undefined> {
    const metadata = this.runtimeMetadata.get(runtimeId)
    return metadata?.runtime.previewUrl
  }

  public async getStatus(runtimeId: string): Promise<RuntimeStatus> {
    const metadata = this.runtimeMetadata.get(runtimeId)
    if (!metadata) {
      throw new Error(`Runtime ${runtimeId} not found`)
    }

    const container = this.docker.getContainer(metadata.runtime.containerId)
    const info = await container.inspect()
    metadata.runtime.status = this.normalizeRuntimeStatus(info.State)
    return metadata.runtime.status
  }
}
