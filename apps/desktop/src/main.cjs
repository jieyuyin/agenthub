const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
let mainWindow
let workspaceRoot = null
let workspaceToken = null

const BLOCKED_PARTS = new Set(['.git', 'node_modules', '.next', 'dist', 'build'])

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
      const { stdout, stderr } = await execFileAsync('git', ['diff', '--', args.path || '.'], { cwd: workspaceRoot, maxBuffer: 2_000_000 })
      return { stdout, stderr }
    }
    case 'run_command': {
      const command = String(args.command || '').trim()
      if (!command) throw new Error('command 不能为空')
      if (!approved) throw new Error('APPROVAL_REQUIRED: 执行命令需要在对话中批准')
      const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-lc', command], { cwd: workspaceRoot, timeout: 120_000, maxBuffer: 2_000_000 })
      return { stdout, stderr }
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
  mainWindow.loadURL(process.env.AGENTHUB_WEB_URL || 'http://localhost:3000')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
