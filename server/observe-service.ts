import type { ObserveInput, ObserveResult } from './store.js'

const WATCHDOG_PROMPT_FACT_PREFIX = 'watchdog_prompt_'

export class ObservationAuthorityError extends Error {
  readonly attributes: string[]

  constructor(attributes: string[]) {
    const unique = [...new Set(attributes)].sort()
    super(
      `external observations cannot write Watchdog-owned prompt facts: ${unique.join(', ')}`,
    )
    this.name = 'ObservationAuthorityError'
    this.attributes = unique
  }
}

export interface ObserveProjectionResult extends ObserveResult {
  semanticProjection: {
    status: 'indexed' | 'skipped' | 'degraded'
    warning?: 'semantic_projection_failed'
  }
}

export function assertExternalObservationAuthority(
  input: ObserveInput,
): void {
  const attributes = [
    ...input.coverage,
    ...Object.keys(input.facts),
  ]
  const forbidden = attributes.filter(attribute =>
    attribute.startsWith(WATCHDOG_PROMPT_FACT_PREFIX),
  )
  if (forbidden.length) {
    throw new ObservationAuthorityError(forbidden)
  }
}

export async function observeExternalWithSemanticProjection(
  store: {
    observe(input: ObserveInput): Promise<ObserveResult>
  },
  semantic: {
    indexEntity(entityId: string): Promise<boolean>
  },
  input: ObserveInput,
  onProjectionError: (error: unknown) => void = () => {},
): Promise<ObserveProjectionResult> {
  assertExternalObservationAuthority(input)
  return observeWithSemanticProjection(
    store,
    semantic,
    input,
    onProjectionError,
  )
}

export async function observeWithSemanticProjection(
  store: {
    observe(input: ObserveInput): Promise<ObserveResult>
  },
  semantic: {
    indexEntity(entityId: string): Promise<boolean>
  },
  input: ObserveInput,
  onProjectionError: (error: unknown) => void = () => {},
): Promise<ObserveProjectionResult> {
  const canonical = await store.observe(input)

  try {
    const indexed = await semantic.indexEntity(canonical.entityId)
    return {
      ...canonical,
      semanticProjection: {
        status: indexed ? 'indexed' : 'skipped',
      },
    }
  } catch (error) {
    onProjectionError(error)
    return {
      ...canonical,
      semanticProjection: {
        status: 'degraded',
        warning: 'semantic_projection_failed',
      },
    }
  }
}
