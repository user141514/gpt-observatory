import type { ObserveInput, ObserveResult } from './store.js'

export interface ObserveProjectionResult extends ObserveResult {
  semanticProjection: {
    status: 'indexed' | 'skipped' | 'degraded'
    warning?: 'semantic_projection_failed'
  }
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
