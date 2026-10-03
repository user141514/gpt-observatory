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
        diagnostics: { sidecar_tab: {
          id: 'PAGE_A',
          title: 'Research Factory',
          url: `https://chatgpt.com/c/${CHAT_A}`,
        } },
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

    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse(health)
      if (url.endsWith('/watches')) return jsonResponse({ watches })
      if (url.endsWith('/json/list')) throw new Error('normal observation must not request Relay')
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

    const sidecarUnknownFetch: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/watches')) {
        return jsonResponse({ watches: watches.map(watch => ({ ...watch, diagnostics: null })) })
      }
      return fetchImpl(input)
    }
    const sidecarUnknownBridge = createWatchdogBridge(store, {
      fetchImpl: sidecarUnknownFetch,
      now: () => new Date('2026-09-28T11:01:00.000Z'),
    })
    const sidecarUnknown = await sidecarUnknownBridge.sync()
    assert.equal(sidecarUnknown.integration.available, true)
    assert.equal(sidecarUnknown.integration.ready, true)
    assert.equal(sidecarUnknown.tasks[0]?.runtimeTabState, 'unknown')

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
    watches[0]!.diagnostics = { sidecar_tab: {
      id: 'PAGE_B',
      title: 'Research Factory – continued',
      url: `https://chatgpt.com/c/${CHAT_B}`,
    } }

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
        assert.equal(body.explicit, true)
        assert.equal(body.source, 'observatory-ui')
        assert.equal(body.actor, 'human')
        assert.equal(body.reason, 'manual-bind')
        assert.equal(body.operation_id, '832e8244-0489-4f17-8247-bfa2c2f941ed')
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
        assert.equal(body.source, 'observatory-ui')
        assert.equal(body.actor, 'human')
        assert.equal(body.reason, 'manual-unbind')
        assert.equal(body.operation_id, '4a39b06a-54f5-4a0b-af79-35bdfcd08144')
        watches = []
        return jsonResponse({ conversation_id: CHAT_A, removed: true })
      }
      return new Response('not found', { status: 404 })
    }

    const bridge = createWatchdogBridge(store, {
      fetchImpl,
      now: () => new Date('2026-10-02T12:30:00.000Z'),
    })

    const registered = await bridge.register(targetUrl, '832e8244-0489-4f17-8247-bfa2c2f941ed')
    const { snapshot: registeredSnapshot, ...registeredReceipt } = registered
    assert.equal(registeredSnapshot.tasks[0]?.currentConversation.id, CHAT_A)
    assert.deepEqual(registeredReceipt, {
      conversationId: CHAT_A,
      created: true,
      confirmed: true,
      confirmedAt: '2026-10-02T12:30:00.000Z',
      operationId: '832e8244-0489-4f17-8247-bfa2c2f941ed',
    })
    assert.equal(bridge.current().tasks.length, 1)
    assert.equal(bridge.current().tasks[0]?.currentConversation.id, CHAT_A)

    const unregistered = await bridge.unregister(CHAT_A, '4a39b06a-54f5-4a0b-af79-35bdfcd08144')
    const { snapshot: unregisteredSnapshot, ...unregisteredReceipt } = unregistered
    assert.equal(unregisteredSnapshot.tasks.length, 0)
    assert.deepEqual(unregisteredReceipt, {
      conversationId: CHAT_A,
      removed: true,
      confirmed: true,
      confirmedAt: '2026-10-02T12:30:00.000Z',
      operationId: '4a39b06a-54f5-4a0b-af79-35bdfcd08144',
    })
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

test('readable browser observation is projected without inventing tab metadata or querying Relay', async () => {
  const db = await createDatabase('mem://')
  try {
    const requests: string[] = []
    const watch: WatchdogWatch = {
      conversation_id: CHAT_A,
      target_url: `https://chatgpt.com/c/${CHAT_A}`,
      state: 'waiting_for_assistant',
      connected: true,
      last_success_at: 1_791_044_068,
      diagnostics: {
        observation_available: true,
        observation_source: 'browser',
        observation_readable: true,
        observation_observed_at: '2026-10-03T16:14:28.528Z',
        reason: 'observation_identity_incomplete',
      },
    }
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/health')) return jsonResponse({ ready: true, polling_fresh: true, protocol_version: 2 })
      if (url.endsWith('/watches')) return jsonResponse({ watches: [watch] })
      throw new Error(`unexpected request: ${url}`)
    }
    const bridge = createWatchdogBridge(createStore(db), { fetchImpl })
    const task = (await bridge.sync()).tasks[0]
    assert.equal(task?.operational, true)
    assert.equal(task?.runtimeTabState, 'unknown')
    assert.equal(task?.runtimeTab, undefined)
    assert.deepEqual(task?.runtimeTabObservation, {
      available: true,
      source: 'browser',
      readable: true,
      observedAt: '2026-10-03T16:14:28.528Z',
      reason: 'observation_identity_incomplete',
    })
    assert.deepEqual(requests.map(url => new URL(url).pathname).sort(), ['/health', '/watches'])

    watch.diagnostics = { observation_available: false, reason: 'persistent_turn_identity_unavailable' }
    const unavailable = (await bridge.sync()).tasks[0]
    assert.equal(unavailable?.runtimeTabObservation?.available, false)
    assert.equal(unavailable?.runtimeTabObservation?.readable, false)
    assert.equal(unavailable?.runtimeTabObservation?.reason, 'persistent_turn_identity_unavailable')
    watch.diagnostics = null
    assert.equal((await bridge.sync()).tasks[0]?.runtimeTabObservation, undefined)
  } finally {
    await db.close()
  }
})

test('active registry uses Sidecar diagnostics and provenance without requesting Relay', async () => {
  const db = await createDatabase('mem://')
  try {
    let relayRequests = 0
    let watch: WatchdogWatch = {
      conversation_id: CHAT_A,
      target_url: `https://chatgpt.com/c/${CHAT_A}`,
      state: 'waiting',
      connected: true,
      last_registration: {
        source: 'observatory-ui',
        actor: 'human',
        operation_id: '832e8244-0489-4f17-8247-bfa2c2f941ed',
        reason: 'manual-bind',
        at: 1_790_000_000,
      },
      diagnostics: {
        sidecar_tab: { id: 'TAB_A', title: 'Observed by Sidecar', url: `https://chatgpt.com/c/${CHAT_A}` },
      },
    }
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ protocol_version: 2 })
      if (url.endsWith('/watches')) return jsonResponse({ watches: [watch] })
      if (url.endsWith('/json/list')) {
        relayRequests += 1
        return jsonResponse([])
      }
      return new Response('not found', { status: 404 })
    }
    const bridge = createWatchdogBridge(createStore(db), { fetchImpl })
    const observed = await bridge.sync()
    assert.equal(observed.tasks[0]?.runtimeTabState, 'present')
    assert.equal(observed.tasks[0]?.runtimeTab?.id, 'TAB_A')
    assert.equal(observed.tasks[0]?.runtimeTab?.title, 'Observed by Sidecar')
    assert.deepEqual(observed.tasks[0]?.lastRegistration, {
      source: 'observatory-ui',
      actor: 'human',
      operationId: '832e8244-0489-4f17-8247-bfa2c2f941ed',
      reason: 'manual-bind',
      at: new Date(1_790_000_000 * 1000).toISOString(),
    })
    const entities = await createStore(db).currentEntities()
    assert.equal(
      entities.find(entity => entity.stableKey === `task:${CHAT_A}`)?.currentFacts.watchdog_registration_source,
      'observatory-ui',
    )

    watch = { ...watch, diagnostics: null, last_registration: undefined }
    const unknown = await bridge.sync()
    assert.equal(unknown.tasks[0]?.runtimeTabState, 'unknown')
    assert.equal(unknown.tasks[0]?.lastRegistration, undefined)

    watch = { ...watch, diagnostics: {
      sidecar_tab: { id: 'WRONG_TAB', url: `https://chatgpt.com/c/${CHAT_B}` },
    } }
    assert.equal((await bridge.sync()).tasks[0]?.runtimeTabState, 'unknown')

    watch = { ...watch, state: 'observation_unavailable',
      last_error: 'RuntimeError: persistent_turn_identity_unavailable',
      diagnostics: { reason: 'persistent_turn_identity_unavailable', observation_available: false },
    }
    const unavailable = await bridge.sync()
    assert.equal(unavailable.tasks[0]?.watchdogState, 'observation_unavailable')
    assert.equal(unavailable.tasks[0]?.observationUnavailableReason, 'persistent_turn_identity_unavailable')
    assert.equal(unavailable.tasks[0]?.lastError, 'RuntimeError: persistent_turn_identity_unavailable')
    assert.equal(unavailable.tasks[0]?.operational, false)
    assert.equal(relayRequests, 0)
  } finally {
    await db.close()
  }
})

for (const action of ['register', 'unregister'] as const) {
  test(`${action} confirmation waits for a new snapshot after any pre-mutation inFlight sync`, async () => {
    const db = await createDatabase('mem://')
    let releaseSnapshot!: (response: Response) => void
    let snapshotStarted!: () => void
    const started = new Promise<void>(resolve => { snapshotStarted = resolve })
    const staleSnapshot = new Promise<Response>(resolve => { releaseSnapshot = resolve })
    let mutationAcknowledged!: () => void
    const acknowledged = new Promise<void>(resolve => { mutationAcknowledged = resolve })
    try {
      const watch: WatchdogWatch = {
        conversation_id: CHAT_A,
        target_url: `https://chatgpt.com/c/${CHAT_A}`,
        state: 'waiting',
        connected: true,
      }
      const before = action === 'register' ? [] : [watch]
      const after = action === 'register' ? [watch] : []
      let watchesReads = 0
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input)
        if (url.endsWith('/health')) return jsonResponse({ protocol_version: 2 })
        if (url.endsWith('/watches')) {
          watchesReads += 1
          if (watchesReads === 1) {
            snapshotStarted()
            return staleSnapshot
          }
          return jsonResponse({ watches: after })
        }
        if (url.endsWith(`/${action}`) && init?.method === 'POST') {
          mutationAcknowledged()
          return jsonResponse({ conversation_id: CHAT_A, created: true, removed: true })
        }
        return jsonResponse([])
      }
      const bridge = createWatchdogBridge(createStore(db), { fetchImpl })
      const oldSync = bridge.sync()
      await started
      const mutation = action === 'register'
        ? bridge.register(watch.target_url)
        : bridge.unregister(CHAT_A)
      await acknowledged
      releaseSnapshot(jsonResponse({ watches: before }))
      await oldSync
      const result = await mutation
      assert.equal(result.confirmed, true)
      assert.equal(watchesReads, 2, 'confirmation must read the registry after the mutation')
      assert.equal(bridge.current().tasks.some(task => task.currentConversation.id === CHAT_A), action === 'register')
    } finally {
      await db.close()
    }
  })

  for (const confirmation of ['unavailable', 'unchanged', 'malformed'] as const) {
    test(`${action} never reports confirmed success when registry confirmation is ${confirmation}`, async () => {
      const db = await createDatabase('mem://')
      try {
        const watch: WatchdogWatch = {
          conversation_id: CHAT_A,
          target_url: `https://chatgpt.com/c/${CHAT_A}`,
          state: 'waiting',
          connected: true,
        }
        const fetchImpl: typeof fetch = async (input, init) => {
          const url = String(input)
          if (url.endsWith('/health')) return jsonResponse({ protocol_version: 2 })
          if (url.endsWith('/watches')) {
            if (confirmation === 'unavailable') return new Response('offline', { status: 503 })
            if (confirmation === 'malformed') return jsonResponse({ unexpected: [] })
            return jsonResponse({ watches: action === 'register' ? [] : [watch] })
          }
          if (url.endsWith(`/${action}`) && init?.method === 'POST') {
            return jsonResponse({ conversation_id: CHAT_A, created: true, removed: true })
          }
          return jsonResponse([])
        }
        const bridge = createWatchdogBridge(createStore(db), { fetchImpl })
        await assert.rejects(
          action === 'register' ? bridge.register(watch.target_url) : bridge.unregister(CHAT_A),
          (error: unknown) => error instanceof WatchdogRequestError
            && (error.body as { error?: string }).error === 'registry_confirmation_unknown',
        )
      } finally {
        await db.close()
      }
    })
  }
}

for (const action of ['register', 'unregister'] as const) {
  for (const mismatch of ['conversation', 'operation', 'invalid_receipt'] as const) {
    test(`${action} rejects a mismatched or malformed mutation receipt: ${mismatch}`, async () => {
      const db = await createDatabase('mem://')
      try {
        const fetchImpl: typeof fetch = async (input, init) => {
          const url = String(input)
          if (url.endsWith(`/${action}`) && init?.method === 'POST') {
            const body = JSON.parse(String(init.body)) as { operation_id: string }
            return jsonResponse({
              conversation_id: mismatch === 'conversation' ? CHAT_B : CHAT_A,
              operation_id: mismatch === 'operation' ? 'another-operation' : body.operation_id,
              created: mismatch === 'invalid_receipt' ? 'yes' : true,
              removed: mismatch === 'invalid_receipt' ? 'yes' : true,
            })
          }
          if (url.endsWith('/health')) return jsonResponse({ protocol_version: 2 })
          if (url.endsWith('/watches')) return jsonResponse({ watches: action === 'register' ? [{
            conversation_id: CHAT_A,
            target_url: `https://chatgpt.com/c/${CHAT_A}`,
            state: 'waiting',
            connected: true,
          }] : [] })
          return jsonResponse([])
        }
        const bridge = createWatchdogBridge(createStore(db), { fetchImpl })
        await assert.rejects(
          action === 'register' ? bridge.register(`https://chatgpt.com/c/${CHAT_A}`) : bridge.unregister(CHAT_A),
          (error: unknown) => error instanceof WatchdogRequestError
            && (error.body as { error?: string }).error === 'registry_confirmation_unknown',
        )
      } finally {
        await db.close()
      }
    })
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}