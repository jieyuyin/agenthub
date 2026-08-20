import { FastifyPluginAsync } from 'fastify';
import { Agent, AgentExecution } from '@agenthub/shared';

export const agentRoutes: FastifyPluginAsync = async (server) => {
  // Mock agents data
  const mockAgents: Agent[] = [
    {
      id: 'pm-1',
      name: 'Project Manager',
      role: 'pm',
      version: '1.0.0',
      systemPrompt: 'You are a project manager agent responsible for coordinating development tasks, managing timelines, and ensuring quality standards.',
      tools: ['task_management', 'scheduling', 'quality_assurance'],
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000,
      status: 'idle',
      lastActivityAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
      createdAt: new Date(),
    },
    {
      id: 'frontend-1',
      name: 'Frontend Developer',
      role: 'frontend',
      version: '1.0.0',
      systemPrompt: 'You are a frontend developer agent specializing in React, TypeScript, and modern web development practices.',
      tools: ['react_development', 'typescript', 'css_styling', 'component_creation'],
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 3000,
      status: 'busy',
      lastActivityAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
      createdAt: new Date(),
    },
    {
      id: 'backend-1',
      name: 'Backend Developer',
      role: 'backend',
      version: '1.0.0',
      systemPrompt: 'You are a backend developer agent specializing in Node.js, databases, and API development.',
      tools: ['api_development', 'database_design', 'authentication', 'testing'],
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 2500,
      status: 'idle',
      lastActivityAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      createdAt: new Date(),
    },
    {
      id: 'qa-1',
      name: 'QA Developer',
      role: 'qa',
      version: '1.0.0',
      systemPrompt:
        'You are a QA developer agent specializing in testing, automation, and quality assurance.',
      tools: [
        'unit_testing',
        'integration_testing',
        'e2e_testing',
        'bug_reporting',
        'test_automation',
      ],
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 2500,
      status: 'idle',
      lastActivityAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      createdAt: new Date(),
    }
  ];

  // Mock executions data
  const mockExecutions: AgentExecution[] = [
    {
      id: 'exec-1',
      agentId: 'frontend-1',
      taskId: 'task-1',
      status: 'running',
      input: { action: 'create_component', component: 'UserProfile' },
      logs: [
        'Starting component creation...',
        'Analyzing requirements...',
        'Generating TypeScript interfaces...',
        'Creating React component...',
        'Adding styling...'
      ],
      startedAt: new Date(Date.now() - 1000 * 60 * 10), // 10 minutes ago
    },
    {
      id: 'exec-2',
      agentId: 'pm-1',
      taskId: 'task-2',
      status: 'completed',
      input: { action: 'review_progress', project: 'AgentHub' },
      output: { status: 'on_track', issues: 0, completion: 85 },
      logs: [
        'Reviewing project progress...',
        'Checking task completion...',
        'Analyzing timeline...',
        'Generating progress report...'
      ],
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
      completedAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
    },
    {
      id: 'exec-3',
      agentId: 'backend-1',
      taskId: 'task-3',
      status: 'failed',
      input: { action: 'create_api', endpoint: '/users' },
      error: 'Database connection timeout',
      logs: [
        'Initializing API creation...',
        'Setting up database connection...',
        'Connection timeout - retrying...',
        'Failed to connect to database'
      ],
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 4), // 4 hours ago
      completedAt: new Date(Date.now() - 1000 * 60 * 60 * 3), // 3 hours ago
    }
  ];

  server.get('/agents', async () => {
    return {
      agents: mockAgents,
    };
  });

  server.get('/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const agent = mockAgents.find(a => a.id === id);

    if (!agent) {
      throw (server as any).httpErrors?.notFound ? (server as any).httpErrors.notFound('Agent not found') : new Error('Agent not found');
    }

    return agent;
  });

  // Mock agent run history (distinct from runtime container Execution at GET /api/executions/:id)
  server.get('/agent-executions', async () => {
    return {
      executions: mockExecutions,
    };
  });
};