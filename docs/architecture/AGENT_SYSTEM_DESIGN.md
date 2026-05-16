# Agent 系统详细设计方案

## 1. Agent 架构

### 1.1 Agent 核心模型

```typescript
interface AgentDefinition {
  id: string
  name: string
  role: AgentRole
  version: string
  
  // 来自 packages/prompts
  systemPrompt: string
  
  // Agent 能力
  capabilities: AgentCapability[]
  tools: Tool[]
  
  // 执行配置
  model: ModelConfig
  temperature: number
  maxTokens: number
  
  // 状态管理
  status: AgentStatus
  lastActivityAt: Date
  errorLog?: ErrorLog[]
}

type AgentRole = 'pm' | 'frontend' | 'backend' | 'devops'
type AgentStatus = 'idle' | 'busy' | 'error' | 'paused'
```

### 1.2 Agent 生命周期

```
Create
  ↓
Initialize
  ↓
Idle
  ├─ Receive Task
  │    ↓
  │  Processing
  │    ├─ Read Context
  │    ├─ Tool Calling Loop
  │    ├─ Generate Output
  │    └─ Create Patch/Task
  │    ↓
  ├─ Success → Idle
  ├─ Error → Error State (retry or manual intervention)
  └─ Blocked → Waiting (等待其他 Agent 或用户)
  ↓
Stop / Archive
```

## 2. Agent 类型详细设计

### 2.1 PM Agent (产品经理)

**职责**:
- 需求分析和任务分解
- 项目进度追踪
- 风险识别

**输入**: 
```
用户描述需求: "我需要开发一个用户登录功能"
```

**处理流程**:
```
Parse requirement
  ├─ Extract key features: auth, session, security
  ├─ Break into subtasks:
  │  ├─ Frontend: Login form UI
  │  ├─ Backend: Auth API
  │  ├─ Database: User schema
  │  └─ Security: Password hash, JWT
  └─ Create tasks with acceptance criteria
```

**输出**:
```typescript
{
  type: 'task_decomposition',
  tasks: [
    {
      id: 'task-1',
      title: 'Create login form component',
      assignTo: 'frontend',
      description: '...',
      acceptance: [...],
      priority: 1
    },
    ...
  ],
  estimatedHours: 8,
  risks: [...]
}
```

**Tools**:
```
├─ create_task(title, description, assignee, acceptance_criteria)
├─ list_requirements(pattern)
├─ analyze_dependencies(tasks)
└─ create_risk_assessment(task_id)
```

**System Prompt Location**: `packages/prompts/agents/pm.md`

### 2.2 Frontend Agent

**职责**:
- UI/UX 实现
- 组件开发
- 样式优化

**输入**: 
```
Task: "Create login form component with Tailwind CSS"
Acceptance Criteria:
  - Form should have email and password fields
  - Validation on submit
  - Error messages display
  - Loading state
```

**处理流程**:
```
Analyze task
  ├─ Read existing components (read_file)
  ├─ Search design patterns (search_code)
  ├─ Generate component code
  ├─ Create patch
  └─ Preview changes
```

**输出**:
```typescript
{
  type: 'code_patch',
  filepath: 'src/components/LoginForm.tsx',
  patch: {
    additions: 50,
    deletions: 0,
    content: '...git diff format...'
  },
  testFile: 'src/components/__tests__/LoginForm.test.tsx',
  previewUrl: 'http://preview.local:3000/login'
}
```

**Tools**:
```
├─ read_file(filepath)
├─ list_files(directory)
├─ search_code(pattern, directory)
├─ create_patch(filepath, old_content, new_content)
├─ run_npm_command(command)
├─ run_test(test_file)
├─ take_screenshot(url)
└─ preview_changes()
```

### 2.3 Backend Agent

**职责**:
- API 开发
- 数据库设计
- 业务逻辑实现

**输入**: 
```
Task: "Implement user login API endpoint with JWT auth"
Acceptance Criteria:
  - POST /api/auth/login
  - Email + password validation
  - Return JWT token
  - Rate limiting
```

**处理流程**:
```
Analyze task
  ├─ Review API design
  ├─ Check database schema
  ├─ Implement handler
  ├─ Add tests
  ├─ Create patch
  └─ Run tests
```

**Output**:
```typescript
{
  type: 'code_patch',
  filepaths: [
    'src/api/routes/auth.ts',
    'src/db/schema/users.ts',
    'src/tests/auth.test.ts'
  ],
  patch: '...git diff format...',
  tests: {
    passed: 10,
    failed: 0,
    coverage: 95
  }
}
```

**Tools**:
```
├─ read_file(filepath)
├─ search_code(pattern, directory)
├─ create_patch(filepath, old_content, new_content)
├─ run_npm_command(command)
├─ run_test(test_file)
├─ run_database_migration(script)
├─ query_database(sql)
└─ check_api_endpoint(url, method, payload)
```

## 3. Agent 通信协议

### 3.1 Message 格式

所有 Agent 间通信通过 MessageBus：

```typescript
interface AgentMessage {
  id: string
  from: {
    agentId: string
    agentRole: AgentRole
  }
  to: {
    agentId?: string  // 如果为空则是广播
    agentRole?: AgentRole  // 可以按角色广播
  }
  type: 'request' | 'response' | 'notification'
  
  // 消息内容
  subject: string
  body: Record<string, any>
  
  // 跟踪
  conversationId: string
  parentMessageId?: string
  
  // 元数据
  priority: 'low' | 'normal' | 'high'
  timeout?: number
  requiresAck: boolean
  createdAt: Date
  expiresAt?: Date
}
```

### 3.2 通信模式

#### Pattern 1: 请求-响应 (Request-Response)

```
Frontend Agent 请求 Backend Agent:
{
  type: 'request',
  subject: 'need_api_endpoint',
  body: {
    endpoint: '/api/users/profile',
    method: 'GET',
    auth: 'jwt'
  }
}

Backend Agent 响应:
{
  type: 'response',
  subject: 'api_endpoint_ready',
  body: {
    endpoint: '/api/users/profile',
    status: 'implemented',
    testsPassed: true
  }
}
```

#### Pattern 2: 发布-订阅 (Pub-Sub)

```
Task 创建后，所有相关 Agent 被通知:
{
  type: 'notification',
  subject: 'task_assigned',
  to: { agentRole: 'frontend' },
  body: {
    taskId: 'task-123',
    title: 'Create login form',
    description: '...'
  }
}
```

#### Pattern 3: Agent 对话 (Conversation)

```
Chat 中的 @agent mention:

User: "@frontend 请创建登录表单，@backend 我需要登录 API"

System:
├─ 创建 Message 关联 Frontend Agent
├─ 创建 Message 关联 Backend Agent
├─ 两个 Agent 共享 conversationId
└─ 允许 Agent 互相可见的消息上下文
```

## 4. Tool 系统详细设计

### 4.1 Tool 执行生命周期

```
Agent 调用 Tool
    ↓
Tool Registry 查找定义
    ↓
参数验证 (JSON Schema)
    ↓
权限检查
    ↓
执行处理器 (handler)
    │
    ├─ Success → 返回结果
    ├─ Error → 错误恢复
    └─ Timeout → 降级策略
    ↓
记录执行日志
```

### 4.2 Tool 参数化定义

```typescript
interface ToolDefinition {
  id: string
  name: string
  version: string
  description: string
  
  parameters: {
    type: 'object'
    properties: Record<string, JSONSchema>
    required: string[]
  }
  
  response: {
    type: 'object'
    properties: Record<string, JSONSchema>
  }
  
  // 执行配置
  timeout: number // ms
  retryPolicy: {
    maxRetries: number
    backoffMs: number
  }
  
  // 资源限制
  rateLimit: {
    maxCalls: number
    windowMs: number
  }
  
  // 可用性
  allowedRoles: AgentRole[]
  requiredScopes: string[]
  
  handler: (params: any, context: ExecutionContext) => Promise<any>
}
```

### 4.3 Core Tools 实现

#### Tool: `read_file`

```typescript
{
  name: 'read_file',
  parameters: {
    filepath: { type: 'string', description: '相对于 workspace root' },
    startLine?: { type: 'number' },
    endLine?: { type: 'number' }
  },
  handler: async (params, context) => {
    const fullPath = path.join(context.workspaceRoot, params.filepath)
    // 安全检查：不能读取 .env, node_modules 等
    if (isBlacklisted(fullPath)) throw new Error('Access denied')
    return fs.readFile(fullPath, 'utf-8')
  }
}
```

#### Tool: `search_code`

```typescript
{
  name: 'search_code',
  parameters: {
    query: { type: 'string' },
    directory?: { type: 'string' },
    filePattern?: { type: 'string' } // 如 '*.tsx'
  },
  handler: async (params, context) => {
    // 使用 ripgrep 或类似工具搜索
    const results = await searchCode(params.query, {
      cwd: context.workspaceRoot,
      directory: params.directory,
      pattern: params.filePattern
    })
    return results.map(r => ({
      file: r.file,
      line: r.line,
      content: r.content
    }))
  }
}
```

#### Tool: `create_patch`

```typescript
{
  name: 'create_patch',
  parameters: {
    filepath: { type: 'string' },
    oldContent: { type: 'string' },
    newContent: { type: 'string' }
  },
  handler: async (params, context) => {
    const patch = generateGitDiff(
      params.filepath,
      params.oldContent,
      params.newContent
    )
    // 保存 patch 到临时存储，返回 ID
    const patchId = await savePatch(patch, context.taskId)
    return {
      patchId,
      patch: patch,
      changes: {
        additions: countAdditions(patch),
        deletions: countDeletions(patch)
      }
    }
  }
}
```

#### Tool: `run_terminal`

```typescript
{
  name: 'run_terminal',
  parameters: {
    command: { type: 'string' },
    timeout?: { type: 'number', default: 30000 },
    cwd?: { type: 'string' }
  },
  handler: async (params, context) => {
    // 在 Runtime Container 中执行命令
    const result = await runtime.exec(context.runtimeId, params.command, {
      timeout: params.timeout,
      cwd: params.cwd || '/workspace'
    })
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration
    }
  }
}
```

## 5. Agent 调度与分发

### 5.1 Dispatcher (规则引擎)

```typescript
class TaskDispatcher {
  async dispatch(task: Task): Promise<Agent> {
    const keywords = extractKeywords(task.description)
    
    // Rule-based matching (MVP)
    const rules = [
      {
        patterns: ['前端', 'UI', 'component', 'button', 'form'],
        agent: 'frontend'
      },
      {
        patterns: ['后端', 'API', 'database', 'server', 'auth'],
        agent: 'backend'
      },
      {
        patterns: ['需求', '分解', '计划', 'plan', 'breakdown'],
        agent: 'pm'
      }
    ]
    
    for (const rule of rules) {
      if (keywords.some(k => rule.patterns.includes(k))) {
        return this.agentService.getAgent(rule.agent)
      }
    }
    
    // 无法确定则分配给 PM Agent
    return this.agentService.getAgent('pm')
  }
}
```

### 5.2 Agent 状态管理

```typescript
class AgentStateManager {
  private states = new Map<string, AgentState>()
  
  async updateState(agentId: string, update: Partial<AgentState>) {
    const current = this.states.get(agentId)
    const next = { ...current, ...update }
    
    this.states.set(agentId, next)
    
    // 发布事件
    await this.eventBus.publish({
      type: 'AGENT_STATE_CHANGED',
      data: {
        agentId,
        previousState: current,
        newState: next
      }
    })
  }
  
  getStatus(agentId: string): AgentStatus {
    return this.states.get(agentId)?.status || 'idle'
  }
}
```

## 6. Agent 执行流程

### 6.1 Agent 处理一个 Task 的完整流程

```
1. Task 分配给 Agent
   Event: TASK_ASSIGNED
   ↓

2. Agent 收到通知并进入 busy 状态
   Event: AGENT_STARTED
   ↓

3. Agent 读取任务上下文
   ├─ read_file(README.md) - 理解项目
   ├─ list_files(src/) - 查看代码结构
   └─ search_code(relevant patterns)
   ↓

4. Agent 执行主逻辑 (Tool Calling Loop)
   Iteration 1:
   ├─ Call Tool A
   ├─ Analyze Result
   ├─ Decide next action
   
   Iteration N:
   ├─ Generate code / patch
   └─ Decide: Continue or Finish
   ↓

5. Agent 生成 Patch
   Event: PATCH_GENERATED
   ├─ Patch ID: xyz
   ├─ Diff content
   ├─ Summary of changes
   └─ Test results (if applicable)
   ↓

6. System 广播 Patch 到 Chat
   User Reviews & Approves
   ↓

7. System 应用 Patch
   Event: PATCH_APPLIED
   ├─ Files updated
   └─ Runtime refreshed
   ↓

8. Agent 完成 Task
   Event: AGENT_FINISHED
   ├─ Task status: completed
   └─ Agent status: idle
   ↓

9. Task 状态更新
   Event: TASK_COMPLETED
```

### 6.2 Error Recovery

```
If Error during execution:
├─ Catch error in Tool handler
├─ Log error with context
├─ Publish AGENT_ERROR event
├─ Update Agent status to 'error'
│
├─ Retry Strategy:
│  ├─ If retryable: exponential backoff
│  └─ If not: wait for human intervention
│
└─ Notify user in Chat:
   "Agent encountered error: ... Would you like to retry?"
```

## 7. Agent 上下文管理

### 7.1 Execution Context

```typescript
interface ExecutionContext {
  // 身份
  agentId: string
  agentRole: AgentRole
  agentVersion: string
  
  // 工作空间
  workspaceId: string
  workspaceRoot: string
  
  // 任务
  taskId: string
  conversationId: string
  
  // 时间限制
  executionStartTime: Date
  timeout: number
  
  // 权限
  allowedTools: string[]
  allowedPaths: string[]
  
  // 回调
  onToolCall: (tool: string, params: any) => Promise<any>
  onLog: (level: string, message: string) => void
  onProgress: (progress: number) => void
}
```

### 7.2 Context 隔离

```
Each Agent Execution:
├─ 独立的上下文
├─ 独立的日志流
├─ 独立的临时文件
├─ 受限的文件系统访问
└─ 受限的工具访问

禁止：
├─ 直接访问其他 Workspace 文件
├─ 直接修改数据库
├─ 无限制的 API 调用
└─ 访问系统敏感信息
```

## 8. Agent 间协作场景

### 场景 1: 串行依赖 (Frontend → Backend)

```
User Request: "创建完整的用户管理功能"

PM Agent:
├─ 分解需求
└─ Create Task: "Frontend: 用户列表页面"
   └─ Create Task: "Backend: 用户查询 API"

Frontend Agent 处理第一个 task:
├─ Create UI
├─ Generate Patch
└─ Publish in chat

Backend Agent 处理第二个 task:
├─ 可以看到 Frontend 的 Patch（同 conversation）
├─ 了解前端需要的 API 契约
├─ Implement Backend
└─ Generate Patch
```

### 场景 2: 并行开发 (Frontend + Backend 同时)

```
PM Agent 分解任务后：
├─ Create Task: "Frontend" → 分配给 Frontend Agent
└─ Create Task: "Backend" → 分配给 Backend Agent

两个 Agent 并行执行
↓
都发送 Patch 到 Chat
↓
User 审核两个 Patch
↓
Apply both patches
```

### 场景 3: Agent 间通信 (协商)

```
Frontend Agent 遇到问题：
"我需要用户列表 API，但不清楚返回格式"
  ↓
发送消息到 Chat：
"@backend 请告诉我 /api/users 返回格式"
  ↓
Backend Agent 看到 mention：
读取上下文后回复：
"返回格式是 { users: [{ id, name, email }], total: number }"
  ↓
Frontend Agent 继续工作
```

## 9. Agent 监控与可观测性

### 9.1 Agent 指标

```
Key Metrics:
├─ Task completion rate: 完成的 task / 总 task
├─ Average task duration: 平均耗时
├─ Error rate: 失败的 tool calls / 总 calls
├─ Tool usage distribution: 各 tool 调用次数
└─ User approval rate: 批准的 patch / 生成的 patch
```

### 9.2 Agent 日志

```
Log Format:
{
  timestamp: ISO8601,
  agentId: string,
  taskId: string,
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  event: string,
  data: Record<string, any>,
  stack?: string
}

Example:
{
  timestamp: '2026-05-13T10:30:00Z',
  agentId: 'agent-frontend-1',
  taskId: 'task-123',
  level: 'INFO',
  event: 'tool_called',
  data: {
    toolName: 'create_patch',
    duration: 234,
    success: true,
    patchId: 'patch-456'
  }
}
```

---

**版本**: v0.1.0  
**最后更新**: 2026-05-13
