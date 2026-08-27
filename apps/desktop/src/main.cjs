const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { execFile, spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')

// Keep Chromium cache isolated per desktop process. This avoids Windows cache
// lock/rename failures when a previous Electron process is still shutting down.
const electronCachePath = path.join(app.getPath('temp'), 'agenthub-electron-cache', String(process.pid))
app.setPath('cache', electronCachePath)
app.commandLine.appendSwitch('disk-cache-dir', electronCachePath)

const execFileAsync = promisify(execFile)
let mainWindow
let workspaceRoot = null
let workspaceToken = null
const runningServices = new Map()
const sandboxes = new Map()

const BLOCKED_PARTS = new Set(['.git', 'node_modules', '.next', 'dist', 'build'])
const SERVICE_LOG_LIMIT = 40_000
const SANDBOX_IMAGE = process.env.AGENTHUB_SANDBOX_IMAGE || 'node:22-bookworm'
const SANDBOX_NETWORK = process.env.AGENTHUB_SANDBOX_NETWORK || 'bridge'
const SANDBOX_EXCLUDED = new Set(['node_modules', '.next', 'dist', 'build', 'coverage'])

function sandboxSafe(sandbox, relativePath = '.') {
  if (path.isAbsolute(relativePath)) throw new Error('Sandbox 只允许使用相对路径')
  const normalized = String(relativePath).replaceAll('\\', '/')
  if (normalized.split('/').includes('..')) throw new Error('Sandbox 路径禁止包含 ..')
  const target = path.resolve(sandbox.copyRoot, relativePath)
  if (target !== sandbox.copyRoot && !target.startsWith(`${sandbox.copyRoot}${path.sep}`)) throw new Error('Path escapes Sandbox root')
  return target
}

async function fileDigest(target) {
  try {
    const stat = await fs.stat(target)
    if (!stat.isFile()) return null
    return crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function buildManifest(root) {
  const manifest = new Map()
  async function visit(current) {
    let entries = []
    try { entries = await fs.readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === '.git' || SANDBOX_EXCLUDED.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) manifest.set(path.relative(root, absolute).replaceAll('\\', '/'), await fileDigest(absolute))
    }
  }
  await visit(root)
  return manifest
}

async function docker(args, options = {}) {
  try {
    return await execFileAsync('docker', args, { windowsHide: true, timeout: options.timeout || 180_000, maxBuffer: 4_000_000 })
  } catch (error) {
    throw new Error(String(error?.stderr || error?.message || 'Docker 命令失败').trim())
  }
}

async function prepareSandbox() {
  if (!workspaceRoot) throw new Error('尚未选择本地 Workspace')
  const id = crypto.randomUUID()
  const copyRoot = path.join(app.getPath('temp'), 'agenthub-sandboxes', id, 'workspace')
  await fs.mkdir(copyRoot, { recursive: true })
  await fs.cp(workspaceRoot, copyRoot, { recursive: true, filter: (source) => !path.relative(workspaceRoot, source).split(path.sep).some((part) => SANDBOX_EXCLUDED.has(part)) })
  const baseline = await buildManifest(workspaceRoot)
  const containerName = `agenthub-sandbox-${id}`
  const mount = `${copyRoot.replaceAll('\\', '/')}:/workspace`
  await docker(['create', '--name', containerName, '--network', SANDBOX_NETWORK, '--memory', '1g', '--cpus', '1', '--pids-limit', '256', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', mount, '-w', '/workspace', SANDBOX_IMAGE, 'sh', '-lc', 'while true; do sleep 2; done'], { timeout: 300_000 })
  await docker(['start', containerName])
  sandboxes.set(id, { id, copyRoot, containerName, baseline, services: new Map() })
  return { sandboxId: id, image: SANDBOX_IMAGE, network: SANDBOX_NETWORK, filesystemRoot: '/workspace', status: 'ready' }
}

async function destroySandbox(sandboxId) {
  const sandbox = sandboxes.get(sandboxId)
  if (!sandbox) return { sandboxId, removed: true }
  try { await docker(['rm', '-f', sandbox.containerName], { timeout: 30_000 }) } catch {}
  await fs.rm(path.dirname(sandbox.copyRoot), { recursive: true, force: true })
  sandboxes.delete(sandboxId)
  return { sandboxId, removed: true }
}

async function finalizeSandbox(sandboxId) {
  const sandbox = sandboxes.get(sandboxId)
  if (!sandbox) throw new Error('Sandbox 不存在或已经回收')
  const current = await buildManifest(sandbox.copyRoot)
  const changed = [...new Set([...sandbox.baseline.keys(), ...current.keys()])].filter((file) => sandbox.baseline.get(file) !== current.get(file))
  const conflicts = []
  for (const file of changed) if (await fileDigest(resolveSafe(file)) !== (sandbox.baseline.get(file) ?? null)) conflicts.push(file)
  if (conflicts.length) throw new Error(`Sandbox 同步冲突，原项目在任务期间发生变化：${conflicts.join(', ')}`)
  for (const file of changed) {
    const target = resolveSafe(file)
    if (!current.has(file)) await fs.rm(target, { force: true })
    else {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(sandboxSafe(sandbox, file), target)
    }
  }
  await destroySandbox(sandboxId)
  return { sandboxId, synchronized: true, files: changed }
}

async function sandboxExec(sandbox, command, timeout = 120_000) {
  try {
    const { stdout, stderr } = await docker(['exec', '-w', '/workspace', sandbox.containerName, 'sh', '-lc', command], { timeout })
    return { success: true, exitCode: 0, stdout, stderr }
  } catch (error) {
    return { success: false, exitCode: 1, stdout: '', stderr: error.message }
  }
}

async function executeSandboxTool(sandboxId, name, args = {}, approved = false) {
  const sandbox = sandboxes.get(sandboxId)
  if (!sandbox) throw new Error('Sandbox 尚未创建或已经回收')
  if (name === 'list_files') {
    const output = []
    async function walk(current, level) {
      if (level > Math.min(Number(args.depth) || 4, 8) || output.length >= 500) return
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        if (SANDBOX_EXCLUDED.has(entry.name)) continue
        const absolute = path.join(current, entry.name)
        output.push({ path: path.relative(sandbox.copyRoot, absolute).replaceAll('\\', '/'), type: entry.isDirectory() ? 'directory' : 'file' })
        if (entry.isDirectory()) await walk(absolute, level + 1)
      }
    }
    await walk(sandboxSafe(sandbox, args.path || '.'), 0)
    return { files: output, sandbox: true }
  }
  if (name === 'read_file') {
    const target = sandboxSafe(sandbox, args.path)
    if ((await fs.stat(target)).size > 1_000_000) throw new Error('文件超过 1MB，拒绝读取')
    return { path: args.path, content: await fs.readFile(target, 'utf8'), sandbox: true }
  }
  if (name === 'create_directory') {
    await fs.mkdir(sandboxSafe(sandbox, args.path), { recursive: true })
    return { created: args.path, sandbox: true }
  }
  if (name === 'write_file' || name === 'apply_patch') {
    if (!approved) throw new Error(`APPROVAL_REQUIRED: Sandbox ${name === 'write_file' ? '写入' : '修改'}需要在对话中批准`)
    const target = sandboxSafe(sandbox, args.path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (name === 'write_file') await fs.writeFile(target, String(args.content), 'utf8')
    else {
      const content = await fs.readFile(target, 'utf8')
      if (!content.includes(String(args.oldContent))) throw new Error('oldContent 未在 Sandbox 文件中找到')
      await fs.writeFile(target, content.replace(String(args.oldContent), String(args.newContent)), 'utf8')
    }
    return { [name === 'write_file' ? 'written' : 'patched']: args.path, sandbox: true }
  }
  if (name === 'run_command') {
    if (!approved) throw new Error('APPROVAL_REQUIRED: 在 Sandbox 中执行命令需要在对话中批准')
    return sandboxExec(sandbox, String(args.command || ''))
  }
  const repository = String(args.repository || '.').replaceAll('\\', '/')
  const cwdPrefix = repository === '.' ? '' : `cd ${JSON.stringify(repository)} && `
  if (name === 'git_status') return sandboxExec(sandbox, `${cwdPrefix}git branch --show-current && git status --short --branch`)
  if (name === 'git_branches') return sandboxExec(sandbox, `${cwdPrefix}git branch --all --no-color`)
  if (name === 'git_diff') return sandboxExec(sandbox, `${cwdPrefix}git diff --no-ext-diff -- ${JSON.stringify(String(args.path || '.'))}`)
  if (['git_clone', 'git_pull', 'git_checkout', 'git_commit'].includes(name)) {
    if (!approved) throw new Error(`APPROVAL_REQUIRED: Sandbox ${name} 操作需要在对话中批准`)
    if (name === 'git_pull') return sandboxExec(sandbox, `${cwdPrefix}git pull --ff-only ${args.remote ? JSON.stringify(String(args.remote)) : ''} ${args.branch ? JSON.stringify(String(args.branch)) : ''}`, 300_000)
    if (name === 'git_checkout') return sandboxExec(sandbox, `${cwdPrefix}git switch ${args.create ? '-c ' : ''}${JSON.stringify(String(args.branch))}`)
    if (name === 'git_commit') return sandboxExec(sandbox, `${cwdPrefix}git add -- ${(args.paths || ['.']).map((item) => JSON.stringify(String(item))).join(' ')} && git commit -m ${JSON.stringify(String(args.message))}`)
    return sandboxExec(sandbox, `git clone ${args.branch ? `--branch ${JSON.stringify(String(args.branch))} ` : ''}${JSON.stringify(String(args.url))} ${JSON.stringify(String(args.target))}`, 300_000)
  }
  if (name === 'start_service') {
    if (!approved) throw new Error('APPROVAL_REQUIRED: 在 Sandbox 中启动服务需要在对话中批准')
    const serviceId = crypto.randomUUID()
    const result = await sandboxExec(sandbox, `(${String(args.command || '')}) > /tmp/agenthub-${serviceId}.log 2>&1 & echo $!`)
    if (result.success) sandbox.services.set(serviceId, { id: serviceId, name: args.name || 'Sandbox 服务', command: args.command })
    return { ...result, serviceId, status: result.success ? 'running' : 'failed', sandbox: true }
  }
  if (name === 'service_status') return { services: [...sandbox.services.values()].map((service) => ({ ...service, status: 'running', sandbox: true })) }
  if (name === 'stop_service') {
    if (!approved) throw new Error('APPROVAL_REQUIRED: 停止 Sandbox 服务需要在对话中批准')
    sandbox.services.delete(String(args.serviceId))
    return { success: true, serviceId: args.serviceId, status: 'stopped', sandbox: true }
  }
  throw new Error(`未知 Sandbox 工具: ${name}`)
}

function shellCommand(command) {
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/zsh')
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command]
  return { shell, args }
}

function appendServiceLog(service, key, chunk) {
  service[key] = `${service[key]}${String(chunk)}`.slice(-SERVICE_LOG_LIMIT)
}

function serviceSnapshot(service) {
  return {
    serviceId: service.id,
    name: service.name,
    command: service.command,
    pid: service.child.pid,
    status: service.status,
    exitCode: service.exitCode,
    startedAt: service.startedAt,
    stdout: service.stdout,
    stderr: service.stderr
  }
}

async function stopTrackedService(service) {
  if (service.status !== 'running') return serviceSnapshot(service)
  if (process.platform === 'win32' && service.child.pid) {
    try { await execFileAsync('taskkill.exe', ['/pid', String(service.child.pid), '/t', '/f'], { windowsHide: true }) } catch {}
  } else {
    try { service.child.kill('SIGTERM') } catch {}
  }
  service.status = 'stopped'
  return serviceSnapshot(service)
}

function resolveSafe(relativePath = '.') {
  if (!workspaceRoot) throw new Error('尚未选择本地 Workspace')
  if (path.isAbsolute(relativePath)) throw new Error('只允许使用相对路径')
  const normalized = relativePath.replaceAll('\\', '/')
  if (normalized.split('/').includes('..')) throw new Error('路径禁止包含 ..')
  const target = path.resolve(workspaceRoot, relativePath)
  if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error('Path escapes workspace root')
  }
  return target
}

function validateGitName(value, label) {
  const text = String(value || '').trim()
  if (!text || text.startsWith('-') || !/^[\w./-]+$/.test(text)) throw new Error(`${label} 不合法`)
  return text
}

function validateGitPath(value) {
  const text = String(value || '').trim().replaceAll('\\', '/')
  if (!text || path.isAbsolute(text) || text.split('/').includes('..')) throw new Error('提交文件路径不合法')
  return text
}

async function gitRepository(relativePath = '.') {
  const cwd = resolveSafe(relativePath)
  try {
    await fs.stat(path.join(cwd, '.git'))
    return cwd
  } catch (error) {
    if (relativePath !== '.' || error?.code !== 'ENOENT') throw error
  }

  const repositories = []
  async function findRepositories(current, depth) {
    if (depth > 5 || repositories.length > 10) return
    let entries
    try { entries = await fs.readdir(current, { withFileTypes: true }) } catch { return }
    if (entries.some((entry) => entry.name === '.git')) {
      repositories.push(current)
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || BLOCKED_PARTS.has(entry.name) || entry.name.startsWith('.')) continue
      await findRepositories(path.join(current, entry.name), depth + 1)
    }
  }
  await findRepositories(cwd, 0)
  if (repositories.length === 1) return repositories[0]
  if (repositories.length > 1) {
    const names = repositories.map((repository) => path.relative(workspaceRoot, repository)).join(', ')
    throw new Error(`当前 Workspace 中有多个 Git 仓库，请指定 repository：${names}`)
  }
  throw new Error('当前 Workspace 及其子目录中没有找到 Git 仓库')
}

async function confirm(title, detail) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning', title, message: title, detail,
    buttons: ['取消', '允许'], defaultId: 0, cancelId: 0, noLink: true
  })
  if (result.response !== 1) throw new Error('用户取消了本地操作')
}

async function listFiles(relativePath = '.', depth = 4) {
  const root = resolveSafe(relativePath)
  const output = []
  async function walk(current, level) {
    if (level > Math.min(Number(depth) || 4, 8) || output.length >= 500) return
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (BLOCKED_PARTS.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      const relative = path.relative(workspaceRoot, absolute)
      output.push({ path: relative, type: entry.isDirectory() ? 'directory' : 'file' })
      if (entry.isDirectory()) await walk(absolute, level + 1)
      if (output.length >= 500) break
    }
  }
  await walk(root, 0)
  return output
}

async function executeTool(name, args = {}, approved = false) {
  if (name === 'sandbox_prepare') return prepareSandbox()
  if (name === 'sandbox_finalize') return finalizeSandbox(String(args.sandboxId || ''))
  if (name === 'sandbox_discard') return destroySandbox(String(args.sandboxId || ''))
  if (args.__sandboxId) {
    const sandboxId = String(args.__sandboxId)
    const sandboxArgs = { ...args }
    delete sandboxArgs.__sandboxId
    return executeSandboxTool(sandboxId, name, sandboxArgs, approved)
  }
  switch (name) {
    case 'list_files':
      return { files: await listFiles(args.path || '.', args.depth || 4) }
    case 'read_file': {
      const target = resolveSafe(args.path)
      const stat = await fs.stat(target)
      if (stat.size > 1_000_000) throw new Error('文件超过 1MB，拒绝读取')
      return { path: args.path, content: await fs.readFile(target, 'utf8') }
    }
    case 'create_directory': {
      await fs.mkdir(resolveSafe(args.path), { recursive: true })
      return { created: args.path }
    }
    case 'write_file': {
      const target = resolveSafe(args.path)
      const content = String(args.content)
      let previousSize = 0
      try { previousSize = (await fs.stat(target)).size } catch {}
      const isLargeWrite = Math.max(previousSize, Buffer.byteLength(content)) > 50_000
      if (isLargeWrite && !approved) throw new Error('APPROVAL_REQUIRED: 大范围文件写入需要在对话中批准')
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content, 'utf8')
      return { written: args.path, bytes: Buffer.byteLength(content), confirmationRequired: isLargeWrite }
    }
    case 'apply_patch': {
      const target = resolveSafe(args.path)
      const current = await fs.readFile(target, 'utf8')
      if (!current.includes(String(args.oldContent))) throw new Error('oldContent 未在文件中找到')
      const next = current.replace(String(args.oldContent), String(args.newContent))
      const changedCharacters = String(args.oldContent).length + String(args.newContent).length
      const isLargePatch = changedCharacters > 20_000
      if (isLargePatch && !approved) throw new Error('APPROVAL_REQUIRED: 大范围修改需要在对话中批准')
      await fs.writeFile(target, next, 'utf8')
      return { patched: args.path, changed: true, confirmationRequired: isLargePatch }
    }
    case 'git_diff': {
      const cwd = await gitRepository(args.repository || '.')
      const gitArgs = ['diff']
      if (args.staged === true) gitArgs.push('--staged')
      const selectedPath = args.path || '.'
      gitArgs.push('--', selectedPath)
      const numstatArgs = ['diff']
      if (args.staged === true) numstatArgs.push('--staged')
      numstatArgs.push('--numstat', '--', selectedPath)
      const [{ stdout, stderr }, { stdout: numstat }, { stdout: untrackedRaw }] = await Promise.all([
        execFileAsync('git', gitArgs, { cwd, maxBuffer: 4_000_000 }),
        execFileAsync('git', numstatArgs, { cwd, maxBuffer: 2_000_000 }),
        args.staged === true
          ? Promise.resolve({ stdout: '' })
          : execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', selectedPath], { cwd, maxBuffer: 2_000_000 })
      ])
      const files = numstat.split(/\r?\n/).filter(Boolean).map((line) => {
        const [added, deleted, ...fileParts] = line.split('\t')
        return { path: fileParts.join('\t'), additions: added === '-' ? 0 : Number(added), deletions: deleted === '-' ? 0 : Number(deleted), binary: added === '-' || deleted === '-' }
      })
      let fullDiff = stdout
      for (const relativeFile of untrackedRaw.split('\0').filter(Boolean)) {
        const target = path.resolve(cwd, relativeFile)
        if (target !== cwd && !target.startsWith(`${cwd}${path.sep}`)) continue
        let content
        try {
          const stat = await fs.stat(target)
          if (!stat.isFile() || stat.size > 500_000) {
            files.push({ path: relativeFile, additions: 0, deletions: 0, binary: true })
            continue
          }
          content = await fs.readFile(target, 'utf8')
        } catch { continue }
        const lines = content ? content.replace(/\r\n/g, '\n').split('\n') : []
        if (lines.at(-1) === '') lines.pop()
        files.push({ path: relativeFile, additions: lines.length, deletions: 0, binary: false })
        const body = lines.map((line) => `+${line}`).join('\n')
        fullDiff += `${fullDiff ? '\n' : ''}diff --git a/${relativeFile} b/${relativeFile}\nnew file mode 100644\n--- /dev/null\n+++ b/${relativeFile}\n@@ -0,0 +1,${lines.length} @@\n${body}${body ? '\n' : ''}`
      }
      return { repository: path.relative(workspaceRoot, cwd) || '.', files, diff: fullDiff, stdout: fullDiff, stderr }
    }
    case 'git_status': {
      const cwd = await gitRepository(args.repository || '.')
      const [{ stdout: branch }, { stdout: status }] = await Promise.all([
        execFileAsync('git', ['branch', '--show-current'], { cwd, maxBuffer: 200_000 }),
        execFileAsync('git', ['status', '--short', '--branch'], { cwd, maxBuffer: 2_000_000 })
      ])
      return { repository: path.relative(workspaceRoot, cwd) || '.', branch: branch.trim() || '(detached HEAD)', status }
    }
    case 'git_branches': {
      const cwd = await gitRepository(args.repository || '.')
      const { stdout } = await execFileAsync('git', ['branch', '--all', '--no-color'], { cwd, maxBuffer: 2_000_000 })
      return { repository: path.relative(workspaceRoot, cwd) || '.', branches: stdout }
    }
    case 'git_clone': {
      if (!approved) throw new Error('APPROVAL_REQUIRED: 克隆仓库需要在对话中批准')
      const url = String(args.url || '').trim()
      if (!/^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(url) || /https?:\/\/[^/\s]*@/i.test(url)) throw new Error('仓库地址不合法，且不允许在 URL 中包含凭据')
      const targetRelative = String(args.target || '').trim()
      if (!targetRelative || targetRelative === '.') throw new Error('target 必须是 Workspace 内的新子目录')
      const target = resolveSafe(targetRelative)
      try {
        const entries = await fs.readdir(target)
        if (entries.length) throw new Error('目标目录已存在且不为空')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const cloneArgs = ['clone']
      if (args.branch) cloneArgs.push('--branch', validateGitName(args.branch, 'branch'))
      cloneArgs.push('--', url, target)
      const { stdout, stderr } = await execFileAsync('git', cloneArgs, { cwd: workspaceRoot, timeout: 300_000, maxBuffer: 4_000_000 })
      const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], { cwd: target, maxBuffer: 200_000 })
      return { success: true, repository: targetRelative, branch: branch.trim(), stdout, stderr }
    }
    case 'git_pull': {
      if (!approved) throw new Error('APPROVAL_REQUIRED: 拉取远程代码需要在对话中批准')
      const cwd = await gitRepository(args.repository || '.')
      const pullArgs = ['pull', '--ff-only']
      if (args.remote || args.branch) pullArgs.push(validateGitName(args.remote || 'origin', 'remote'))
      if (args.branch) pullArgs.push(validateGitName(args.branch, 'branch'))
      const { stdout, stderr } = await execFileAsync('git', pullArgs, { cwd, timeout: 300_000, maxBuffer: 4_000_000 })
      const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], { cwd, maxBuffer: 200_000 })
      return { success: true, repository: args.repository || '.', branch: branch.trim(), stdout, stderr }
    }
    case 'git_checkout': {
      if (!approved) throw new Error('APPROVAL_REQUIRED: 切换分支需要在对话中批准')
      const cwd = await gitRepository(args.repository || '.')
      const branch = validateGitName(args.branch, 'branch')
      const switchArgs = args.create === true ? ['switch', '-c', branch] : ['switch', branch]
      const { stdout, stderr } = await execFileAsync('git', switchArgs, { cwd, maxBuffer: 2_000_000 })
      return { success: true, repository: args.repository || '.', branch, stdout, stderr }
    }
    case 'git_commit': {
      if (!approved) throw new Error('APPROVAL_REQUIRED: 创建 Git 提交需要在对话中批准')
      const cwd = await gitRepository(args.repository || '.')
      const message = String(args.message || '').trim()
      if (!message || message.length > 500) throw new Error('提交说明不能为空且不能超过 500 个字符')
      const paths = Array.isArray(args.paths) ? args.paths.map(validateGitPath) : []
      if (!paths.length) throw new Error('paths 不能为空；如需提交全部修改请传入 ["."]')
      await execFileAsync('git', ['add', '--', ...paths], { cwd, maxBuffer: 2_000_000 })
      const { stdout, stderr } = await execFileAsync('git', ['commit', '-m', message], { cwd, maxBuffer: 4_000_000 })
      const [{ stdout: branch }, { stdout: status }] = await Promise.all([
        execFileAsync('git', ['branch', '--show-current'], { cwd, maxBuffer: 200_000 }),
        execFileAsync('git', ['status', '--short', '--branch'], { cwd, maxBuffer: 2_000_000 })
      ])
      return { success: true, repository: args.repository || '.', branch: branch.trim(), message, paths, status, stdout, stderr }
    }
    case 'run_command': {
      const command = String(args.command || '').trim()
      if (!command) throw new Error('command 不能为空')
      if (!approved) throw new Error('APPROVAL_REQUIRED: 执行命令需要在对话中批准')
      const { shell, args: shellArgs } = shellCommand(command)
      try {
        const { stdout, stderr } = await execFileAsync(shell, shellArgs, { cwd: workspaceRoot, timeout: 120_000, maxBuffer: 2_000_000 })
        return { success: true, exitCode: 0, stdout, stderr }
      } catch (error) {
        return {
          success: false,
          exitCode: typeof error?.code === 'number' ? error.code : 1,
          stdout: String(error?.stdout || ''),
          stderr: String(error?.stderr || error?.message || '命令执行失败')
        }
      }
    }
    case 'start_service': {
      const command = String(args.command || '').trim()
      if (!command) throw new Error('command 不能为空')
      if (!approved) throw new Error('APPROVAL_REQUIRED: 启动后台服务需要在对话中批准')
      const duplicate = [...runningServices.values()].find((service) => service.status === 'running' && service.command === command)
      if (duplicate) return { success: true, reused: true, ...serviceSnapshot(duplicate) }
      const { shell, args: shellArgs } = shellCommand(command)
      const id = crypto.randomUUID()
      const child = spawn(shell, shellArgs, {
        cwd: workspaceRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const service = {
        id,
        name: String(args.name || `服务 ${runningServices.size + 1}`),
        command,
        child,
        status: 'starting',
        exitCode: null,
        startedAt: new Date().toISOString(),
        stdout: '',
        stderr: ''
      }
      runningServices.set(id, service)
      child.stdout.on('data', (chunk) => appendServiceLog(service, 'stdout', chunk))
      child.stderr.on('data', (chunk) => appendServiceLog(service, 'stderr', chunk))
      child.once('error', (error) => {
        service.status = 'failed'
        appendServiceLog(service, 'stderr', error.message)
      })
      child.once('exit', (code) => {
        service.exitCode = code
        if (service.status !== 'stopped') service.status = code === 0 ? 'exited' : 'failed'
      })
      await new Promise((resolve) => setTimeout(resolve, 1200))
      if (service.status === 'starting') service.status = 'running'
      return { success: service.status === 'running', ...serviceSnapshot(service) }
    }
    case 'service_status': {
      const serviceId = String(args.serviceId || '').trim()
      if (serviceId) {
        const service = runningServices.get(serviceId)
        if (!service) throw new Error(`找不到服务: ${serviceId}`)
        return serviceSnapshot(service)
      }
      return { services: [...runningServices.values()].map(serviceSnapshot) }
    }
    case 'stop_service': {
      if (!approved) throw new Error('APPROVAL_REQUIRED: 停止后台服务需要在对话中批准')
      const serviceId = String(args.serviceId || '').trim()
      if (!serviceId) throw new Error('serviceId 不能为空')
      const service = runningServices.get(serviceId)
      if (!service) throw new Error(`找不到服务: ${serviceId}`)
      return { success: true, ...(await stopTrackedService(service)) }
    }
    default:
      throw new Error(`未知本地工具: ${name}`)
  }
}

ipcMain.handle('workspace:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || !result.filePaths[0]) return null
  workspaceRoot = path.resolve(result.filePaths[0])
  workspaceToken = crypto.randomUUID()
  return { token: workspaceToken, name: path.basename(workspaceRoot) }
})

ipcMain.handle('workspace:get', async () => workspaceRoot ? { token: workspaceToken, name: path.basename(workspaceRoot) } : null)

ipcMain.handle('workspace:tool', async (_event, request) => {
  if (!workspaceToken || request?.workspaceToken !== workspaceToken) throw new Error('Workspace 授权无效')
  return executeTool(request.name, request.arguments, request.approved === true)
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 680,
    title: 'AgentHub', backgroundColor: '#fffefa',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const webUrl = process.env.AGENTHUB_WEB_URL || 'http://localhost:3000'
  let loadAttempts = 0
  const loadWebApp = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    loadAttempts += 1
    mainWindow.loadURL(webUrl).catch(() => {})
  }
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, validatedURL, isMainFrame) => {
    if (!isMainFrame || validatedURL !== webUrl || errorCode === -3 || loadAttempts >= 20) return
    setTimeout(loadWebApp, Math.min(500 + loadAttempts * 250, 2500))
  })
  loadWebApp()
}

app.whenReady().then(createWindow)
app.on('before-quit', () => {
  for (const sandbox of sandboxes.values()) execFile('docker', ['rm', '-f', sandbox.containerName], { windowsHide: true }, () => {})
  for (const service of runningServices.values()) {
    if (service.status === 'running') {
      try { service.child.kill() } catch {}
    }
  }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
