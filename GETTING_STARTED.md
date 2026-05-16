# AgentHub - 项目启动指南

本指南帮助您快速启动 AgentHub 项目。

## 前置要求

### 系统要求
- **OS**: Windows 10+, macOS 10.14+, Ubuntu 18.04+
- **Node.js**: >= 18.0.0
- **包管理器**: pnpm >= 8.0.0
- **Docker**: >= 20.10.0
- **Git**: >= 2.30.0

### 服务依赖
- **PostgreSQL**: >= 13.0
- **Redis**: >= 6.0
- **OpenAI API**: 需要 API key

## 第一步：环境准备

### 1.1 安装 Node.js

从 [nodejs.org](https://nodejs.org/) 下载 LTS 版本 (>= 18.0.0)

验证安装:
```bash
node --version  # v18.x.x 或更高
npm --version   # 9.x.x 或更高
```

### 1.2 安装 pnpm

```bash
npm install -g pnpm@latest

# 验证
pnpm --version  # 8.x.x 或更高
```

### 1.3 安装 Docker

从 [docker.com](https://www.docker.com/products/docker-desktop) 下载 Docker Desktop

验证安装:
```bash
docker --version   # Docker version 20.x.x 或更高
docker run hello-world
```

### 1.4 安装数据库

#### PostgreSQL

**Windows/macOS**: 使用 Docker
```bash
docker run --name agenthub-postgres \
  -e POSTGRES_USER=agenthub \
  -e POSTGRES_PASSWORD=development \
  -e POSTGRES_DB=agenthub \
  -p 5432:5432 \
  -d postgres:15-alpine
```

**或** 本地安装后创建数据库:
```bash
createdb -U postgres agenthub
```

#### Redis

```bash
docker run --name agenthub-redis \
  -p 6379:6379 \
  -d redis:7-alpine
```

## 第二步：克隆和安装

### 2.1 克隆仓库

```bash
git clone https://github.com/yourusername/agenthub.git
cd agenthub
```

### 2.2 安装依赖

```bash
pnpm install

# 或指定特定工作区
pnpm install --filter ./apps/web
pnpm install --filter ./apps/api
```

### 2.3 配置环境变量

```bash
# 复制示例文件
cp .env.example .env.local

# 编辑配置（根据需要修改）
# 编辑器打开 .env.local
```

最小必需配置:
```env
DATABASE_URL="postgresql://agenthub:development@localhost:5432/agenthub"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="dev-secret-key"
OPENAI_API_KEY="sk-your-key-here"
```

### 2.4 数据库迁移

```bash
# 生成 Prisma client
pnpm run db:generate

# 运行迁移
pnpm run db:migrate

# 可选: 生成测试数据
pnpm run db:seed
```

## 第三步：启动开发服务器

### 方式 1: 启动所有服务

```bash
pnpm run dev

# 输出:
# > agenthub@ dev /path/to/agenthub
# > turbo run dev
#
# cache warming up...
# @agenthub/web:dev: ▲ Next.js 15.x
# @agenthub/web:dev: ▲ Local:        http://localhost:3000
# @agenthub/api:dev: [Fastify] Server is running at http://0.0.0.0:3001
```

### 方式 2: 分别启动

**终端 1 - 后端 API**
```bash
cd apps/api
pnpm run dev

# 输出: [Fastify] Server is running at http://0.0.0.0:3001
```

**终端 2 - 前端应用**
```bash
cd apps/web
pnpm run dev

# 输出: ▲ Next.js 15.x
#      ▲ Local: http://localhost:3000
```

## 第四步：验证启动

### 4.1 前端应用

访问 http://localhost:3000 应该看到登录页面

### 4.2 后端 API

检查 API 状态:
```bash
curl http://localhost:3001/health

# 响应:
# {"status":"ok","timestamp":"2026-05-13T10:30:00Z"}
```

### 4.3 WebSocket 连接

打开浏览器开发者工具 (F12) 的 Console，应该看到:
```
WebSocket connected to ws://localhost:3001
```

## 第五步：创建测试用户

### 方式 1: 通过 UI 注册

1. 访问 http://localhost:3000
2. 点击 "Register"
3. 填写邮箱和密码
4. 点击 "Create Account"

### 方式 2: 通过 API

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User"
  }'

# 响应包含 token
```

## 第六步：创建第一个 Workspace

### 通过 UI

1. 登录应用
2. 点击 "New Workspace"
3. 填写名称和描述
4. 点击 "Create"

### 通过 API

```bash
curl -X POST http://localhost:3001/api/workspaces \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Project",
    "description": "Testing AgentHub"
  }'
```

## 常见问题排查

### Q: `pnpm install` 失败

**解决方案**:
```bash
# 清除缓存
pnpm store prune

# 重新安装
pnpm install
```

### Q: `Database connection refused`

**解决方案**:
```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 或启动容器
docker run --name agenthub-postgres \
  -e POSTGRES_USER=agenthub \
  -e POSTGRES_PASSWORD=development \
  -e POSTGRES_DB=agenthub \
  -p 5432:5432 \
  -d postgres:15-alpine
```

### Q: `Redis connection refused`

**解决方案**:
```bash
# 启动 Redis
docker run --name agenthub-redis \
  -p 6379:6379 \
  -d redis:7-alpine
```

### Q: `OPENAI_API_KEY not found`

**解决方案**:
1. 获取 OpenAI API key: https://platform.openai.com/api-keys
2. 添加到 `.env.local`:
```env
OPENAI_API_KEY="sk-your-actual-key"
```

### Q: Port 3000 或 3001 已被占用

**解决方案**:

更改前端端口:
```bash
# 在 apps/web 中
pnpm run dev -- -p 3002
```

更改后端端口:
```bash
# 在 .env.local 中
API_PORT="3002"

# 重启后端
```

### Q: Docker daemon is not running

**解决方案**:
1. 打开 Docker Desktop
2. 等待 Docker 启动完成

## 项目结构速览

```
agenthub/
├── apps/
│   ├── web/              # Next.js 前端
│   │   ├── src/app       # App Router 页面
│   │   ├── src/components
│   │   └── next.config.js
│   └── api/              # Fastify 后端
│       ├── src/routes    # 路由处理器
│       ├── src/services  # 业务逻辑
│       └── src/db        # 数据库配置
├── packages/
│   ├── shared/           # 共享类型
│   ├── ai/              # Agent 系统
│   └── prompts/         # Agent Prompts
├── docs/
│   ├── architecture/    # 架构设计
│   └── api/            # API 文档
└── package.json
```

## 开发命令速查表

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev

# 构建生产版本
pnpm run build

# 运行测试
pnpm run test

# 代码检查
pnpm run lint

# 类型检查
pnpm run type-check

# 数据库操作
pnpm run db:generate   # 生成 Prisma Client
pnpm run db:migrate    # 运行迁移
pnpm run db:seed       # 生成测试数据

# 进入 monorepo 工作区
cd apps/web
cd apps/api
cd packages/shared
```

## 调试技巧

### 1. 查看 API 日志

后端会输出详细日志:
```
[Fastify] POST /api/messages 201 (125ms)
[Fastify] WS connection established
[Agent] PM Agent started executing task-123
```

### 2. 查看前端 Network 请求

打开浏览器 DevTools → Network 标签签查看所有请求

### 3. 检查 WebSocket 通信

在浏览器 Console 中:
```javascript
// 查看最后 10 个 WebSocket 消息
console.log(window.__wsMessages)
```

### 4. 数据库查询调试

```bash
# 连接 PostgreSQL
psql -U agenthub -d agenthub

# 查看表
\dt

# 查看数据
SELECT * FROM "User" LIMIT 5;
```

## 下一步

1. 查看 [系统架构设计](./docs/architecture/SYSTEM_DESIGN.md)
2. 了解 [Agent 系统](./docs/architecture/AGENT_SYSTEM_DESIGN.md)
3. 阅读 [API 文档](./docs/api/API.md)
4. 按照 [开发计划](./docs/DEVELOPMENT_PLAN.md) 开始开发

## 获取帮助

- Issues: https://github.com/yourusername/agenthub/issues
- Discussions: https://github.com/yourusername/agenthub/discussions
- Email: hello@agenthub.dev

---

**Happy coding! 🚀**
