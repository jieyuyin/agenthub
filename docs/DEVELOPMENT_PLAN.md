# 1 个月 MVP 开发计划

## 项目概览

**目标**: 交付可工作的多 Agent 协作平台  
**时间**: 2026-05-13 ~ 2026-06-13 (30 天)  
**团队**: 1 人  
**模式**: 严格的 MVP 原则，分阶段交付

## 时间分配

```
Week 1: 基础架构搭建 (5 天)
Week 2: Chat & Agent 基础 (5 天)
Week 3: Task & Code Diff (5 天)
Week 4: Runtime & Preview & Deploy (5 天)

缓冲: 2 周内完成 = 每周减少 1 天以预留调试时间
```

## 第一周：基础架构搭建 (5 天)

### Day 1-2: Monorepo 环境 + 基础框架

**目标**: 完整的开发环境和基础代码框架

**任务**:
- [ ] Monorepo 初始化 (pnpm workspaces)
- [ ] 前端框架搭建 (Next.js 15 + Tailwind + shadcn/ui)
- [ ] 后端框架搭建 (Fastify + TypeScript)
- [ ] 共享类型定义 (packages/shared)
- [ ] Docker 环境准备
- [ ] GitHub 仓库初始化

**输出**:
```
✓ 完整的 Monorepo 结构
✓ 前端可运行 (npm run dev)
✓ 后端可运行 (npm run dev)
✓ 共享类型编译无错
```

**关键文件**:
- `apps/web/package.json`
- `apps/api/package.json`
- `apps/web/next.config.js`
- `apps/api/src/server.ts`
- `packages/shared/src/types.ts`

### Day 3: 数据库 + 认证框架

**目标**: 完整的数据库和认证系统

**任务**:
- [ ] PostgreSQL 数据库初始化
- [ ] Prisma schema 定义 (basic tables)
- [ ] 数据库迁移脚本
- [ ] JWT 认证实现
- [ ] 用户注册/登录 API

**输出**:
```
✓ Database migrations 可运行
✓ 用户认证 API 工作
✓ JWT 令牌生成和验证
```

**数据库表 (第一版)**:
- users
- workspaces
- conversations
- messages
- tasks
- patches

**关键文件**:
- `prisma/schema.prisma`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/db/migrations/001_init.sql`

### Day 4: Event Bus + Socket.io 基础

**目标**: 实时通信基础

**任务**:
- [ ] Redis 连接
- [ ] Event Bus 实现 (Redis Streams 或 Bull)
- [ ] Socket.io 服务器初始化
- [ ] 基础事件处理
- [ ] 前端 Socket.io 客户端

**输出**:
```
✓ 可发送和接收事件
✓ WebSocket 连接工作
✓ 基本的消息广播
```

**关键文件**:
- `apps/api/src/events/event-bus.ts`
- `apps/api/src/websocket/socket.handler.ts`
- `apps/web/src/lib/socket.ts`

### Day 5: 基础 UI 框架

**目标**: 完整的布局和导航

**任务**:
- [ ] 主布局组件
- [ ] 导航栏
- [ ] 侧边栏 (Workspace 列表)
- [ ] Chat 区域占位符
- [ ] Tasks 区域占位符
- [ ] 文件树占位符

**输出**:
```
✓ 可点击导航
✓ 响应式布局
✓ 暗黑模式支持
```

**关键文件**:
- `apps/web/src/components/Layout.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/pages/workspace/[id].tsx`

---

## 第二周：Chat & Agent 基础 (5 天)

### Day 6: Chat 系统第一版

**目标**: 完整的聊天功能

**任务**:
- [ ] Chat 消息数据模型
- [ ] 消息发送 API
- [ ] 消息列表 API (分页)
- [ ] 消息流式接收 (Socket.io)
- [ ] Chat UI 组件
- [ ] Markdown 渲染
- [ ] 代码块渲染

**输出**:
```
✓ 用户可发送消息
✓ 消息实时显示
✓ 支持 Markdown 和代码块
```

**关键文件**:
- `apps/api/src/chat/message.controller.ts`
- `apps/api/src/chat/message.service.ts`
- `apps/web/src/components/Chat/ChatWindow.tsx`
- `apps/web/src/components/Chat/MessageList.tsx`
- `apps/web/src/components/Chat/MessageInput.tsx`

### Day 7: Agent 框架第一版

**目标**: Agent 系统基础

**任务**:
- [ ] Agent 定义和数据模型
- [ ] Agent Manager 服务
- [ ] 简单的 Task Dispatcher
- [ ] Agent 状态管理
- [ ] 基础 Tool 系统
- [ ] Tool Registry

**输出**:
```
✓ 可创建 Agent
✓ 可分配 Task 给 Agent
✓ Agent 状态可追踪
```

**关键文件**:
- `packages/ai/src/agent/agent.types.ts`
- `apps/api/src/agent/agent.service.ts`
- `apps/api/src/agent/agent.dispatcher.ts`
- `packages/ai/src/tool/tool-registry.ts`

### Day 8: OpenAI 集成 + 第一个 Agent

**目标**: 实现 PM Agent

**任务**:
- [ ] OpenAI SDK 集成
- [ ] PM Agent prompt 定义 (packages/prompts)
- [ ] PM Agent 实现
- [ ] 基础 Tool 实现 (list_files, read_file, search_code)
- [ ] Agent execution loop
- [ ] Error handling

**输出**:
```
✓ PM Agent 可调用
✓ PM Agent 可生成任务分解
✓ Tool 调用工作
```

**关键文件**:
- `packages/prompts/agents/pm.md`
- `apps/api/src/agent/implementations/pm-agent.ts`
- `apps/api/src/tool/implementations/file-tools.ts`

### Day 9: Chat 整合 Agent

**目标**: 用户在 Chat 中与 Agent 交互

**任务**:
- [ ] Chat 消息路由到 Agent
- [ ] Agent 响应流式返回到 Chat
- [ ] Agent thinking 显示
- [ ] Agent 状态在 Chat 中显示
- [ ] @mention Agent

**输出**:
```
✓ 用户 @pm 在 Chat 中调用 PM Agent
✓ PM Agent 的响应流式显示
✓ 实时状态更新
```

**关键文件**:
- `apps/api/src/chat/chat.service.ts` (Agent dispatcher)
- `apps/web/src/components/Chat/ChatMessage.tsx`

### Day 10: 前两个 Agent (Frontend + Backend)

**目标**: 完整的多 Agent 支持

**任务**:
- [ ] Frontend Agent 实现 (prompts + logic)
- [ ] Backend Agent 实现 (prompts + logic)
- [ ] Tool 扩展 (run_terminal, run_test)
- [ ] Agent dispatch 规则优化
- [ ] Agent 间通信基础

**输出**:
```
✓ 3 个 Agent 可用 (PM, Frontend, Backend)
✓ 可自动分配 Task 到对应 Agent
✓ 基本的 Agent 间通信
```

**关键文件**:
- `packages/prompts/agents/frontend.md`
- `packages/prompts/agents/backend.md`
- `apps/api/src/agent/implementations/frontend-agent.ts`
- `apps/api/src/agent/implementations/backend-agent.ts`

---

## 第三周：Task & Code Diff (5 天)

### Day 11: Task 系统

**目标**: 完整的任务管理

**任务**:
- [ ] Task 数据模型
- [ ] Task CRUD API
- [ ] Task 状态机
- [ ] Task 分配给 Agent
- [ ] Task 列表 UI
- [ ] Task 详情 UI

**输出**:
```
✓ 可创建、编辑、删除 Task
✓ 可分配 Task 给 Agent
✓ Task 状态流转工作
```

**关键文件**:
- `apps/api/src/task/task.controller.ts`
- `apps/api/src/task/task.service.ts`
- `apps/web/src/components/Tasks/TaskList.tsx`
- `apps/web/src/components/Tasks/TaskDetail.tsx`

### Day 12: Code Diff & Patch 系统

**目标**: 生成和应用代码改动

**任务**:
- [ ] Patch 数据模型
- [ ] Patch 生成逻辑 (git diff format)
- [ ] Patch 存储
- [ ] Patch 审核工作流
- [ ] Patch 应用到文件系统
- [ ] Diff 显示 UI

**输出**:
```
✓ Agent 可生成 Patch
✓ 用户可审核 Patch
✓ Patch 可应用到文件
```

**关键文件**:
- `apps/api/src/patch/patch.controller.ts`
- `apps/api/src/patch/patch.service.ts`
- `apps/web/src/components/Diff/DiffViewer.tsx`

### Day 13: Agent → Patch 工作流

**目标**: 完整的代码生成和 Review

**任务**:
- [ ] Agent Tool: create_patch
- [ ] Agent 生成 Patch
- [ ] Patch 发送到 Chat
- [ ] 用户 Approve/Reject
- [ ] Patch 应用
- [ ] 文件更新

**输出**:
```
✓ 完整的 Agent → Patch → Review → Apply 工作流
✓ 用户可批准改动
```

**关键文件**:
- `apps/api/src/tool/implementations/patch-tools.ts`
- `apps/api/src/patch/patch-apply.service.ts`

### Day 14: 文件系统 UI

**目标**: 完整的文件管理 UI

**任务**:
- [ ] 文件树组件
- [ ] 文件浏览
- [ ] 文件打开在编辑器
- [ ] 文件版本历史
- [ ] 集成 Monaco Editor

**输出**:
```
✓ 完整的文件浏览功能
✓ 可在 Monaco 中编辑（初步）
```

**关键文件**:
- `apps/web/src/components/FileTree/FileTree.tsx`
- `apps/web/src/components/Editor/CodeEditor.tsx`

### Day 15: Task Breakdown 工作流

**目标**: 需求到代码的完整流程

**任务**:
- [ ] 用户输入需求
- [ ] PM Agent 分解任务
- [ ] 多个 Sub-task 创建
- [ ] 自动分配给对应 Agent
- [ ] Agent 并行或串行执行
- [ ] 任务状态聚合

**输出**:
```
✓ 完整的需求分解流程
✓ 多个 Agent 并行工作
✓ Task 状态追踪
```

---

## 第四周：Runtime & Preview & Deploy (5 天)

### Day 16: Runtime Sandbox

**目标**: Docker 隔离环境

**任务**:
- [ ] Docker 容器管理
- [ ] 容器初始化 (Node.js 环境)
- [ ] npm install / npm run dev
- [ ] 命令执行接口
- [ ] 日志收集
- [ ] Resource limit

**输出**:
```
✓ 可创建 Runtime 容器
✓ 可在容器中执行命令
✓ 可查看容器日志
```

**关键文件**:
- `apps/api/src/runtime/runtime.service.ts`
- `apps/api/src/runtime/docker-manager.ts`
- `infra/docker/Dockerfile.workspace`

### Day 17: Terminal & Command Execution

**目标**: 实时终端

**任务**:
- [ ] WebSocket 终端接口
- [ ] 命令流式输出
- [ ] 终端历史
- [ ] 命令行补全（可选）
- [ ] Terminal UI 组件

**输出**:
```
✓ 用户可打开终端
✓ 可执行命令并看到输出
✓ 实时流式输出
```

**关键文件**:
- `apps/api/src/terminal/terminal.handler.ts`
- `apps/web/src/components/Terminal/Terminal.tsx`

### Day 18: Preview Server

**目标**: 实时预览功能

**任务**:
- [ ] Reverse proxy 配置
- [ ] 预览 URL 生成
- [ ] iframe 嵌入
- [ ] 预览刷新逻辑
- [ ] 预览错误处理

**输出**:
```
✓ npm run dev 的应用可预览
✓ 代码改动后可刷新预览
```

**关键文件**:
- `apps/api/src/preview/preview.service.ts`
- `apps/web/src/components/Preview/PreviewPanel.tsx`

### Day 19: 部署系统

**目标**: 一键部署

**任务**:
- [ ] Vercel/Railway 集成
- [ ] Build 和 deploy 流程
- [ ] 部署状态追踪
- [ ] Deployment API
- [ ] Deployment UI

**输出**:
```
✓ 可触发部署
✓ 部署状态实时更新
✓ 部署 URL 生成
```

**关键文件**:
- `apps/api/src/deployment/deployment.service.ts`
- `apps/api/src/deployment/vercel-client.ts`

### Day 20: 集成测试 + 完善

**目标**: 完整的 E2E 工作流

**任务**:
- [ ] E2E 测试 (需求 → 部署)
- [ ] Bug 修复
- [ ] 性能优化
- [ ] 部署脚本
- [ ] 文档完善

**输出**:
```
✓ 完整的 MVP 工作流可演示
✓ 部署到演示环境
```

---

## 每日 Checklist

### 模板

```
【Day N: [功能名]】
目标: [一句话]
完成情况:
- [ ] 任务 1
- [ ] 任务 2
- [ ] 任务 3

遇到的问题:
- 问题 1: 解决方案
- 问题 2: 解决方案

输出物:
✓ 文件/功能
✓ 测试
✓ 文档

明天计划:
- 开始 Day N+1
```

---

## 代码组织原则

### MVP 不要做的:
- ❌ 复杂的 Component 库
- ❌ 过度抽象
- ❌ 完整的单元测试覆盖
- ❌ 性能优化
- ❌ 复杂的 state management (Zustand 够用)
- ❌ PWA / Offline
- ❌ i18n

### MVP 必须做的:
- ✅ 可运行的完整功能
- ✅ 类型安全 (TypeScript)
- ✅ 错误处理
- ✅ 基础的 E2E 工作流测试
- ✅ 文档（这个文档）
- ✅ 环境变量管理 (.env)

---

## 关键决策和权衡

### 1. 认证系统
- **选择**: JWT + HTTP-Only Cookie
- **理由**: 简单、无状态、支持多服务
- **替代**: OAuth（太复杂）

### 2. 数据库
- **选择**: PostgreSQL + Prisma
- **理由**: 强类型、迁移安全、生态好
- **替代**: MongoDB（不需要 NoSQL 灵活性）

### 3. 实时通信
- **选择**: Socket.io + Redis
- **理由**: 成熟、支持多进程、有 fallback
- **替代**: WebSocket 原生（太底层）

### 4. Agent 调度
- **选择**: Rule-based dispatcher
- **理由**: 快速、可控、无 LLM 成本
- **替代**: LLM-based（不必要，也增加成本）

### 5. Runtime
- **选择**: Docker containers
- **理由**: 隔离安全、可扩展
- **替代**: VM（太重）、Node.js subprocess（不安全）

---

## 风险和缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Agent Tool Calling 不稳定 | 影响核心功能 | 早期集成测试、详细的 error handling |
| 性能瓶颈 (WebSocket/DB) | 用户体验差 | 先功能完整，后性能优化 |
| Docker 容器管理复杂 | 开发延迟 | 使用托管的 Docker 服务或简化版本 |
| 部署集成困难 | 无法演示 | 优先支持 Vercel (简单) |

---

## 成功标准

### MVP 必须包含:
- ✅ 多 Agent 协作
- ✅ Chat 系统
- ✅ Task 管理
- ✅ 代码 Diff & Review
- ✅ Runtime 预览
- ✅ 一键部署

### 可演示的场景:

```
场景 1: 需求 → PM Agent 分解 → Frontend Agent 开发 → Preview
场景 2: 完整的代码修改工作流 (Agent → Patch → Review → Apply)
场景 3: 部署演示
```

---

**版本**: v1.0 MVP Plan  
**创建日期**: 2026-05-13  
**目标发布**: 2026-06-13
