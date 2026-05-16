# AgentHub API 设计文档

## 概览

本文档描述 AgentHub 后端 API 的完整设计。

**基础 URL**: `https://api.agenthub.local`  
**认证**: JWT Bearer Token  
**响应格式**: JSON  
**版本**: v1

## 通用响应格式

所有 API 响应遵循统一格式：

### 成功响应 (2xx)
```json
{
  "data": { /* 实际数据 */ },
  "timestamp": "2026-05-13T10:30:00Z"
}
```

### 错误响应 (4xx/5xx)
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { /* 可选的详情 */ }
  },
  "timestamp": "2026-05-13T10:30:00Z"
}
```

## 认证

所有需要认证的请求在 Header 中包含 JWT Token：

```
Authorization: Bearer <jwt_token>
```

### 认证流程

#### 用户注册
```
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password",
  "name": "User Name"
}

Response: 201 Created
{
  "data": {
    "user": { /* user object */ },
    "token": "jwt_token",
    "refreshToken": "refresh_token"
  }
}
```

#### 用户登录
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password"
}

Response: 200 OK
{
  "data": {
    "user": { /* user object */ },
    "token": "jwt_token",
    "refreshToken": "refresh_token"
  }
}
```

#### Token 刷新
```
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "refresh_token"
}

Response: 200 OK
{
  "data": {
    "token": "new_jwt_token"
  }
}
```

## Workspace API

### 创建 Workspace

```
POST /api/workspaces
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Project",
  "description": "Project description"
}

Response: 201 Created
{
  "data": {
    "id": "ws-123",
    "name": "My Project",
    "description": "Project description",
    "ownerId": "user-1",
    "members": [ { "userId": "user-1", "role": "admin" } ],
    "status": "active",
    "createdAt": "2026-05-13T10:30:00Z",
    "updatedAt": "2026-05-13T10:30:00Z"
  }
}
```

### 获取 Workspace 列表

```
GET /api/workspaces?page=1&pageSize=20
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [ /* workspace objects */ ],
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "hasMore": true
  }
}
```

### 获取单个 Workspace

```
GET /api/workspaces/:id
Authorization: Bearer <token>

Response: 200 OK
{
  "data": { /* workspace object */ }
}
```

### 更新 Workspace

```
PATCH /api/workspaces/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description"
}

Response: 200 OK
{
  "data": { /* updated workspace object */ }
}
```

### 删除 Workspace

```
DELETE /api/workspaces/:id
Authorization: Bearer <token>

Response: 204 No Content
```

## Conversation API

### 创建 Conversation

```
POST /api/workspaces/:id/conversations
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "group",
  "title": "Feature Development",
  "description": "Discussing new features"
}

Response: 201 Created
{
  "data": { /* conversation object */ }
}
```

### 获取 Conversation 列表

```
GET /api/workspaces/:id/conversations
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [ /* conversation objects */ ],
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "hasMore": true
  }
}
```

### 发送消息

```
POST /api/conversations/:id/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "Hello @frontend, please create the login form",
  "contentType": "markdown",
  "mentions": ["agent-frontend"]
}

Response: 201 Created
{
  "data": { /* message object */ }
}
```

### 获取消息列表

```
GET /api/conversations/:id/messages?limit=50&offset=0
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [ /* message objects */ ],
    "total": 500,
    "hasMore": true
  }
}
```

### 消息流式输出

对于需要实时输出的消息（如 Agent 生成中），使用 Server-Sent Events (SSE)：

```
GET /api/conversations/:id/messages/:messageId/stream
Authorization: Bearer <token>

Response: 200 OK (text/event-stream)

data: {"type":"thinking","content":"Analyzing requirements..."}
data: {"type":"content","content":"1. Create form UI\n"}
data: {"type":"tool_call","tool":"create_patch","params":{...}}
data: {"type":"complete"}
```

## Task API

### 创建 Task

```
POST /api/workspaces/:id/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "conversationId": "conv-123",
  "title": "Create login form",
  "description": "Frontend: Create a login form component...",
  "assignedAgentId": "agent-frontend",
  "priority": 1,
  "acceptance_criteria": [
    "Form has email and password fields",
    "Form validates input",
    "Form sends POST to /api/auth/login"
  ]
}

Response: 201 Created
{
  "data": { /* task object */ }
}
```

### 获取 Task 列表

```
GET /api/workspaces/:id/tasks?status=in_progress&agentId=agent-1
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [ /* task objects */ ],
    "total": 25,
    "page": 1,
    "pageSize": 20,
    "hasMore": true
  }
}
```

### 获取单个 Task

```
GET /api/tasks/:id
Authorization: Bearer <token>

Response: 200 OK
{
  "data": { /* task object */ }
}
```

### 更新 Task

```
PATCH /api/tasks/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "in_progress",
  "assignedAgentId": "agent-frontend"
}

Response: 200 OK
{
  "data": { /* updated task object */ }
}
```

## Patch API

### 获取 Patch 列表

```
GET /api/tasks/:id/patches
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [ /* patch objects */ ],
    "total": 5
  }
}
```

### 获取 Patch 详情

```
GET /api/patches/:id
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "id": "patch-123",
    "taskId": "task-1",
    "content": "--- a/src/components/LoginForm.tsx\n+++ b/src/components/LoginForm.tsx\n...",
    "status": "review_requested",
    "diff": {
      "additions": 50,
      "deletions": 0,
      "files": ["src/components/LoginForm.tsx"]
    }
  }
}
```

### 批准 Patch

```
POST /api/patches/:id/approve
Authorization: Bearer <token>
Content-Type: application/json

{
  "reviewComments": "Looks good! Please proceed."
}

Response: 200 OK
{
  "data": { /* updated patch object */ }
}
```

### 应用 Patch

```
POST /api/patches/:id/apply
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "appliedAt": "2026-05-13T10:30:00Z",
    "filesUpdated": ["src/components/LoginForm.tsx"]
  }
}
```

## Agent API

### 获取 Agent 列表

```
GET /api/agents
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [
      {
        "id": "agent-pm",
        "name": "PM Agent",
        "role": "pm",
        "status": "idle"
      },
      {
        "id": "agent-frontend",
        "name": "Frontend Agent",
        "role": "frontend",
        "status": "busy"
      }
    ]
  }
}
```

### 调用 Agent

```
POST /api/agents/:id/invoke
Authorization: Bearer <token>
Content-Type: application/json

{
  "taskId": "task-123",
  "context": {
    "conversationHistory": [ /* messages */ ],
    "workspace": { /* workspace data */ }
  }
}

Response: 200 OK (使用 SSE 流式输出)
或
Response: 202 Accepted (异步处理)
{
  "data": {
    "executionId": "exec-456",
    "status": "running",
    "streamUrl": "/api/agents/executions/exec-456/stream"
  }
}
```

### 获取 Agent 执行历史

```
GET /api/agents/:id/executions?limit=20
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [ /* execution objects */ ],
    "total": 100
  }
}
```

## File API

### 获取文件树

```
GET /api/workspaces/:id/files?path=/src
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "files": [
      {
        "name": "App.tsx",
        "type": "file",
        "path": "/src/App.tsx",
        "size": 1024,
        "updatedAt": "2026-05-13T10:30:00Z"
      },
      {
        "name": "components",
        "type": "directory",
        "path": "/src/components"
      }
    ]
  }
}
```

### 读取文件

```
GET /api/files?path=/src/App.tsx&workspace=ws-123
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "path": "/src/App.tsx",
    "content": "export default function App() { ... }",
    "language": "typescript",
    "size": 1024
  }
}
```

### 搜索代码

```
GET /api/workspaces/:id/search?q=useEffect&fileType=tsx
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "results": [
      {
        "file": "/src/components/Button.tsx",
        "line": 10,
        "content": "  useEffect(() => {"
      }
    ]
  }
}
```

## Runtime API

### 获取 Runtime 状态

```
GET /api/runtimes/:id
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "id": "rt-123",
    "status": "ready",
    "previewUrl": "http://preview.local:3000",
    "createdAt": "2026-05-13T10:00:00Z"
  }
}
```

### 执行命令

```
POST /api/runtimes/:id/exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "command": "npm run build",
  "timeout": 30000
}

Response: 200 OK
{
  "data": {
    "exitCode": 0,
    "stdout": "Building...\n✓ Build successful",
    "stderr": "",
    "duration": 5000
  }
}
```

### 获取 Preview URL

```
GET /api/runtimes/:id/preview
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "url": "http://preview-abc123.local"
  }
}
```

## Deployment API

### 创建 Deployment

```
POST /api/workspaces/:id/deployments
Authorization: Bearer <token>
Content-Type: application/json

{
  "environment": "production",
  "commitSha": "abc123def456"
}

Response: 201 Created
{
  "data": {
    "id": "deploy-789",
    "status": "pending",
    "createdAt": "2026-05-13T10:30:00Z"
  }
}
```

### 获取部署历史

```
GET /api/workspaces/:id/deployments?limit=10
Authorization: Bearer <token>

Response: 200 OK
{
  "data": {
    "items": [ /* deployment objects */ ],
    "total": 50
  }
}
```

### 获取部署日志

```
GET /api/deployments/:id/logs
Authorization: Bearer <token>

Response: 200 OK (text/event-stream)

data: {"type":"building","message":"Building project..."}
data: {"type":"log","message":"✓ Build successful"}
data: {"type":"deploying","message":"Deploying to Vercel..."}
data: {"type":"success","url":"https://myapp.vercel.app"}
```

## WebSocket 事件

客户端通过 WebSocket 订阅实时事件：

```
WS /socket?token=<jwt_token>
```

### 事件格式

```json
{
  "type": "EVENT_TYPE",
  "data": { /* 事件数据 */ },
  "timestamp": "2026-05-13T10:30:00Z"
}
```

### 支持的事件

```
MESSAGE_CREATED
TASK_CREATED
TASK_UPDATED
PATCH_GENERATED
PATCH_APPLIED
AGENT_STARTED
AGENT_FINISHED
AGENT_OUTPUT (流式输出)
DEPLOYMENT_STARTED
DEPLOYMENT_COMPLETED
RUNTIME_STATUS_CHANGED
FILE_UPDATED
```

## 错误码

| 代码 | 状态 | 说明 |
|------|------|------|
| UNAUTHORIZED | 401 | 未认证 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| INVALID_INPUT | 400 | 输入验证失败 |
| CONFLICT | 409 | 资源冲突 |
| RATE_LIMITED | 429 | 请求过多 |
| INTERNAL_ERROR | 500 | 服务器错误 |

## 速率限制

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1620000000
```

- 普通用户: 1000 requests/hour
- Agent 调用: 10000 requests/hour

## 分页

所有列表端点支持分页：

```
?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc
```

---

**API 版本**: v1.0  
**最后更新**: 2026-05-13
