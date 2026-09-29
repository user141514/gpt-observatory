#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import { ObservatoryAgentClient } from './agent-client.js'

const client = new ObservatoryAgentClient()

const server = new McpServer({
  name: 'gpt-observatory',
  version: '0.1.0',
})

function toolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent:
      value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : { value },
  }
}

server.registerTool(
  'observatory_context',
  {
    description:
      'Recover the current factual state of GPT/agent work in one call: entities, recent factual changes, graph relations, counts and freshness. Use this first when resuming work.',
    inputSchema: {
      recent: z.number().int().min(1).max(100).optional().describe('Number of recent fact-version events to include.'),
    },
  },
  async ({ recent }) => toolResult(await client.context({ recent })),
)

server.registerTool(
  'observatory_now',
  {
    description: 'Read all current observed entities and their current factual state.',
    inputSchema: {},
  },
  async () => toolResult(await client.now()),
)

server.registerTool(
  'observatory_timeline',
  {
    description: 'Read factual state-version history ordered by time. Repeated unchanged observations do not fabricate transitions.',
    inputSchema: {},
  },
  async () => toolResult(await client.timeline()),
)

server.registerTool(
  'observatory_graph',
  {
    description: 'Read the current factual entity graph. Edges are observation-backed relations, not inferred similarity.',
    inputSchema: {},
  },
  async () => toolResult(await client.graph()),
)

server.registerTool(
  'observatory_supervised_tasks',
  {
    description:
      'Read the Watchdog-authoritative supervised task set, including each task prompt version and current adaptive step prompt.',
    inputSchema: {},
  },
  async () => toolResult(await client.supervisedTasks()),
)

server.registerTool(
  'observatory_task_prompt_get',
  {
    description:
      'Read one supervised task prompt state and the immutable-envelope rendered prompt that Watchdog will actually send.',
    inputSchema: {
      taskId: z.string().min(1),
    },
  },
  async ({ taskId }) => toolResult(await client.taskPrompt(taskId)),
)

server.registerTool(
  'observatory_task_prompt_update',
  {
    description:
      'CAS-update the adaptive continuation prompt for one supervised task. Use this at the end of a completed minimal step to write the next-step instruction. The Watchdog-owned base envelope, SUPERVISOR_DONE gate and NEED_INPUT gate cannot be replaced.',
    inputSchema: {
      taskId: z.string().min(1),
      expectedVersion: z.number().int().min(0),
      stepIndex: z.number().int().min(0),
      stepPrompt: z.string().max(12000).nullable().optional(),
      updatedBy: z.string().min(1).max(128).optional(),
    },
  },
  async ({ taskId, expectedVersion, stepIndex, stepPrompt, updatedBy }) =>
    toolResult(
      await client.updateTaskPrompt(taskId, {
        expectedVersion,
        stepIndex,
        stepPrompt,
        updatedBy,
      }),
    ),
)

server.registerTool(
  'observatory_search',
  {
    description: 'Semantic search over the derived local vector index of factual entity state.',
    inputSchema: {
      query: z.string().min(1),
    },
  },
  async ({ query }) => toolResult(await client.search(query)),
)

server.registerTool(
  'observatory_observe',
  {
    description:
      'Append one observation and its observed facts to the canonical Observatory API. Same-value observations add coverage without fabricating new fact versions.',
    inputSchema: {
      source: z.object({
        key: z.string().min(1),
        type: z.string().min(1),
        authorityScope: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      entity: z.object({
        stableKey: z.string().min(1),
        type: z.string().min(1),
        label: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      observedAt: z.string().datetime().optional(),
      coverage: z.array(z.string()).min(1),
      facts: z.record(z.string(), z.unknown()),
      rawPayload: z.unknown().optional(),
      status: z.enum(['ok', 'partial', 'error']).optional(),
    },
  },
  async input => toolResult(await client.observe(input)),
)

server.registerTool(
  'observatory_relate',
  {
    description: 'Append or re-observe one factual relation between two entities.',
    inputSchema: {
      source: z.object({
        key: z.string().min(1),
        type: z.string().min(1),
        authorityScope: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      from: z.object({
        stableKey: z.string().min(1),
        type: z.string().min(1),
        label: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      predicate: z.string().min(1),
      to: z.object({
        stableKey: z.string().min(1),
        type: z.string().min(1),
        label: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      observedAt: z.string().datetime().optional(),
      rawPayload: z.unknown().optional(),
    },
  },
  async input => toolResult(await client.relate(input)),
)

server.registerTool(
  'observatory_reindex',
  {
    description: 'Rebuild the derived semantic index from current canonical facts.',
    inputSchema: {},
  },
  async () => toolResult(await client.reindex()),
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('GPT Observatory MCP server running on stdio')
