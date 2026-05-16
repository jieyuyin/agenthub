# AgentHub

**AI Native Software Collaboration Platform** — 多 Agent 协作的智能开发工作空间

## 概述

AgentHub 是一个基于 AI 的团队协作平台，核心价值是：

- 🤖 **多 Agent 协作** - PM、Frontend、Backend Agent 协同工作
- 💬 **实时协作聊天** - 类似 Slack 的群聊系统
- 🎯 **自动任务分解** - 需求自动拆解为可执行任务
- 📝 **代码 Review 工作流** - Agent 生成代码，用户审核后应用
- 🚀 **完整开发闭环** - 从聊天到部署的端到端工作流
- 🐳 **隔离运行时** - Docker 容器提供安全的代码执行环境
- 👀 **实时预览** - 即时查看代码改动效果
- 🌐 **一键部署** - 直接部署到 Vercel/Railway

## 核心区别

| | 普通 AI Chat | AgentHub |
|---|---|---|
| 交互方式 | 1:1 对话 | 多 Agent 群聊 |
| Agent 数量 | 1 个超级 Agent | 多个专业 Agent |
| 工作方式 | 手动循环 | 自动化工作流 |
| 代码改动 | 生成代码文本 | Patch + Review + Apply |
| 运行环境 | 无 | Docker 隔离容器 |
| 预览功能 | 无 | 实时在线预览 |
| 部署 | 无 | 集成部署系统 |

## 快速开始

### 前置要求
- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Docker (用于 Runtime)
- PostgreSQL 数据库
- Redis

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/agenthub.git
cd agenthub

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env.local

# 数据库迁移
pnpm run db:migrate

# 启动开发服务器
pnpm run dev
```

访问 http://localhost:3000

### 项目结构

```
agenthub/
├── apps/
│   ├── web/              # Next.js 前端
│   │   ├── src/
│   │   │   ├── app/      # App Router
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   └── styles/
│   │   └── package.json
│   └── api/              # Fastify 后端
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── db/
│       │   └── websocket/
│       └── package.json
├── packages/
│   ├── ui/               # UI 组件库
│   ├── shared/           # 共享类型和工具
│   ├── ai/               # Agent & Tool 系统
│   ├── prompts/          # Agent Prompts (不编译)
│   └── agent-runtime/    # Agent 执行时环境
├── infra/
│   ├── docker/           # Docker 配置
│   └── scripts/          # 部署脚本
├── docs/
│   ├── architecture/     # 系统设计文档
│   ├── api/              # API 文档
│   └── agents/           # Agent 说明
├── package.json
├── turbo.json
└── tsconfig.base.json
```

## 核心概念

### Workspace
一个隔离的工作空间，包含：
- 聊天记录
- 任务列表
- 代码文件
- 独立的 Docker 容器
- 部署历史

### Conversation
实时协作聊天，支持：
- 多个参与者（用户 + Agents）
- @mention 特定 Agent
- Markdown 和代码块
- 实时流式输出

### Agent
专业的 AI 助手，包括：
- **PM Agent**: 需求分析、任务分解
- **Frontend Agent**: UI/UX 实现
- **Backend Agent**: API 开发、数据库

### Task
可执行的工作单位：
- 由 PM Agent 生成
- 自动分配给专业 Agent
- 生成代码 Patch
- 用户审核 → 应用

### Patch
代码改动提案：
- Git diff 格式
- 显示在聊天中供审核
- 用户批准后应用
- 保留完整历史

### Runtime
隔离的执行环境：
- 独立 Docker 容器
- Node.js 应用运行环境
- npm install / npm run dev
- 文件变更实时同步

## 工作流示例

### 场景：开发一个用户登录功能

**第一步：提需求**
```
User: "我需要开发用户登录功能，包括表单和后端 API"
```

**第二步：PM Agent 分解**
PM Agent 分析需求后：
```
✓ Task 1: 创建登录表单 UI (分配给 Frontend Agent)
✓ Task 2: 实现登录 API (分配给 Backend Agent)
✓ Task 3: 数据库用户表设计 (分配给 Backend Agent)
✓ Task 4: 集成 JWT 认证 (分配给 Backend Agent)
```

**第三步：Frontend Agent 开发**
Frontend Agent 读取项目结构，使用 Tailwind 创建登录表单：
```
Agent: 我已创建登录表单组件
📝 查看 Diff: src/components/LoginForm.tsx

用户审核代码改动，然后点击 ✓ Approve
```

**第四步：Backend Agent 开发**
Backend Agent 实现登录 API：
```
Agent: 我已实现 POST /api/auth/login 端点
📝 查看 Diff: src/api/routes/auth.ts

💡 前端需要的 API 响应格式：
{
  token: string,
  user: { id, email, name }
}
```

**第五步：用户批准改动**
用户在 Diff 中审查，然后点击 Apply：
```
✓ Frontend Patch Applied (files synced to runtime)
✓ Backend Patch Applied
🔄 Runtime restarted
👀 Preview refreshed
```

**第六步：预览和测试**
```
User 在 Preview 中测试登录表单
→ 填写邮箱和密码
→ 看到成功登录
→ 得到 JWT Token
```

**第七步：部署**
```
User: "@pm 部署这个功能到生产"

System: 
✓ Building...
✓ Running tests...
✓ Deploying to Vercel...
✓ Live at: https://myapp.vercel.app
```

## 系统架构

### 分层架构

```
┌─────────────────────────────────────┐
│  Frontend (Next.js)                 │
│  Chat | Tasks | Editor | Preview    │
└────────────┬────────────────────────┘
             │ WebSocket / HTTP
┌────────────▼────────────────────────┐
│  API Server (Fastify)               │
│  Routes | Auth | Business Logic     │
└────────────┬────────────────────────┘
             │ Events
┌────────────▼────────────────────────┐
│  Event Bus (Redis Streams)          │
│  Persistence | Broadcast | Dispatch │
└─┬──────────┬──────────┬─────────────┘
  │          │          │
  ▼          ▼          ▼
┌────────┐ ┌─────────┐ ┌──────────────┐
│ Agent  │ │ Runtime │ │ Integrations │
│Engine  │ │ Manager │ │ (Vercel etc) │
└────────┘ └─────────┘ └──────────────┘
```

### 技术栈

**前端**:
- Next.js 15
- TypeScript
- Tailwind CSS
- shadcn/ui
- Monaco Editor
- Zustand (状态管理)
- Socket.io 客户端
- TanStack Query

**后端**:
- Node.js (runtime)
- Fastify (框架)
- TypeScript
- Prisma (ORM)
- PostgreSQL (数据库)
- Redis (缓存 & 事件)
- Socket.io (WebSocket)
- OpenAI SDK (LLM)

**基础设施**:
- Docker (容器)
- Vercel/Railway (部署)
- GitHub Actions (CI/CD)

## API 快速参考

### Chat API

```
POST /api/conversations/:id/messages
发送消息

WS /socket
实时消息

GET /api/conversations/:id/messages?limit=50&offset=0
获取消息列表
```

### Task API

```
POST /api/workspaces/:id/tasks
创建任务

PATCH /api/tasks/:id
更新任务状态

GET /api/workspaces/:id/tasks
列表任务
```

### Agent API

```
POST /api/agents/:id/invoke
调用 Agent

GET /api/agents
列表所有 Agent
```

## 开发指南

### 添加新的 Agent

1. 创建 prompt 文件: `packages/prompts/agents/my-agent.md`
2. 在 `packages/ai` 中实现 Agent 类
3. 在 dispatcher 中添加路由规则
4. 添加必要的 tools

### 添加新的 Tool

1. 定义 Tool schema
2. 实现 handler 函数
3. 注册到 Tool Registry
4. 添加到对应 Agent 的 tools 列表

### 调试 Agent

```bash
# 查看 Agent 日志
docker logs workspace-container-id

# 检查事件流
redis-cli
> XREAD COUNT 10 STREAMS agent-events $
```

## 文档

- [系统设计](./docs/architecture/SYSTEM_DESIGN.md)
- [Agent 系统](./docs/architecture/AGENT_SYSTEM_DESIGN.md)
- [API 文档](./docs/api/API.md)
- [开发计划](./docs/DEVELOPMENT_PLAN.md)

## 开发状态

### MVP (2026-06-13)
- [x] Monorepo 基础框架
- [ ] Chat 系统
- [ ] 3 个 Agent (PM, Frontend, Backend)
- [ ] Task 管理
- [ ] Code Diff & Review
- [ ] Docker Runtime
- [ ] Preview
- [ ] 部署系统

### Post-MVP 功能
- Vector embeddings for context
- Long-term memory
- More agents (DevOps, QA, Security)
- Plugin system
- Marketplace

## 贡献指南

我们欢迎贡献！请：

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 许可证

MIT

## 联系方式

- Issues: [GitHub Issues](https://github.com/yourusername/agenthub/issues)
- Email: hello@agenthub.dev

---

**AgentHub** - The AI Native Collaboration OS for Software Development
