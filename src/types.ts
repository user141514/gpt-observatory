export interface CurrentEntity {
  id: string
  stableKey: string
  type: string
  label: string
  metadata: Record<string, unknown>
  lastObservedAt?: string
  currentFacts: Record<string, unknown>
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

export interface SearchResult {
  id: string
  targetType: string
  targetKey: string
  text: string
  embeddingModel: string
  distance: number
}
