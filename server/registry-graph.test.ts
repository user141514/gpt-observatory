import assert from 'node:assert/strict'
import test from 'node:test'
import { projectRegistryGraph } from '../src/registry-graph.js'
import type { GraphResponse, SupervisedTasksResponse } from '../src/types.js'

const staleGraph: GraphResponse = {
  nodes: [
    { id: 'task-a', stableKey: 'task:a', label: 'A', type: 'task', facts: { watchdog_registered: true } },
    { id: 'conversation-a', stableKey: 'conversation:a', label: 'A conversation', type: 'conversation', facts: { watchdog_bound: true } },
    { id: 'task-b', stableKey: 'task:b', label: 'B', type: 'task', facts: { watchdog_registered: true } },
    { id: 'conversation-b', stableKey: 'conversation:b', label: 'B conversation', type: 'conversation', facts: { watchdog_bound: true } },
    { id: 'ordinary-task', stableKey: 'task:ordinary', label: 'Unrelated work', type: 'task', facts: { status: 'active' } },
  ],
  edges: [
    { id: 'a-edge', source: 'task-a', target: 'conversation-a', predicate: 'RUNS_IN', validFrom: '', observationId: '' },
    { id: 'b-edge', source: 'task-b', target: 'conversation-b', predicate: 'RUNS_IN', validFrom: '', observationId: '' },
  ],
}

const registry: SupervisedTasksResponse = {
  integration: { available: true, ready: true, promptAvailable: false, watchdogUrl: '', relayUrl: '' },
  tasks: [{
    taskId: 'b', stableKey: 'task:b', label: 'B', identitySource: 'watchdog_task_id',
    watchdogState: 'waiting', registered: true, connected: true, operational: true,
    currentConversation: { id: 'b', url: 'https://chatgpt.com/c/b', stableKey: 'conversation:b' },
    runtimeTabState: 'unknown', consecutiveFailures: 0,
  }],
}

test('confirmed unbind removes retired graph nodes even when secondary graph refresh fails', async () => {
  let graph = staleGraph
  const confirmedRegistry = registry
  try {
    graph = await Promise.reject(new Error('graph refresh unavailable'))
  } catch {
    // Keep prior factual graph; current membership is independently confirmed.
  }
  const visible = projectRegistryGraph(graph, confirmedRegistry)
  assert.deepEqual(visible.nodes.map(node => node.id), ['task-b', 'conversation-b', 'ordinary-task'])
  assert.deepEqual(visible.edges.map(edge => edge.id), ['b-edge'])
  assert.equal(staleGraph.nodes.length, 5, 'projection does not mutate factual evidence')
})

test('without a successful registry snapshot graph membership remains unfiltered', () => {
  assert.deepEqual(projectRegistryGraph(staleGraph, undefined), staleGraph)
})

test('confirmed empty registry removes all Watchdog-owned nodes but preserves unrelated work', () => {
  const visible = projectRegistryGraph(staleGraph, { ...registry, tasks: [] })
  assert.deepEqual(visible.nodes.map(node => node.id), ['ordinary-task'])
  assert.deepEqual(visible.edges, [])
})
