# AgentHub

AgentHub 是一个面向软件研发场景的本地 Coding Agent 平台。它以 Project Assistant 作为统一交互入口，通过结构化 Intent Router 将普通对话直接回复，将项目任务路由至动态 Coding Worker Agent Loop；结合可切换工具后端、Docker Sandbox 与实时状态同步，自主完成代码检索、文件修改、命令执行、Git 操作及结果验证，并在复杂任务中按需调用专业 Subagent。

> 当前项目以“一个主 Coding Worker 自主循环执行，复杂时按需调用 Subagent”为核心，不采用固定的 Developer → Tester → Debugger 流水线。

## 当前已实现

- Electron 桌面端与本地 Workspace 授权
- 项目与多对话管理，对话运行状态相互隔离
- OpenAI-compatible API、Ollama 和本地模型配置
- 流式普通聊天与结构化 Intent Router
- Coding Worker Agent Loop
- 动态上下文管理与长对话自动压缩
- 文件读取、创建、写入和精确 Patch
- 一次性命令执行与常驻服务管理
- Git 状态、分支、Diff、克隆、拉取、切换和提交
- 工具执行阶段实时显示
- 修改完成后的文件统计和 Diff 抽屉
- Debug、Review、Explore Subagent 动态调度
- 三种项目运行模式：本地开发、Docker 运行和完全隔离 Sandbox
- Sandbox 工作副本、容器执行、冲突检测、安全同步与自动回收


## Agent 架构

```text
用户消息
   ↓
Project Assistant（统一交互入口）
   ↓
Intent Router
   ├─ chat
   ├─ inspect
   ├─ modify
   ├─ execute
   └─ diagnose
          ↓
   是否需要本地工具？
   ├─ 否 → 直接流式回复
   └─ 是 → Coding Worker
                    ↓
       Reasoning → Action → Tool
           ↑                  ↓
       Context Update ← Observation
                    ↓
          Complexity Evaluator
                    ↓
       必要时调用只读 Subagent
                    ↓
        验收条件满足后生成回复与 Diff
```

### Project Assistant

Project Assistant 是面向用户的统一助手身份和任务入口，不是另一套独立的代码执行 Agent。它负责接收项目对话、组织任务上下文、调用 Intent Router，并根据项目配置选择本地、Docker 运行或完全隔离模式；需要操作项目时，由 Coding Worker 负责实际的检索、修改、执行和验证。

### Intent Router

消息首先被转换成结构化路由结果：

```json
{
  "mode": "inspect",
  "needsTools": true,
  "continuePreviousTask": false,
  "intents": ["inspect_code"],
  "targets": [".auth-container"],
  "requiresWrite": false,
  "requiresVerification": false,
  "confidence": 0.95,
  "source": "rule"
}
```

明确意图使用本地规则快速判断；模糊或混合请求由模型输出结构化 JSON；模型路由异常时回退到安全的只读检查。

| 模式 | 行为 | 完成条件 |
| --- | --- | --- |
| `chat` | 寒暄、确认、普通问答 | 直接回答当前消息 |
| `inspect` | 查看代码、配置或状态 | 必须取得真实读取或状态证据 |
| `modify` | 修改文件或功能 | 必须真实写入并完成验证 |
| `execute` | 命令、Git、服务操作 | 必须取得真实工具结果 |
| `diagnose` | 报错、异常、失败排查 | 执行检查、定位、修复和验证闭环 |

### Coding Worker

Coding Worker 内部采用动态 Agent Loop：

```text
Reasoning
→ 选择一个 Action
→ 调用 Tool
→ 获取 Observation
→ 更新 Context
→ 判断是否完成
```

### Context Manager

- **Task Context**：目标、约束、验收条件和背景
- **Code Context**：按需搜索和读取到的代码
- **Execution Context**：工具调用、命令输出、测试结果和错误
- **Change Context**：修改文件、验证结果和 Diff

上下文不会一次加载整个项目。对话超过阈值后，较早消息会被压缩为结构化摘要，并保留最近原始消息。

### 记忆与上下文机制

Context Engine 按照用户、项目和对话三个作用域管理信息，并在每次请求前按需组装与当前问题相关的上下文：

- **会话记忆**：记录每个对话的用户消息和 Assistant 回复，维持当前任务的连续性。
- **上下文自动压缩**：根据估算 Token 数触发压缩，将较早消息整理为结构化摘要，同时保留最近原始消息，避免长对话超过模型上下文窗口。
- **用户长期记忆**：保存用户明确表达的事实和偏好，用于后续对话中的个性化响应。
- **全局记忆**：保存能够跨项目复用的信息，并通过全局 `MEMORY.md` 提供给后续任务。
- **项目级记忆**：为每个项目维护独立 `MEMORY.md`，隔离项目架构、约束、约定和历史决策。
- **显式记忆捕获**：识别“记住……”等明确指令，将内容写入对应作用域的长期记忆，而不是把所有聊天内容无差别永久保存。
- **项目知识上下文**：将授权项目中的文件和代码摘要按项目保存，并根据当前问题动态检索相关内容。
- **工具上下文**：记录近期文件读取、命令、Git、验证和 Diff 等工具结果，为后续步骤提供真实执行证据。
- **任务状态**：保存任务目标、当前状态和执行结果，使后续消息能够继续未完成的项目任务。

模型请求的上下文组装流程：

```text
当前消息
  ↓
识别对话与项目作用域
  ↓
检索会话摘要、长期记忆、项目知识和工具结果
  ↓
按相关性组装 Context
  ↓
Intent Router / Coding Worker
```

当前记忆主要通过 JSON 和 Markdown 文件持久化：

```text
apps/api/data/
├─ context-store.json
└─ memory/
   ├─ user-profile.json
   ├─ MEMORY.md
   └─ projects/{projectId}/MEMORY.md
```

Docker 部署时，以上数据保存在 `agenthub-api-data` volume 中，容器重建或普通 `docker compose down` 不会清除记忆。当前 Prisma/SQLite 主要承载业务与执行模型，记忆数据尚未全部迁移至数据库。

### Complexity 与 Subagent

每轮按照以下公式计算复杂度：

```text
Score = 0.25 × Failure
      + 0.25 × Uncertainty
      + 0.20 × Scope
      + 0.15 × Context
      + 0.15 × Risk
```

- Score `< 0.6`：Coding Worker 自己继续
- Score `>= 0.6`：允许调用专业 Subagent

可用 Subagent：

- **Debug Agent**：多次失败且根因不明确时分析问题
- **Review Agent**：认证、权限、支付、数据库等高风险修改完成后审查
- **Explore Agent**：影响范围或代码关系复杂时辅助探索

Subagent 当前为只读顾问，负责给出分析和建议；文件修改权仍由 Coding Worker 持有。

## 本地工具

### 文件

- `list_files`
- `read_file`
- `write_file`
- `apply_patch`
- `create_directory`

### Git

- `git_status`
- `git_branches`
- `git_diff`
- `git_clone`
- `git_pull`
- `git_checkout`
- `git_commit`

### 命令与服务

- `run_command`：安装、构建、测试、类型检查等会结束的命令
- `start_service`：启动 dev、server、watch 等常驻服务
- `service_status`：检查服务状态与日志
- `stop_service`：停止后台服务

工具只能访问用户授权的 Workspace，相对路径会经过边界检查。Git 写操作、命令执行、服务操作和大范围文件修改需要用户确认。

## 技术栈

**核心技术栈：** Next.js 15、React 19、TypeScript、Electron 37、Node.js、Fastify、Socket.IO、Prisma、SQLite、Docker、Dockerode、Tailwind CSS、pnpm、Turborepo。

- **桌面与前端**：Electron、Next.js、React、TypeScript、Tailwind CSS
- **API 与实时通信**：Node.js、Fastify、Socket.IO
- **数据存储**：Prisma、SQLite（默认）
- **Agent Runtime**：自研 Intent Router、Coding Worker Agent Loop、Context Manager、Tool Registry 与动态 Subagent 调度
- **隔离运行时**：Docker、Dockerode、Sandbox 工作副本与安全同步
- **模型接入**：OpenAI-compatible API、Ollama、LM Studio 等
- **工程化**：pnpm workspace、Turborepo

## 项目结构

```text
.
├── apps/
│   ├── api/                  # API、Socket.IO、Intent Router、Worker 接入
│   ├── desktop/              # Electron 与本地 Workspace 工具
│   └── web/                  # 对话、项目、状态和 Diff UI
├── packages/
│   ├── agent-runtime/        # Coding Worker、Context、Complexity、Docker Runtime
│   ├── ai/                   # AI 工具封装
│   ├── prompts/              # Agent 提示词
│   ├── shared/               # 共享类型
│   └── ui/                   # UI 包
├── docs/                     # 设计与开发文档
├── package.json
└── turbo.json
```

## 快速开始

### 环境要求

- Node.js 22.13 或更高版本（pnpm 11 要求）
- pnpm（仓库通过 Corepack 固定版本）
- Docker Desktop（仅使用 Docker Runtime 时需要）

默认数据库是 SQLite，不需要单独安装 PostgreSQL 或 Redis。

### 安装依赖

```bash
corepack enable
pnpm install
```

### 配置 API

可以在应用的“设置 → 模型配置”中添加 OpenAI-compatible 接口。

### 初始化数据库

```bash
pnpm --filter @agenthub/api db:generate
pnpm --filter @agenthub/api db:migrate
```

### 开发启动

分别启动 API、Web 和 Electron：

```bash
pnpm --filter @agenthub/api dev
pnpm --filter @agenthub/web dev
pnpm --filter @agenthub/desktop dev
```

服务地址：

- Web：<http://localhost:3000>
- API：<http://localhost:3003>

也可以启动整个 Monorepo：

```bash
pnpm dev
```

## Docker 一键启动

AgentHub 平台的 Web、API 和 SQLite 数据运行在 Docker 中，Electron 保留在宿主机，用于授权本地 Workspace、显示桌面窗口并管理 Coding Worker Sandbox。API 容器不会挂载宿主机 Docker Socket。

Windows 推荐直接双击 `start-agenthub.cmd`，或运行：

```powershell
.\start-agenthub.ps1 -Build
```

脚本会检查 Docker Desktop、创建 `.env.docker`、构建并启动 Web/API、初始化 SQLite、等待健康检查通过，最后启动宿主机 Electron。后续镜像没有变化时可以省略 `-Build`：

```powershell
.\start-agenthub.ps1
```

只启动容器平台、不打开 Electron：

```powershell
.\start-agenthub.ps1 -NoDesktop
```

停止平台：

```powershell
.\stop-agenthub.ps1
```

也可以直接使用 Docker Compose：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
docker compose down
```

持久化数据保存在 `agenthub-database` 和 `agenthub-api-data` Docker volumes 中，普通的 `docker compose down` 不会删除数据。只有明确执行 `docker compose down -v` 才会删除数据库和运行数据。

模型配置写入本地 `.env.docker`。如果容器需要访问宿主机 Ollama，请使用：

```env
LOCAL_AI_BASE=http://host.docker.internal:11434
LOCAL_AI_MODEL=qwen2.5:latest
```

浏览器仍通过 `http://localhost:3000` 访问 Web，通过 `http://localhost:3003` 访问 API 和 Socket.IO。

## 常用检查

```bash
pnpm type-check
pnpm build
pnpm lint
```

## 当前限制

- Electron 主对话已使用统一 Coding Worker；旧循环代码仍保留用于迁移期间对照，但不在主入口执行。
- 项目默认仍使用本地开发模式；切换为“完全隔离”后，每次任务会创建独立工作副本和 Docker Sandbox，文件操作只影响副本，命令在容器内执行，验证成功并通过并发冲突检查后才同步回原 Workspace。
- Sandbox 已具备独立 Docker 网络命名空间、内存/CPU/PID 限制、capability 移除、`no-new-privileges`、失败回收和安全同步；尚未实现只读根文件系统、细粒度域名白名单和长期运行任务的断点恢复。
- TaskGraph 相关数据结构和任务执行服务存在，但尚未成为 Project Assistant 的主执行路径。
- 前端已经接收工具、诊断、上下文压缩和 Diff 状态；Complexity Score 的独立可视化面板尚未实现。

## 安全原则

- Workspace 路径必须是相对路径并限制在授权目录内
- 大范围写入和具有副作用的工具需要确认
- 没有真实工具结果不能报告操作完成
- 修改任务验证成功后才发布最终 Diff
- Sandbox 失败或中断时销毁工作副本，不向原 Workspace 同步部分修改
- Subagent 默认只读，避免多个 Agent 同时争抢文件写入权

Sandbox 默认使用 `node:22-bookworm` 和 Docker bridge 网络。可通过 `AGENTHUB_SANDBOX_IMAGE` 使用项目专用镜像，通过 `AGENTHUB_SANDBOX_NETWORK=none` 完全禁用容器外网访问。

## License

MIT
