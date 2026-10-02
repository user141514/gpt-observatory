import assert from 'node:assert/strict'
import test from 'node:test'
import { createDatabase } from './db.js'
import { createStore } from './store.js'
import {
  createWatchdogBridge,
  WatchdogRequestError,
  type WatchdogHealth,
  type WatchdogPromptState,
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
    await store.observe({
      source: migrationSource,
      entity: {
        stableKey: 'browser-tab:PAGE_LEGACY',
        type: 'browser_tab',
        label: 'Legacy browser tab',
      },
      coverage: ['relay_page_id'],
      facts: { relay_page_id: 'PAGE_LEGACY' },
    })
    await store.setRelation({
      source: migrationSource,
      from: {
        stableKey: `conversation:${CHAT_A}`,
        type: 'conversation',
        label: `Conversation ${CHAT_A.slice(0, 8)}`,
      },
      predicate: 'RENDERED_IN',
      to: {
        stableKey: 'browser-tab:PAGE_LEGACY',
        type: 'browser_tab',
        label: 'Legacy browser tab',
      },
    })

    let health: WatchdogHealth = {
      ready: true,
      polling_fresh: true,
      protocol_version: 4,
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
        prompt: {
          task_id: 'task-alpha',
          version: 2,
          step_index: 4,
          step_prompt: '只推进当前最小验证步骤。',
          updated_at: 1_790_000_090,
          updated_by: 'codex',
        },
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
    assert.equal(first.integration.promptAvailable, true)
    assert.equal(first.tasks.length, 1)
    assert.equal(first.tasks[0]?.taskId, 'task-alpha')
    assert.equal(first.tasks[0]?.stableKey, 'task:task-alpha')
    assert.equal(first.tasks[0]?.operational, true)
    assert.equal(first.tasks[0]?.currentConversation.id, CHAT_A)
    assert.equal(first.tasks[0]?.runtimeTabState, 'present')
    assert.equal(first.tasks[0]?.runtimeTab?.id, 'PAGE_A')
    assert.ok(first.tasks[0]?.prompt)
    assert.equal(first.tasks[0].prompt.version, 2)
    assert.equal(first.tasks[0].prompt.stepIndex, 4)
    assert.equal(first.tasks[0].prompt.stepPrompt, '只推进当前最小验证步骤。')
    assert.equal(first.tasks[0].prompt.updatedBy, 'codex')

    let entities = await store.currentEntities()
    const canonicalTask = entities.find(entity => entity.stableKey === 'task:task-alpha')
    assert.equal(canonicalTask?.type, 'task')
    assert.equal(canonicalTask?.currentFacts.watchdog_registered, true)
    assert.equal(canonicalTask?.currentFacts.watchdog_prompt_version, 2)
    assert.equal(canonicalTask?.currentFacts.watchdog_prompt_step_index, 4)
    assert.equal(
      canonicalTask?.currentFacts.watchdog_prompt_step_prompt,
      '只推进当前最小验证步骤。',
    )
    assert.equal(canonicalTask?.currentFacts.watchdog_prompt_updated_by, 'codex')

    const currentConversationA = entities.find(
      entity => entity.stableKey === `conversation:${CHAT_A}`,
    )
    assert.equal(
      currentConversationA?.currentFacts.watchdog_bound,
      true,
      'retiring the legacy task must not unbind the conversation still used by the canonical task',
    )

    assert.equal(
      entities.some(entity => entity.type === 'supervised_task'),
      false,
      'legacy supervised-task entities must not remain in current projections',
    )
    assert.equal(
      entities.some(entity => entity.type === 'browser_tab'),
      false,
      'browser tabs are runtime bindings and must never appear in durable projections',
    )
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        currentConversationA?.currentFacts ?? {},
        'tab_bound',
      ),
      false,
      'legacy tab_bound fact must be closed during migration',
    )

    let graph = await store.graph()
    assert.equal(
      graph.nodes.some(
        node => node.type === 'browser_tab' || node.type === 'supervised_task',
      ),
      false,
      'legacy runtime-only and duplicate-task nodes must be hidden from the current graph',
    )
    assert.equal(
      graph.edges.some(edge => edge.predicate === 'RENDERED_IN'),
      false,
      'browser tab bindings must never enter the current factual graph',
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
    assert.equal(
      graph.nodes.some(node => node.stableKey === `conversation:${CHAT_A}`),
      false,
    )

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
      graph.nodes.some(node => node.stableKey === 'task:task-alpha'),
      false,
    )
    assert.equal(
      graph.nodes.some(node => node.stableKey === `conversation:${CHAT_B}`),
      false,
    )
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

test('watchdog bridge registers and unregisters through authoritative registry', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)
    const targetUrl = `https://chatgpt.com/c/${CHAT_A}`
    let watches: WatchdogWatch[] = []

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: true,
          polling_fresh: true,
          protocol_version: 2,
          active_count: watches.length,
          degraded_count: 0,
        })
      }
      if (url.endsWith('/watches')) return jsonResponse({ watches })
      if (url.endsWith('/json/list')) return jsonResponse([])
      if (url.endsWith('/register') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        assert.equal(body.url, targetUrl)
        watches = [{
          conversation_id: CHAT_A,
          target_url: targetUrl,
          state: 'waiting',
          connected: true,
          registered_at: 1_790_000_000,
          last_poll_at: 1_790_000_100,
          last_success_at: 1_790_000_100,
          consecutive_failures: 0,
          last_error: null,
        }]
        return jsonResponse({ conversation_id: CHAT_A, created: true })
      }
      if (url.endsWith('/unregister') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        assert.equal(body.conversation_id, CHAT_A)
        watches = []
        return jsonResponse({ conversation_id: CHAT_A, removed: true })
      }
      return new Response('not found', { status: 404 })
    }

    const bridge = createWatchdogBridge(store, {
      fetchImpl,
      now: () => new Date('2026-10-02T12:30:00.000Z'),
    })

    const registered = await bridge.register(targetUrl)
    assert.deepEqual(registered, { conversationId: CHAT_A, created: true })
    assert.equal(bridge.current().tasks.length, 1)
    assert.equal(bridge.current().tasks[0]?.currentConversation.id, CHAT_A)

    const unregistered = await bridge.unregister(CHAT_A)
    assert.deepEqual(unregistered, { conversationId: CHAT_A, removed: true })
    assert.equal(bridge.current().tasks.length, 0)
  } finally {
    await db.close()
  }
})

test('watchdog bridge does not touch browser relay when registry is empty', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)
    let relayRequests = 0
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: true,
          polling_fresh: true,
          protocol_version: 2,
          active_count: 0,
          degraded_count: 0,
        })
      }
      if (url.endsWith('/watches')) return jsonResponse({ watches: [] })
      if (url.endsWith('/json/list')) {
        relayRequests += 1
        return jsonResponse([])
      }
      return new Response('not found', { status: 404 })
    }

    const bridge = createWatchdogBridge(store, { fetchImpl })
    const projection = await bridge.sync()

    assert.equal(projection.tasks.length, 0)
    assert.equal(relayRequests, 0)
  } finally {
    await db.close()
  }
})

test('watchdog prompt capability fails closed before protocol v4', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)
    let promptRequests = 0
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: true,
          polling_fresh: true,
          protocol_version: 3,
          active_count: 1,
          degraded_count: 0,
        })
      }
      if (url.endsWith('/watches')) {
        return jsonResponse({
          watches: [{
            task_id: 'task-legacy',
            task_label: 'Legacy Watchdog',
            conversation_id: CHAT_A,
            target_url: `https://chatgpt.com/c/${CHAT_A}`,
            state: 'waiting',
            connected: true,
            last_success_at: 1_790_000_100,
          }],
        })
      }
      if (url.includes('/json/list')) return jsonResponse([])
      if (url.includes('/prompt')) {
        promptRequests += 1
        return new Response('legacy watchdog has no prompt endpoint', { status: 404 })
      }
      return new Response('not found', { status: 404 })
    }

    const bridge = createWatchdogBridge(store, { fetchImpl })
    const projection = await bridge.sync()

    assert.equal(projection.integration.available, true)
    assert.equal(projection.integration.promptAvailable, false)

    const entity = (await store.currentEntities()).find(
      item => item.stableKey === 'task:task-legacy',
    )
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        entity?.currentFacts ?? {},
        'watchdog_prompt_version',
      ),
      false,
      'pre-v4 absence must not be fabricated as prompt version zero',
    )

    await assert.rejects(
      bridge.getPrompt('task-legacy'),
      (error: unknown) =>
        error instanceof WatchdogRequestError
        && error.status === 409
        && (error.body as { error?: string }).error === 'prompt_protocol_unsupported',
    )
    await assert.rejects(
      bridge.updatePrompt({
        taskId: 'task-legacy',
        expectedVersion: 0,
        stepIndex: 1,
        stepPrompt: 'must not be sent',
      }),
      (error: unknown) =>
        error instanceof WatchdogRequestError
        && error.status === 409
        && (error.body as { error?: string }).error === 'prompt_protocol_unsupported',
    )
    assert.equal(promptRequests, 0)
  } finally {
    await db.close()
  }
})

test('protocol v4 prompt payloads fail closed on missing or invalid identity/schema', async () => {
  for (const malformed of [
    undefined,
    {
      task_id: 'different-task',
      version: 2,
      step_index: 1,
      step_prompt: 'wrong identity',
    },
    {
      task_id: 'task-alpha',
      version: -1,
      step_index: 1,
      step_prompt: 'negative version',
    },
    {
      task_id: 'task-alpha',
      version: 2,
      step_index: -1,
      step_prompt: 'negative step',
    },
  ]) {
    const db = await createDatabase('mem://')
    try {
      const store = createStore(db)
      const fetchImpl: typeof fetch = async input => {
        const url = String(input)
        if (url.endsWith('/health')) {
          return jsonResponse({
            ready: true,
            polling_fresh: true,
            protocol_version: 4,
            active_count: 1,
            degraded_count: 0,
          })
        }
        if (url.endsWith('/watches')) {
          return jsonResponse({
            watches: [{
              task_id: 'task-alpha',
              conversation_id: CHAT_A,
              target_url: `https://chatgpt.com/c/${CHAT_A}`,
              state: 'waiting',
              connected: true,
              last_success_at: 1_790_000_100,
              ...(malformed === undefined ? {} : { prompt: malformed }),
            }],
          })
        }
        if (url.includes('/json/list')) return jsonResponse([])
        return new Response('not found', { status: 404 })
      }

      const bridge = createWatchdogBridge(store, { fetchImpl })
      const projection = await bridge.sync()

      assert.equal(projection.integration.available, false)
      assert.equal(projection.integration.ready, false)
      assert.match(
        projection.integration.error ?? '',
        /invalid watchdog prompt/i,
      )

      const task = (await store.currentEntities()).find(
        entity => entity.stableKey === 'task:task-alpha',
      )
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          task?.currentFacts ?? {},
          'watchdog_prompt_version',
        ),
        false,
        'invalid protocol-v4 prompt must never be fabricated into current facts',
      )
    } finally {
      await db.close()
    }
  }
})

test('watchdog prompt proxy uses CAS and refreshes projection', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)
    let prompt: WatchdogPromptState = {
      task_id: 'task-alpha',
      version: 0,
      step_index: 0,
      step_prompt: null,
      updated_at: null,
      updated_by: null,
    }
    const watch: WatchdogWatch = {
      task_id: 'task-alpha',
      task_label: 'Prompt Task',
      conversation_id: CHAT_A,
      target_url: `https://chatgpt.com/c/${CHAT_A}`,
      state: 'waiting',
      connected: true,
      registered_at: 1_790_000_000,
      binding_changed_at: 1_790_000_000,
      last_poll_at: 1_790_000_100,
      last_success_at: 1_790_000_100,
      consecutive_failures: 0,
      last_error: null,
      prompt,
    }

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: true,
          polling_fresh: true,
          protocol_version: 4,
          active_count: 1,
          degraded_count: 0,
        })
      }
      if (url.endsWith('/watches')) {
        return jsonResponse({ watches: [{ ...watch, prompt }] })
      }
      if (url.includes('/json/list')) return jsonResponse([])
      if (url.includes('/prompt?task_id=')) {
        return jsonResponse({ ...prompt, rendered_prompt: 'rendered prompt' })
      }
      if (url.endsWith('/prompt') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        if (body.expected_version !== prompt.version) {
          return jsonResponse(
            {
              error: 'prompt_version_conflict',
              expected_version: body.expected_version,
              current_version: prompt.version,
            },
            409,
          )
        }
        prompt = {
          task_id: 'task-alpha',
          version: prompt.version + 1,
          step_index: Number(body.step_index),
          step_prompt:
            typeof body.step_prompt === 'string' ? body.step_prompt : null,
          updated_at: 1_790_000_200,
          updated_by:
            typeof body.updated_by === 'string' ? body.updated_by : null,
        }
        return jsonResponse(prompt)
      }
      return new Response('not found', { status: 404 })
    }

    const bridge = createWatchdogBridge(store, {
      fetchImpl,
      now: () => new Date('2026-09-28T11:00:00.000Z'),
    })

    await bridge.sync()
    const updated = await bridge.updatePrompt({
      taskId: 'task-alpha',
      expectedVersion: 0,
      stepIndex: 1,
      stepPrompt: '下一步只做接口 smoke test。',
      updatedBy: 'mcp',
    })

    assert.equal(updated.version, 1)
    assert.equal(updated.stepIndex, 1)
    assert.equal(updated.stepPrompt, '下一步只做接口 smoke test。')
    const projectedPrompt = bridge.current().tasks[0]?.prompt
    assert.ok(projectedPrompt)
    assert.equal(projectedPrompt.version, 1)
    assert.equal(
      projectedPrompt.stepPrompt,
      '下一步只做接口 smoke test。',
    )

    await assert.rejects(
      bridge.updatePrompt({
        taskId: 'task-alpha',
        expectedVersion: 0,
        stepIndex: 2,
        stepPrompt: 'stale overwrite',
        updatedBy: 'stale-agent',
      }),
      (error: unknown) =>
        error instanceof WatchdogRequestError
        && error.status === 409
        && (error.body as { error?: string }).error === 'prompt_version_conflict',
    )
  } finally {
    await db.close()
  }
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}