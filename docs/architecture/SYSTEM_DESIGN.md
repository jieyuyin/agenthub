# AgentHub 系统架构设计文档

## 1. 系统概览

AgentHub 是一个 **AI Native Collaboration OS**，核心是多 Agent 协作在软件开发中的应用。系统采用 **Event Driven 架构**，支持完整的工作流闭环：

```
Chat → Task → Code Diff → Preview → Deploy
```

## 2. 核心架构

### 2.1 分层架构

```
┌─────────────────────────────────────┐
│     Frontend (Next.js)              │
│  Chat | Tasks | Files | Terminal    │
└────────────────┬────────────────────┘
                 │ (WebSocket/HTTP)
┌────────────────▼────────────────────┐
│     API Server (Fastify)            │
│  Routes | Auth | Business Logic     │
└────────────────┬────────────────────┘
                 │ (Event Bus)
┌────────────────▼────────────────────┐
│     Event System (Redis/Bull)       │
│  Task Queue | Event Stream          │
└────────────────┬────────────────────┘
                 │
    ┌────────────┼────────────────┐
    │            │                │
    ▼            ▼                ▼
┌────────┐  ┌─────────┐  ┌──────────────┐
│ Agent  │  │ Runtime │  │ Integration  │
│ Engine │  │ Manager │  │ Services     │
└────────┘  └─────────┘  └──────────────┘
```

### 2.2 核心模块

| 模块 | 职责 | 技术栈 |
|------|------|--------|
| **Chat** | 实时协作聊天、消息管理、流式输出 | Socket.io + TanStack Query |
| **Agent System** | Agent 协调、Tool Calling、决策 | OpenAI SDK + Custom Runtime |
| **Task System** | 任务拆解、状态管理、优先级调度 | Event-driven |
| **File System** | 文件树、版本管理、权限控制 | Postgres + Redis |
| **Code Diff** | Patch 生成、Review、Apply | git diff format |
| **Runtime Sandbox** | 容器隔离、命令执行、环境管理 | Docker + Docker API |
| **Preview** | 实时预览、反向代理、URL 生成 | Reverse Proxy + iframe |
| **Deployment** | 部署编排、状态追踪、回滚 | Vercel API / Railway API |

## 3. 数据模型

### 3.1 核心实体

```
Workspace
  ├── Conversations []
  │    └── Message []
  ├── Tasks []
  │    ├── SubTask []
  │    └── Patch []
  ├── Files
  │    └── FileVersion []
  ├── Agents []
  ├── Runtimes []
  └── Deployments []
```

### 3.2 关键 Domain Model

#### Workspace
```typescript
interface Workspace {
  id: string
  name: string
  description: string
  ownerId: string
  runtimeId: string
  deploymentUrl?: string
  createdAt: Date
  updatedAt: Date
  state: 'active' | 'archived'
}
```

#### Conversation
```typescript
interface Conversation {
  id: string
  workspaceId: string
  type: 'group' | 'thread'
  title: string
  messages: Message[]
  agentIds: string[] // 参与的 Agent
  createdAt: Date
  updatedAt: Date
}
```

#### Task
```typescript
interface Task {
  id: string
  conversationId: string
  title: string
  description: string
  status: 'pending' | 'assigned' | 'in_progress' | 'blocked' | 'completed'
  assignedAgentId?: string
  patches: Patch[]
  files: FileChange[]
  priority: number
  createdAt: Date
  completedAt?: Date
}
```

#### Patch
```typescript
interface Patch {
  id: string
  taskId: string
  content: string // git diff format
  status: 'generated' | 'review_requested' | 'approved' | 'applied' | 'rejected'
  createdBy: string
  appliedAt?: Date
  appliedBy?: string
  diff: {
    additions: number
    deletions: number
    files: string[]
  }
}
```

#### Agent
```typescript
interface Agent {
  id: string
  name: string
  role: 'pm' | 'frontend' | 'backend' | 'devops'
  prompt: string // references packages/prompts
  tools: Tool[]
  status: 'idle' | 'busy' | 'error'
  model: 'gpt-4' | 'gpt-3.5-turbo'
  createdAt: Date
}
```

#### Runtime
```typescript
interface Runtime {
  id: string
  workspaceId: string
  type: 'docker'
  containerId: string
  status: 'starting' | 'ready' | 'error' | 'stopped'
  previewUrl?: string
  exposedPorts: number[]
  filesystemRoot: string
  createdAt: Date
}
```

## 4. 事件系统

### 4.1 事件类型

所有事件遵循统一格式：

```typescript
interface DomainEvent {
  type: EventType
  id: string
  aggregateId: string
  aggregateType: 'workspace' | 'conversation' | 'task' | 'patch'
  timestamp: Date
  userId: string
  data: Record<string, any>
  version: number
}
```

### 4.2 核心事件流

| 事件 | 触发条件 | 处理器 |
|------|----------|--------|
| MESSAGE_CREATED | 用户或 Agent 发送消息 | Chat Handler, Agent Dispatcher |
| TASK_CREATED | 用户创建任务 | Task Dispatcher |
| TASK_ASSIGNED | 任务分配给 Agent | Agent Invoker |
| AGENT_STARTED | Agent 开始处理 | Agent Monitor |
| PATCH_GENERATED | Agent 生成代码改动 | Review System |
| PATCH_APPROVED | 用户批准 Patch | Apply Handler |
| PATCH_APPLIED | Patch 应用到文件 | File System, Runtime Update |
| AGENT_FINISHED | Agent 完成任务 | Task State Update |
| DEPLOYMENT_STARTED | 触发部署 | Deployment Orchestrator |

### 4.3 事件消费方式

```
Event Bus (Redis Streams / Bull Queue)
    │
    ├─► Persistence (Postgres)
    ├─► WebSocket Broadcast
    ├─► Agent State Update
    ├─► Task State Machine
    ├─► Deployment Pipeline
    └─► Analytics / Audit
```

## 5. Agent 协作系统

### 5.1 Agent 类型 (MVP)

```
PM Agent
├─ Role: 产品和项目管理
├─ Triggers: 需求描述
├─ Tools: 
│  ├─ create_task
│  ├─ list_tasks
│  ├─ analyze_requirements
│  └─ create_subtasks
└─ Output: 任务分解

Frontend Agent
├─ Role: 前端开发
├─ Triggers: 前端任务
├─ Tools:
│  ├─ read_file
│  ├─ search_code
│  ├─ create_patch
│  ├─ run_npm_command
│  └─ preview_changes
└─ Output: 代码改动

Backend Agent
├─ Role: 后端开发
├─ Triggers: 后端任务
├─ Tools:
│  ├─ read_file
│  ├─ search_code
│  ├─ create_patch
│  ├─ run_test
│  └─ database_operations
└─ Output: 代码改动
```

### 5.2 Agent 通信模式

#### 模式 1: 顺序执行 (Sequence)
```
Task Created
    ↓
PM Agent 分解任务
    ↓
Frontend Agent 处理前端任务
    ↓
Backend Agent 处理后端任务
    ↓
Task Completed
```

#### 模式 2: 并行执行 (Parallel)
```
Task Created
    ↓
├─► Frontend Agent
├─► Backend Agent
└─► PM Agent (监督)
    ↓
Task Completed
```

#### 模式 3: Agent-to-Agent 通信
```
Frontend Agent
    ↓
(发送消息: "需要后端 API: /api/users")
    ↓
Backend Agent
    ↓
(生成 API 文档)
```

### 5.3 Tool 系统

#### Tool 定义

```typescript
interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  handler: (params: any) => Promise<any>
  rateLimit?: {
    maxCalls: number
    windowMs: number
  }
}
```

#### MVP Tools

```
Core Tools:
├─ read_file(path: string)
├─ list_files(path: string)
├─ search_code(query: string, path?: string)
├─ create_patch(filepath: string, oldContent: string, newContent: string)
└─ run_terminal(command: string, timeout?: number)

Frontend-Specific:
├─ run_npm_command(command: string)
├─ preview_url(command?: string)
└─ screenshot()

Backend-Specific:
├─ run_test(path: string)
├─ database_query(sql: string)
└─ health_check()

Agent-Specific:
├─ create_task(description: string)
├─ assign_task(taskId: string, agentId: string)
└─ send_message(targetAgentId: string, content: string)
```

### 5.4 决策系统

**MVP 采用 Rule-Based Dispatch**：

```
Input Task
    │
    ├─ Parse task description
    │
    ├─ Keyword matching
    │   ├─ "前端" / "UI" / "component" → Frontend Agent
    │   ├─ "后端" / "API" / "database" → Backend Agent
    │   └─ "需求" / "分解" / "plan" → PM Agent
    │
    ├─ Create Task
    │
    └─ Dispatch to Agent
```

未来迭代可升级为：
- LLM-based classification
- Multi-hop reasoning
- Skill-based matching

## 6. Chat 系统设计

### 6.1 消息流

```typescript
interface Message {
  id: string
  conversationId: string
  authorId: string // userId or agentId
  authorType: 'user' | 'agent'
  content: string
  contentType: 'text' | 'code' | 'markdown'
  mentions?: string[] // @agent mentions
  attachments?: Attachment[]
  streaming?: boolean
  createdAt: Date
  editedAt?: Date
  reactions?: Reaction[]
}
```

### 6.2 实时更新

使用 Socket.io 提供实时消息：

```
Client Subscribe → Message Event
                 → Agent Thinking
                 → Patch Generated
                 → Deployment Status
```

## 7. Code Diff & Review

### 7.1 Patch 工作流

```
Agent generates code
    ↓
Create Patch (git diff format)
    ↓
Send to Chat (展示 diff)
    ↓
User reviews & comments
    ↓
User approves
    ↓
Apply Patch to files
    ↓
Runtime updated
    ↓
Preview refreshed
```

### 7.2 Patch 格式

```diff
--- a/src/components/Button.tsx
+++ b/src/components/Button.tsx
@@ -1,5 +1,7 @@
 import React from 'react'
 
+// Improved button component
 export const Button = () => {
   return <button>Click</button>
 }
```

## 8. Runtime Sandbox

### 8.1 容器隔离

每个 Workspace 拥有独立 Docker 容器：

```
Workspace
    ↓
Docker Container
├─ Image: node:20-alpine
├─ Volume: /workspace
├─ Ports: 3000 (app), 5000 (preview)
├─ Env: NODE_ENV, API_KEY etc
└─ Resources: 2GB RAM, 2 CPU
```

### 8.2 Runtime 操作

```typescript
interface RuntimeManager {
  create(workspaceId: string): Promise<Runtime>
  start(runtimeId: string): Promise<void>
  stop(runtimeId: string): Promise<void>
  exec(runtimeId: string, command: string): Promise<string>
  getPreviewUrl(runtimeId: string): string
  getStatus(runtimeId: string): RuntimeStatus
}
```

## 9. 部署系统

### 9.1 部署流程

```
Approved Changes
    ↓
Build (npm run build)
    ↓
Tests (npm run test)
    ↓
Deploy to Vercel/Railway
    ↓
Health Check
    ↓
Update Preview URL
    ↓
Notify in Chat
```

### 9.2 Deployment 数据模型

```typescript
interface Deployment {
  id: string
  workspaceId: string
  commitSha: string
  status: 'pending' | 'building' | 'success' | 'failed'
  logs: string
  deployedUrl: string
  deployedAt: Date
  rolledBackAt?: Date
}
```

## 10. 状态管理

### 10.1 Workspace 状态机

```
                ┌──────────────┐
                │   Created    │
                └──────┬───────┘
                       │
                ┌──────▼──────┐
                │  Initialized │
                └──────┬───────┘
                       │
        ┌──────────────┬──────────────┐
        │              │              │
   ┌────▼──┐   ┌──────▼──┐   ┌──────▼──┐
   │ Active │   │ Paused  │   │ Archived│
   └────┬───┘   └─────────┘   └─────────┘
        │
   ┌────▼───┐
   │ Error  │
   └────────┘
```

### 10.2 Task 状态机

```
pending → assigned → in_progress → completed
  ↑                      ↓
  └─────── blocked ◄─────┘
  ↓
rejected
```

## 11. 数据持久化

### 11.1 数据库设计

```
Tables:
├─ users
├─ workspaces
├─ conversations
├─ messages
├─ tasks
├─ subtasks
├─ patches
├─ files
├─ file_versions
├─ agents
├─ runtimes
├─ deployments
├─ events
└─ audit_logs
```

### 11.2 缓存策略

```
Redis Keys:
├─ workspace:{id}:state
├─ conversation:{id}:messages (sorted set)
├─ agent:{id}:status
├─ task:{id}:state
├─ runtime:{id}:preview_url
└─ user:{id}:online_status
```

## 12. 安全性

### 12.1 认证 & 授权

```
Auth Flow:
User Login
    ↓
JWT Token (access + refresh)
    ↓
Socket.io Authentication
    ↓
API Authorization (role-based)
```

### 12.2 沙箱隔离

```
- Docker 容器网络隔离
- 文件权限隔离
- 环境变量隔离
- Tool 权限控制
```

## 13. 可观测性

### 13.1 日志

```
Levels: DEBUG | INFO | WARN | ERROR | FATAL

Categories:
├─ Chat & Messaging
├─ Agent Execution
├─ Task Processing
├─ Runtime Operations
├─ Deployment Pipeline
└─ System Events
```

### 13.2 Metrics

```
Key Metrics:
├─ Agent execution time
├─ Patch generation rate
├─ Task completion rate
├─ Runtime CPU/Memory
├─ Deploy success rate
└─ Chat message latency
```

## 14. 扩展性设计

### 14.1 无锁通信

- 所有 Agent 通信通过 Event Bus
- 避免直接 RPC 调用
- 支持异步处理

### 14.2 可扩展的 Agent 系统

```
New Agent 需要实现:
├─ Role definition
├─ System prompt (packages/prompts)
├─ Tools list
├─ Dispatch rules
└─ Output schema
```

### 14.3 可扩展的 Tool 系统

```
New Tool 需要:
├─ Tool definition
├─ Parameters schema
├─ Handler implementation
├─ Rate limiting
└─ Error handling
```

---

**版本**: v0.1.0 MVP  
**最后更新**: 2026-05-13  
**所有者**: Architecture Team
