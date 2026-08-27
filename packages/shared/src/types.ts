// Core domain types for AgentHub

// ============= Enums =============
export type UserRole = 'admin' | 'member' | 'viewer'
export type WorkspaceStatus = 'active' | 'archived' | 'deleted'
export type ConversationType = 'group' | 'thread' | 'dm'
export type MessageContentType = 'text' | 'markdown' | 'code' | 'system'
export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'completed'
  | 'failed'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'rejected'
export type PatchStatus = 'generated' | 'review_requested' | 'approved' | 'applied' | 'rejected'
export type AgentRole = 'pm' | 'frontend' | 'backend' | 'qa' | 'orchestrator' | 'planner' | 'developer' | 'tester' | 'debugger'
export type AgentStatus = 'idle' | 'busy' | 'error' | 'paused'
export type RuntimeStatus = 'starting' | 'ready' | 'error' | 'stopped'
export type DeploymentStatus = 'pending' | 'building' | 'success' | 'failed'
export type EventType =
  | 'MESSAGE_CREATED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'PATCH_GENERATED'
  | 'PATCH_APPROVED'
  | 'PATCH_APPLIED'
  | 'AGENT_STARTED'
  | 'AGENT_FINISHED'
  | 'DEPLOYMENT_STARTED'
  | 'DEPLOYMENT_COMPLETED'

// ============= User & Auth =============
export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  role: UserRole
  createdAt: Date
  updatedAt: Date
}

export interface JWTPayload {
  userId: string
  email: string
  iat: number
  exp: number
}

// ============= Workspace =============
export interface Workspace {
  id: string
  name: string
  description?: string
  ownerId: string
  members: WorkspaceMember[]
  runtimeId?: string
  runtime?: Runtime
  deploymentUrl?: string
  status: WorkspaceStatus
  createdAt: Date
  updatedAt: Date
}

export interface WorkspaceMember {
  userId: string
  role: UserRole
  joinedAt: Date
}

// ============= Conversation & Messages =============
export interface Conversation {
  id: string
  workspaceId: string
  type: ConversationType
  title: string
  description?: string
  participants: string[] // userIds or agentIds
  messages: Message[]
  createdAt: Date
  updatedAt: Date
}

export interface Message {
  id: string
  conversationId: string
  authorId: string
  authorType: 'user' | 'agent'
  contentType: MessageContentType
  content: string
  mentions?: string[] // @mentions
  attachments?: MessageAttachment[]
  streaming?: boolean
  reactions?: Reaction[]
  createdAt: Date
  editedAt?: Date
}

export interface MessageAttachment {
  id: string
  name: string
  type: 'file' | 'patch' | 'link'
  url: string
  metadata?: Record<string, any>
}

export interface Reaction {
  emoji: string
  users: string[]
}

// ============= Task =============
export interface Task {
  id: string
  conversationId: string
  title: string
  description: string
  status: TaskStatus
  assignedAgentId?: string
  assignedAgentIds?: string[]
  createdBy?: string
  priority: number // 1-5
  patches: Patch[]
  files: FileChange[]
  acceptance_criteria: string[]
  subtasks?: Task[]
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}

export interface FileChange {
  filepath: string
  status: 'added' | 'modified' | 'deleted'
  diff?: string
}

// ============= Patch / Code Diff =============
export interface Patch {
  id: string
  taskId: string
  content: string // git diff format
  status: PatchStatus
  createdBy: string // userId or agentId
  appliedAt?: Date
  appliedBy?: string
  diff: {
    additions: number
    deletions: number
    files: string[]
  }
  review?: PatchReview
}

export interface PatchReview {
  reviewerId: string
  status: 'approved' | 'rejected' | 'requested_changes'
  comments?: string
  reviewedAt: Date
}

// ============= Agent =============
export interface Agent {
  id: string
  name: string
  role: AgentRole
  version: string
  systemPrompt: string
  tools: string[] // tool names
  model: string
  temperature: number
  maxTokens: number
  status: AgentStatus
  lastActivityAt?: Date
  createdAt: Date
}

export interface AgentExecution {
  id: string
  agentId: string
  taskId: string
  title: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  input: Record<string, any>
  output?: Record<string, any>
  error?: string
  logs: string[]
  startedAt?: Date
  completedAt?: Date
}

// ============= Tool =============
export interface Tool {
  name: string
  description: string
  parameters: Record<string, ParameterSchema>
  response: Record<string, ParameterSchema>
  timeout: number
  rateLimit?: {
    maxCalls: number
    windowMs: number
  }
  allowedRoles: AgentRole[]
}

export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  required?: boolean
  default?: any
  enum?: any[]
}

// ============= Runtime =============
export interface Runtime {
  id: string
  workspaceId: string
  type: 'docker'
  containerId: string
  status: RuntimeStatus
  previewUrl?: string
  exposedPorts: number[]
  filesystemRoot: string
  resources: {
    memory: string // e.g., "2G"
    cpus: string
  }
  createdAt: Date
  startedAt?: Date
}

export interface WorkflowNode {
  id: string
  name: string
  type: 'analysis' | 'patch' | 'test' | 'deploy' | 'verification' | 'custom'
  description: string
  agentRole: AgentRole | 'pm' | 'frontend' | 'backend' | 'qa' 
  input?: Record<string, any>
  outputSchema?: Record<string, any>
  status?: 'pending' | 'running' | 'completed' | 'failed'
  dependsOn?: string[]
}

export interface WorkflowEdge {
  from: string
  to: string
}

export interface WorkflowGraph {
  id: string
  workspaceId: string
  rootTaskId?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  metadata?: Record<string, any>
}

export interface Execution {
  id: string
  runtimeId: string
  workspaceId: string
  command: string
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  stdout?: string
  stderr?: string
  createdAt: Date
  startedAt: Date
  completedAt?: Date
  updatedAt: Date
}

export interface RuntimeExecResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface RuntimeManager {
  create(workspaceId: string, workspacePath: string): Promise<Runtime>
  start(runtimeId: string): Promise<Runtime>
  stop(runtimeId: string): Promise<void>
  exec(runtimeId: string, command: string, options?: { cwd?: string; timeout?: number }): Promise<RuntimeExecResult>
  getPreviewUrl(runtimeId: string): Promise<string | undefined>
  getStatus(runtimeId: string): Promise<RuntimeStatus>
}

export interface TerminalSession {
  id: string
  runtimeId: string
  isActive: boolean
  lastActivityAt: Date
}

// ============= Deployment =============
export interface Deployment {
  id: string
  workspaceId: string
  status: DeploymentStatus
  commitSha?: string
  deployedUrl?: string
  logs: string
  error?: string
  createdAt: Date
  completedAt?: Date
}

// ============= Event & Audit =============
export interface DomainEvent {
  type: EventType
  id: string
  aggregateId: string
  aggregateType: 'workspace' | 'conversation' | 'task' | 'patch' | 'agent'
  timestamp: Date
  userId: string
  data: Record<string, any>
  version: number
}

export interface AuditLog {
  id: string
  userId: string
  action: string
  resourceType: string
  resourceId: string
  changes?: Record<string, any>
  timestamp: Date
}

// ============= API Request/Response Types =============

// Chat API
export interface CreateMessageRequest {
  conversationId: string
  content: string
  contentType?: MessageContentType
  mentions?: string[]
}

export interface CreateMessageResponse {
  message: Message
}

// Task API
export interface CreateTaskRequest {
  conversationId: string
  title: string
  description: string
  assignedAgentId?: string
  priority?: number
  acceptance_criteria?: string[]
}

export interface UpdateTaskRequest {
  status?: TaskStatus
  assignedAgentId?: string
  priority?: number
}

// Agent API
export interface InvokeAgentRequest {
  agentId: string
  taskId: string
  context?: Record<string, any>
}

export interface InvokeAgentResponse {
  execution: AgentExecution
  streamUrl?: string
}

// Patch API
export interface ApprovePatchRequest {
  patchId: string
  reviewedBy: string
}

export interface ApplyPatchRequest {
  patchId: string
  appliedBy: string
}

// Deployment API
export interface CreateDeploymentRequest {
  workspaceId: string
  commitSha?: string
}

// ============= WebSocket Events =============
export interface SocketMessage {
  type: string
  payload: Record<string, any>
  timestamp: Date
}

export interface SocketEvent {
  event: string
  data: Record<string, any>
}

// Common response wrapper
export interface APIResponse<T> {
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, any>
  }
  timestamp: Date
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
