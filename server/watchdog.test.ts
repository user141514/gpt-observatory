import assert from 'node:assert/strict'
import test from 'node:test'
import { createDatabase } from './db.js'
import { createStore } from './store.js'
import {
  createWatchdogBridge,
  type WatchdogHealth,
  type WatchdogWatch,
} from './watchdog.js'

const CHAT_A = '6aa542fd-708c-83ea-869a-721efd83d7f3'
const CHAT_B = '7bb542fd-708c-83ea-869a-721efd83d7f4'

test('watchdog bridge preserves canonical task identity and keeps tabs runtime-only', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)

    const migrationSource = { key: 'migration-test', type: 'test' }
    await store.observe({
      source: migrationSource,
      entity: {
        stableKey: 'supervised-task:task-alpha',
        type: 'supervised_task',
        label: 'Legacy supervised task',
      },
      coverage: ['watchdog_registered', 'current_conversation_id'],
      facts: {
        watchdog_registered: true,
        current_conversation_id: CHAT_A,
      },
    })
    await store.setRelation({
      source: migrationSource,
      from: {
        stableKey: 'supervised-task:task-alpha',
        type: 'supervised_task',
        label: 'Legacy supervised task',
      },
      predicate: 'RUNS_IN',
      to: {
        stableKey: `conversation:${CHAT_A}`,
        type: 'conversation',
        label: `Conversation ${CHAT_A.slice(0, 8)}`,
      },
    })

    let health: WatchdogHealth = {
      ready: true,
      polling_fresh: true,
      protocol_version: 3,
      active_count: 1,
      degraded_count: 0,
    }

    let watches: WatchdogWatch[] = [
      {
        task_id: 'task-alpha',
        task_label: 'Research Factory',
        conversation_id: CHAT_A,
        target_url: `https://chatgpt.com/c/${CHAT_A}`,
        state: 'progress_visible',
        connected: true,
        registered_at: 1_790_000_000,
        binding_changed_at: 1_790_000_000,
        last_poll_at: 1_790_000_100,
        last_success_at: 1_790_000_100,
        consecutive_failures: 0,
        last_error: null,
      },
    ]

    let relay = [
      {
        id: 'PAGE_A',
        type: 'page',
        title: 'Research Factory',
        url: `https://chatgpt.com/c/${CHAT_A}`,
      },
      {
        id: 'IGNORED',
        type: 'page',
        title: 'Unregistered ChatGPT',
        url: 'https://chatgpt.com/c/8cc542fd-708c-83ea-869a-721efd83d7f5',
      },
    ]

    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse(health)
      if (url.endsWith('/watches')) return jsonResponse({ watches })
      if (url.endsWith('/json/list')) return jsonResponse(relay)
      return new Response('not found', { status: 404 })
    }

    const bridge = createWatchdogBridge(store, {
      fetchImpl,
      now: () => new Date('2026-09-28T11:00:00.000Z'),
    })

    const first = await bridge.sync()
    assert.equal(first.integration.available, true, first.integration.error)
    assert.equal(first.integration.ready, true)
    assert.equal(first.tasks.length, 1)
    assert.equal(first.tasks[0]?.taskId, 'task-alpha')
    assert.equal(first.tasks[0]?.stableKey, 'task:task-alpha')
    assert.equal(first.tasks[0]?.operational, true)
    assert.equal(first.tasks[0]?.currentConversation.id, CHAT_A)
    assert.equal(first.tasks[0]?.runtimeTabState, 'present')
    assert.equal(first.tasks[0]?.runtimeTab?.id, 'PAGE_A')

    let entities = await store.currentEntities()
    const canonicalTask = entities.find(entity => entity.stableKey === 'task:task-alpha')
    assert.equal(canonicalTask?.type, 'task')
    assert.equal(canonicalTask?.currentFacts.watchdog_registered, true)

    const legacyTask = entities.find(
      entity => entity.stableKey === 'supervised-task:task-alpha',
    )
    assert.equal(legacyTask?.currentFacts.watchdog_registered, false)
    assert.equal(
      entities.some(entity => entity.type === 'browser_tab'),
      false,
      'browser tabs are runtime bindings and must never become durable entities',
    )

    let graph = await store.graph()
    assert.equal(
      graph.edges.some(edge => edge.predicate === 'RENDERED_IN'),
      false,
      'browser tab bindings must never enter the durable factual graph',
    )
    assert.equal(
      graph.edges.some(
        edge =>
          edge.source === legacyTask?.id
          && edge.predicate === 'RUNS_IN',
      ),
      false,
      'legacy supervised-task relations must be retired during migration',
    )

    const relayFailingFetch: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/json/list')) {
        return new Response('relay unavailable', {
          status: 503,
          statusText: 'Unavailable',
        })
      }
      return fetchImpl(input)
    }
    const relayUnknownBridge = createWatchdogBridge(store, {
      fetchImpl: relayFailingFetch,
      now: () => new Date('2026-09-28T11:01:00.000Z'),
    })
    const relayUnknown = await relayUnknownBridge.sync()
    assert.equal(relayUnknown.integration.available, true)
    assert.equal(relayUnknown.integration.ready, true)
    assert.equal(relayUnknown.tasks[0]?.runtimeTabState, 'unknown')

    health = {
      ...health,
      ready: false,
      polling_fresh: false,
    }
    const unhealthy = await bridge.sync()
    assert.equal(unhealthy.integration.available, true)
    assert.equal(unhealthy.integration.ready, false)
    assert.equal(unhealthy.tasks[0]?.operational, false)

    health = {
      ...health,
      ready: true,
      polling_fresh: true,
    }
    watches = [
      {
        ...watches[0]!,
        conversation_id: CHAT_B,
        target_url: `https://chatgpt.com/c/${CHAT_B}`,
        binding_changed_at: 1_790_000_200,
        last_poll_at: 1_790_000_220,
        last_success_at: 1_790_000_220,
      },
    ]
    relay = [
      {
        id: 'PAGE_B',
        type: 'page',
        title: 'Research Factory – continued',
        url: `https://chatgpt.com/c/${CHAT_B}`,
      },
    ]

    const second = await bridge.sync()
    assert.equal(second.tasks.length, 1)
    assert.equal(second.tasks[0]?.taskId, 'task-alpha')
    assert.equal(second.tasks[0]?.stableKey, 'task:task-alpha')
    assert.equal(second.tasks[0]?.currentConversation.id, CHAT_B)

    entities = await store.currentEntities()
    const task = entities.find(entity => entity.stableKey === 'task:task-alpha')
    assert.equal(task?.currentFacts.current_conversation_id, CHAT_B)

    const conversationA = entities.find(
      entity => entity.stableKey === `conversation:${CHAT_A}`,
    )
    assert.equal(conversationA?.currentFacts.watchdog_bound, false)

    graph = await store.graph()
    const taskNode = graph.nodes.find(node => node.stableKey === 'task:task-alpha')
    const conversationB = graph.nodes.find(
      node => node.stableKey === `conversation:${CHAT_B}`,
    )
    assert.ok(taskNode)
    assert.ok(conversationB)

    const runEdges = graph.edges.filter(
      edge => edge.source === taskNode.id && edge.predicate === 'RUNS_IN',
    )
    assert.equal(runEdges.length, 1)
    assert.equal(runEdges[0]?.target, conversationB.id)

    watches = []
    relay = []
    const third = await bridge.sync()
    assert.equal(third.tasks.length, 0)

    entities = await store.currentEntities()
    const retiredTask = entities.find(entity => entity.stableKey === 'task:task-alpha')
    assert.equal(retiredTask?.currentFacts.watchdog_registered, false)
    assert.equal(retiredTask?.currentFacts.watchdog_state, 'unregistered')
    assert.equal(retiredTask?.currentFacts.current_conversation_id, null)

    const retiredConversationB = entities.find(
      entity => entity.stableKey === `conversation:${CHAT_B}`,
    )
    assert.equal(retiredConversationB?.currentFacts.watchdog_bound, false)

    graph = await store.graph()
    assert.equal(
      graph.edges.some(
        edge => edge.source === taskNode.id && edge.predicate === 'RUNS_IN',
      ),
      false,
    )
    assert.equal(
      graph.edges.some(
        edge => edge.source === taskNode.id && edge.predicate === 'SUPERVISED_BY',
      ),
      false,
    )
  } finally {
    await db.close()
  }
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}