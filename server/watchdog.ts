import type {
  CurrentEntity,
  EntityInput,
  SourceInput,
  createStore,
} from './store.js'

export interface WatchdogHealth {
  ready?: boolean
  instance_id?: string
  pid?: number
  protocol_version?: number
  polling_fresh?: boolean
  last_poll_error?: string | null
  last_poll_started_at?: number | null
  last_poll_completed_at?: number | null
  active_count?: number
  degraded_count?: number
}

export interface WatchdogPromptState {
  task_id: string
  version: number
  step_index: number
  step_prompt?: string | null
  updated_at?: number | null
  updated_by?: string | null
  rendered_prompt?: string
}

export interface TaskPromptState {
  taskId: string
  version: number
  stepIndex: number
  stepPrompt?: string
  updatedAt?: string
  updatedBy?: string
  renderedPrompt?: string
}

export interface PromptUpdateInput {
  taskId: string
  expectedVersion: number
  stepIndex: number
  stepPrompt?: string | null
  updatedBy?: string
}

export interface WatchdogRegisterResult {
  conversationId: string
  created: boolean
}

export interface WatchdogUnregisterResult {
  conversationId: string
  removed: boolean
}

export class WatchdogRequestError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, url: string) {
    super(`Watchdog HTTP ${status} from ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    this.status = status
    this.body = body
  }
}

export interface WatchdogWatch {
  task_id?: string
  task_label?: string | null
  conversation_id: string
  target_url: string
  state: string
  connected: boolean
  registered_at?: number | null
  binding_changed_at?: number | null
  last_poll_at?: number | null
  last_success_at?: number | null
  consecutive_failures?: number
  last_error?: string | null
  diagnostics?: Record<string, unknown> | null
  prompt?: WatchdogPromptState | null
}

export interface RelayTarget {
  id: string
  type: string
  title?: string
  url?: string
}

export interface SupervisedTaskView {
  taskId: string
  stableKey: string
  label: string
  identitySource: 'watchdog_task_id' | 'legacy_conversation_id'
  watchdogState: string
  registered: boolean
  connected: boolean
  operational: boolean
  currentConversation: {
    id: string
    url: string
    stableKey: string
  }
  runtimeTabState: 'present' | 'absent' | 'unknown'
  runtimeTab?: {
    id: string
    title?: string
    url?: string
  }
  registeredAt?: string
  bindingChangedAt?: string
  lastPollAt?: string
  lastSuccessAt?: string
  consecutiveFailures: number
  lastError?: string
  prompt?: TaskPromptState
}

export interface SupervisedTasksProjection {
  integration: {
    available: boolean
    ready: boolean
    promptAvailable: boolean
    watchdogUrl: string
    relayUrl: string
    lastSyncAt?: string
    error?: string
    health?: WatchdogHealth
  }
  tasks: SupervisedTaskView[]
}

export interface WatchdogBridgeOptions {
  watchdogUrl?: string
  relayUrl?: string
  fetchImpl?: typeof fetch
  now?: () => Date
}

type Store = ReturnType<typeof createStore>

const WATCHDOG_SOURCE: SourceInput = {
  key: 'watchdog-registry',
  type: 'watchdog_registry',
  authorityScope: 'supervised task membership, task-conversation binding, and watchdog runtime state',
}

const MIGRATION_SOURCE: SourceInput = {
  key: 'observatory-migration',
  type: 'system_migration',
  authorityScope: 'retiring invalid legacy projection artifacts',
}

const WATCHDOG_ENTITY: EntityInput = {
  stableKey: 'service:watchdog',
  type: 'service',
  label: 'Watchdog',
}

export function createWatchdogBridge(
  store: Store,
  options: WatchdogBridgeOptions = {},
) {
  const watchdogUrl = options.watchdogUrl ?? process.env.WATCHDOG_URL ?? 'http://127.0.0.1:9235'
  const relayUrl = options.relayUrl ?? process.env.BROWSER_RELAY_URL ?? 'http://127.0.0.1:9224'
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())

  let projection: SupervisedTasksProjection = {
    integration: {
      available: false,
      ready: false,
      promptAvailable: false,
      watchdogUrl,
      relayUrl,
    },
    tasks: [],
  }
  let inFlight: Promise<SupervisedTasksProjection> | null = null

  async function sync(): Promise<SupervisedTasksProjection> {
    if (inFlight) return inFlight
    inFlight = performSync()
    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  }

  async function performSync(): Promise<SupervisedTasksProjection> {
    const observedAt = now().toISOString()

    try {
      const [health, watchesPayload] = await Promise.all([
        fetchJson<WatchdogHealth>(fetchImpl, `${watchdogUrl}/health`),
        fetchJson<{ watches: WatchdogWatch[] }>(fetchImpl, `${watchdogUrl}/watches`),
      ])

      const watches = Array.isArray(watchesPayload.watches) ? watchesPayload.watches : []
      const integrationReady = Boolean(health.ready) && Boolean(health.polling_fresh)
      const promptAvailable =
        typeof health.protocol_version === 'number'
        && health.protocol_version >= 4

      let relayTargets: RelayTarget[] | undefined = []
      if (watches.length > 0) {
        try {
          const relayPayload = await fetchJson<unknown>(fetchImpl, `${relayUrl}/json/list`)
          relayTargets = Array.isArray(relayPayload) ? relayPayload as RelayTarget[] : []
        } catch {
          relayTargets = undefined
        }
      }

      await store.observe({
        source: WATCHDOG_SOURCE,
        entity: WATCHDOG_ENTITY,
        observedAt,
        coverage: [
          'ready',
          'polling_fresh',
          'active_count',
          'degraded_count',
          'last_poll_error',
          'protocol_version',
        ],
        facts: {
          ready: Boolean(health.ready),
          polling_fresh: Boolean(health.polling_fresh),
          active_count: numberOrZero(health.active_count),
          degraded_count: numberOrZero(health.degraded_count),
          last_poll_error: health.last_poll_error ?? null,
          protocol_version: health.protocol_version ?? null,
        },
        rawPayload: health,
      })

      const existing = await store.currentEntities()
      const existingByKey = new Map(existing.map(entity => [entity.stableKey, entity]))
      const previouslyRegistered = existing.filter(entity =>
        (entity.type === 'task' || entity.type === 'supervised_task')
        && entity.currentFacts.watchdog_registered === true
      )

      const seenTaskKeys = new Set<string>()
      const activeConversationIds = new Set(
        watches.map(watch => watch.conversation_id),
      )
      const views: SupervisedTaskView[] = []

      const legacyTabFactConversations = existing.filter(
        entity =>
          entity.type === 'conversation'
          && Object.prototype.hasOwnProperty.call(entity.currentFacts, 'tab_bound'),
      )
      for (const conversation of legacyTabFactConversations) {
        await store.clearFact({
          source: MIGRATION_SOURCE,
          entity: entityInputFromCurrent(conversation),
          attribute: 'tab_bound',
          observedAt,
          rawPayload: {
            reason: 'legacy durable tab-bound fact retired; tabs are runtime-only',
          },
        })
      }

      const existingGraph = await store.graph()
      const legacyRenderedConversationIds = new Set(
        existingGraph.edges
          .filter(edge => edge.predicate === 'RENDERED_IN')
          .map(edge => {
            const node = existingGraph.nodes.find(item => item.id === edge.source)
            const stableKey =
              typeof node?.stableKey === 'string' ? node.stableKey : undefined
            return stableKey?.startsWith('conversation:')
              ? stableKey.slice('conversation:'.length)
              : undefined
          })
          .filter((value): value is string => Boolean(value)),
      )
      for (const conversationId of legacyRenderedConversationIds) {
        await store.clearRelation({
          source: MIGRATION_SOURCE,
          from: conversationEntityFor(conversationId),
          predicate: 'RENDERED_IN',
          observedAt,
          rawPayload: {
            reason: 'legacy durable browser-tab relation retired; tabs are runtime-only',
          },
        })
      }

      for (const watch of watches) {
        const taskId = watch.task_id?.trim() || watch.conversation_id
        const identitySource: SupervisedTaskView['identitySource'] =
          watch.task_id?.trim() ? 'watchdog_task_id' : 'legacy_conversation_id'
        const taskKey = `task:${taskId}`
        const conversationKey = `conversation:${watch.conversation_id}`

        const taskEntity: EntityInput = {
          stableKey: taskKey,
          type: 'task',
          label: watch.task_label?.trim() || `监督任务 ${taskId.slice(0, 8)}`,
        }
        const conversationEntity = conversationEntityFor(watch.conversation_id)

        const previousTask = existingByKey.get(taskKey)
        const previousConversationId = stringFact(
          previousTask?.currentFacts.current_conversation_id,
        )

        if (
          previousConversationId
          && previousConversationId !== watch.conversation_id
        ) {
          await markConversationUnbound(
            store,
            previousConversationId,
            observedAt,
            {
              reason: 'task rebound to replacement conversation',
              task_id: taskId,
              replacement_conversation_id: watch.conversation_id,
            },
          )
        }

        const operational =
          integrationReady
          && watch.connected
          && !watch.last_error
          && watch.last_success_at != null
        const prompt = promptAvailable
          ? normalizePrompt(watch.prompt, taskId)
          : undefined
        const taskCoverage = [
          'watchdog_registered',
          'watchdog_state',
          'watchdog_connected',
          'watchdog_operational',
          'current_conversation_id',
          'watchdog_consecutive_failures',
          'watchdog_last_error',
          'watchdog_last_poll_at',
          'watchdog_last_success_at',
          'watchdog_registered_at',
          'binding_changed_at',
          'task_identity_source',
        ]
        const taskFacts: Record<string, unknown> = {
          watchdog_registered: true,
          watchdog_state: watch.state,
          watchdog_connected: watch.connected,
          watchdog_operational: operational,
          current_conversation_id: watch.conversation_id,
          watchdog_consecutive_failures: numberOrZero(watch.consecutive_failures),
          watchdog_last_error: watch.last_error ?? null,
          watchdog_last_poll_at: epochSecondsIso(watch.last_poll_at),
          watchdog_last_success_at: epochSecondsIso(watch.last_success_at),
          watchdog_registered_at: epochSecondsIso(watch.registered_at),
          binding_changed_at: epochSecondsIso(watch.binding_changed_at),
          task_identity_source: identitySource,
        }
        if (prompt) {
          taskCoverage.push(
            'watchdog_prompt_version',
            'watchdog_prompt_step_index',
            'watchdog_prompt_step_prompt',
            'watchdog_prompt_updated_at',
            'watchdog_prompt_updated_by',
          )
          Object.assign(taskFacts, {
            watchdog_prompt_version: prompt.version,
            watchdog_prompt_step_index: prompt.stepIndex,
            watchdog_prompt_step_prompt: prompt.stepPrompt ?? null,
            watchdog_prompt_updated_at: prompt.updatedAt ?? null,
            watchdog_prompt_updated_by: prompt.updatedBy ?? null,
          })
        }

        await store.observe({
          source: WATCHDOG_SOURCE,
          entity: taskEntity,
          observedAt,
          coverage: taskCoverage,
          facts: taskFacts,
          rawPayload: watch,
          status: watch.last_error || !integrationReady ? 'partial' : 'ok',
        })

        await store.observe({
          source: WATCHDOG_SOURCE,
          entity: conversationEntity,
          observedAt,
          coverage: ['target_url', 'watchdog_bound', 'watchdog_state'],
          facts: {
            target_url: watch.target_url,
            watchdog_bound: true,
            watchdog_state: watch.state,
          },
          rawPayload: watch,
          status: watch.last_error || !integrationReady ? 'partial' : 'ok',
        })

        await store.setRelation({
          source: WATCHDOG_SOURCE,
          from: taskEntity,
          predicate: 'SUPERVISED_BY',
          to: WATCHDOG_ENTITY,
          observedAt,
          rawPayload: { task_id: taskId, conversation_id: watch.conversation_id },
        })

        await store.setRelation({
          source: WATCHDOG_SOURCE,
          from: taskEntity,
          predicate: 'RUNS_IN',
          to: conversationEntity,
          observedAt,
          rawPayload: { task_id: taskId, conversation_id: watch.conversation_id },
        })

        let runtimeTab: SupervisedTaskView['runtimeTab']
        let runtimeTabState: SupervisedTaskView['runtimeTabState'] = 'unknown'

        if (relayTargets) {
          const target = relayTargets.find(item =>
            item.type === 'page'
            && typeof item.url === 'string'
            && exactConversationId(item.url) === watch.conversation_id
          )
          if (target) {
            runtimeTabState = 'present'
            runtimeTab = {
              id: target.id,
              title: target.title,
              url: target.url,
            }
          } else {
            runtimeTabState = 'absent'
          }
        }

        seenTaskKeys.add(taskKey)
        views.push({
          taskId,
          stableKey: taskKey,
          label: taskEntity.label ?? taskKey,
          identitySource,
          watchdogState: watch.state,
          registered: true,
          connected: watch.connected,
          operational,
          currentConversation: {
            id: watch.conversation_id,
            url: watch.target_url,
            stableKey: conversationKey,
          },
          runtimeTabState,
          runtimeTab,
          registeredAt: epochSecondsIso(watch.registered_at) ?? undefined,
          bindingChangedAt: epochSecondsIso(watch.binding_changed_at) ?? undefined,
          lastPollAt: epochSecondsIso(watch.last_poll_at) ?? undefined,
          lastSuccessAt: epochSecondsIso(watch.last_success_at) ?? undefined,
          consecutiveFailures: numberOrZero(watch.consecutive_failures),
          lastError: watch.last_error ?? undefined,
          prompt,
        })
      }

      for (const entity of previouslyRegistered) {
        if (seenTaskKeys.has(entity.stableKey)) continue

        const taskEntity = entityInputFromCurrent(entity)
        const priorConversationId = stringFact(
          entity.currentFacts.current_conversation_id,
        )

        if (
          priorConversationId
          && !activeConversationIds.has(priorConversationId)
        ) {
          await markConversationUnbound(
            store,
            priorConversationId,
            observedAt,
            {
              reason: 'task absent from successful watchdog /watches snapshot',
              task: entity.stableKey,
            },
          )
        }

        await store.observe({
          source: WATCHDOG_SOURCE,
          entity: taskEntity,
          observedAt,
          coverage: [
            'watchdog_registered',
            'watchdog_state',
            'watchdog_connected',
            'watchdog_operational',
            'current_conversation_id',
          ],
          facts: {
            watchdog_registered: false,
            watchdog_state: 'unregistered',
            watchdog_connected: false,
            watchdog_operational: false,
            current_conversation_id: null,
          },
          rawPayload: { active_watch_set: [...seenTaskKeys] },
        })

        await store.clearRelation({
          source: WATCHDOG_SOURCE,
          from: taskEntity,
          predicate: 'RUNS_IN',
          observedAt,
          rawPayload: { reason: 'task absent from successful watchdog /watches snapshot' },
        })
        await store.clearRelation({
          source: WATCHDOG_SOURCE,
          from: taskEntity,
          predicate: 'SUPERVISED_BY',
          observedAt,
          rawPayload: { task: entity.stableKey },
        })
      }

      projection = {
        integration: {
          available: true,
          ready: integrationReady,
          promptAvailable,
          watchdogUrl,
          relayUrl,
          lastSyncAt: observedAt,
          health,
        },
        tasks: views.sort((a, b) => a.label.localeCompare(b.label)),
      }
      return projection
    } catch (error) {
      projection = {
        ...projection,
        integration: {
          ...projection.integration,
          available: false,
          ready: false,
          promptAvailable: false,
          lastSyncAt: observedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      }
      return projection
    }
  }

  async function requirePromptCapability(): Promise<void> {
    let currentProjection = projection
    if (
      !currentProjection.integration.available
      || currentProjection.integration.health?.protocol_version === undefined
    ) {
      currentProjection = await sync()
    }

    if (!currentProjection.integration.available) {
      throw new WatchdogRequestError(
        503,
        {
          error: 'watchdog_unavailable',
          message: currentProjection.integration.error ?? 'Watchdog is unavailable.',
        },
        `${watchdogUrl}/health`,
      )
    }

    const currentVersion =
      currentProjection.integration.health?.protocol_version ?? 0
    if (currentVersion < 4) {
      throw new WatchdogRequestError(
        409,
        {
          error: 'prompt_protocol_unsupported',
          required_protocol_version: 4,
          current_protocol_version: currentVersion,
        },
        `${watchdogUrl}/health`,
      )
    }
  }

  async function register(targetUrl: string): Promise<WatchdogRegisterResult> {
    const raw = await fetchJson<{ conversation_id: string; created: boolean }>(
      fetchImpl,
      `${watchdogUrl}/register`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      },
    )
    await sync()
    return {
      conversationId: raw.conversation_id,
      created: raw.created,
    }
  }

  async function unregister(conversationId: string): Promise<WatchdogUnregisterResult> {
    const raw = await fetchJson<{ conversation_id: string; removed: boolean }>(
      fetchImpl,
      `${watchdogUrl}/unregister`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      },
    )
    await sync()
    return {
      conversationId: raw.conversation_id,
      removed: raw.removed,
    }
  }

  async function getPrompt(taskId: string): Promise<TaskPromptState> {
    await requirePromptCapability()
    const raw = await fetchJson<WatchdogPromptState>(
      fetchImpl,
      `${watchdogUrl}/prompt?task_id=${encodeURIComponent(taskId)}`,
    )
    return normalizePrompt(raw, taskId)
  }

  async function updatePrompt(
    input: PromptUpdateInput,
  ): Promise<TaskPromptState> {
    await requirePromptCapability()
    const raw = await fetchJson<WatchdogPromptState>(
      fetchImpl,
      `${watchdogUrl}/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task_id: input.taskId,
          expected_version: input.expectedVersion,
          step_index: input.stepIndex,
          step_prompt: input.stepPrompt ?? null,
          updated_by: input.updatedBy,
        }),
      },
    )
    await sync()
    return normalizePrompt(raw, input.taskId)
  }

  function current(): SupervisedTasksProjection {
    return projection
  }

  return { sync, current, register, unregister, getPrompt, updatePrompt }
}

async function markConversationUnbound(
  store: Store,
  conversationId: string,
  observedAt: string,
  rawPayload: unknown,
) {
  await store.observe({
    source: WATCHDOG_SOURCE,
    entity: conversationEntityFor(conversationId),
    observedAt,
    coverage: ['watchdog_bound', 'watchdog_state'],
    facts: {
      watchdog_bound: false,
      watchdog_state: 'unbound',
    },
    rawPayload,
  })
}

function conversationEntityFor(conversationId: string): EntityInput {
  return {
    stableKey: `conversation:${conversationId}`,
    type: 'conversation',
    label: `Conversation ${conversationId.slice(0, 8)}`,
  }
}

function entityInputFromCurrent(entity: CurrentEntity): EntityInput {
  return {
    stableKey: entity.stableKey,
    type: entity.type,
    label: entity.label,
    metadata: entity.metadata,
  }
}

function stringFact(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function epochSecondsIso(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000).toISOString()
}

function normalizePrompt(
  raw: WatchdogPromptState | null | undefined,
  taskId: string,
): TaskPromptState {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`invalid watchdog prompt for ${taskId}: payload is required`)
  }

  const promptTaskId =
    typeof raw.task_id === 'string' ? raw.task_id.trim() : ''
  if (!promptTaskId || promptTaskId !== taskId) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: task_id mismatch`,
    )
  }

  if (
    typeof raw.version !== 'number'
    || !Number.isInteger(raw.version)
    || raw.version < 0
  ) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: version must be a non-negative integer`,
    )
  }

  if (
    typeof raw.step_index !== 'number'
    || !Number.isInteger(raw.step_index)
    || raw.step_index < 0
  ) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: step_index must be a non-negative integer`,
    )
  }

  if (
    raw.step_prompt !== undefined
    && raw.step_prompt !== null
    && typeof raw.step_prompt !== 'string'
  ) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: step_prompt must be a string or null`,
    )
  }
  if (
    typeof raw.step_prompt === 'string'
    && raw.step_prompt.length > 12000
  ) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: step_prompt exceeds 12000 characters`,
    )
  }

  if (
    raw.updated_at !== undefined
    && raw.updated_at !== null
    && (
      typeof raw.updated_at !== 'number'
      || !Number.isFinite(raw.updated_at)
      || raw.updated_at < 0
    )
  ) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: updated_at must be a non-negative finite number or null`,
    )
  }

  if (
    raw.updated_by !== undefined
    && raw.updated_by !== null
    && typeof raw.updated_by !== 'string'
  ) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: updated_by must be a string or null`,
    )
  }

  if (
    raw.rendered_prompt !== undefined
    && raw.rendered_prompt !== null
    && typeof raw.rendered_prompt !== 'string'
  ) {
    throw new Error(
      `invalid watchdog prompt for ${taskId}: rendered_prompt must be a string`,
    )
  }

  return {
    taskId: promptTaskId,
    version: raw.version,
    stepIndex: raw.step_index,
    stepPrompt:
      typeof raw.step_prompt === 'string' && raw.step_prompt.length
        ? raw.step_prompt
        : undefined,
    updatedAt: epochSecondsIso(raw.updated_at) ?? undefined,
    updatedBy:
      typeof raw.updated_by === 'string' && raw.updated_by.length
        ? raw.updated_by
        : undefined,
    renderedPrompt:
      typeof raw.rendered_prompt === 'string'
        ? raw.rendered_prompt
        : undefined,
  }
}

function numberOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function exactConversationId(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'chatgpt.com') return undefined
    const segments = parsed.pathname.split('/').filter(Boolean)
    const cIndex = segments.lastIndexOf('c')
    if (cIndex < 0 || cIndex + 1 >= segments.length) return undefined
    return segments[cIndex + 1]
  } catch {
    return undefined
  }
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(3000),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Preserve non-JSON boundary responses for diagnostics.
  }
  if (!response.ok) {
    throw new WatchdogRequestError(response.status, body, url)
  }
  return body as T
}