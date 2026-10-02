export interface CurrentFactDetail {
  id: string
  attribute: string
  value: unknown
  validFrom: string
  recordedAt: string
  observationId: string
  observedAt?: string
  observationStatus?: string
  source?: {
    key: string
    type: string
    authorityScope?: string
  }
}

export interface CurrentEntity {
  id: string
  stableKey: string
  type: string
  label: string
  metadata: Record<string, unknown>
  lastObservedAt?: string
  currentFacts: Record<string, unknown>
  factDetails: CurrentFactDetail[]
}

export interface NowResponse {
  counts: Record<string, number>
  entities: CurrentEntity[]
}

export interface TimelineEvent {
  id: string
  entityId: string
  stableKey: string
  entityLabel: string
  entityType: string
  attribute: string
  from?: unknown
  to: unknown
  at: string
  initial: boolean
}

export interface GraphResponse {
  nodes: Array<{
    id: string
    stableKey: string
    label: string
    type: string
    facts: Record<string, unknown>
    lastObservedAt?: string
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    predicate: string
    validFrom: string
    observationId: string
  }>
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
  expectedVersion: number
  stepIndex: number
  stepPrompt?: string | null
  updatedBy?: string
}

export interface RegistryConfirmation {
  confirmed: true
  confirmedAt: string
  operationId: string
  snapshot: SupervisedTasksResponse
}

export interface WatchdogRegisterResult extends RegistryConfirmation {
  conversationId: string
  created: boolean
}

export interface WatchdogUnregisterResult extends RegistryConfirmation {
  conversationId: string
  removed: boolean
}

export interface RegistrationProvenance {
  source: string
  actor: string
  operationId: string
  reason: string
  at?: string
}

export interface SupervisedTask {
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
  lastRegistration?: RegistrationProvenance
  bindingChangedAt?: string
  lastPollAt?: string
  lastSuccessAt?: string
  consecutiveFailures: number
  lastError?: string
  prompt?: TaskPromptState
}

export interface SupervisedTasksResponse {
  integration: {
    available: boolean
    ready: boolean
    promptAvailable: boolean
    watchdogUrl: string
    relayUrl: string
    lastSyncAt?: string
    error?: string
    health?: {
      ready?: boolean
      polling_fresh?: boolean
      active_count?: number
      degraded_count?: number
      last_poll_error?: string | null
      protocol_version?: number
    }
  }
  tasks: SupervisedTask[]
}

export interface SearchResult {
  id: string
  targetType: string
  targetKey: string
  text: string
  embeddingModel: string
  distance: number
}
