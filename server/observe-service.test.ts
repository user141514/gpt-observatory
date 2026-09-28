import assert from 'node:assert/strict'
import test from 'node:test'
import { observeWithSemanticProjection } from './observe-service.js'
import type { ObserveInput } from './store.js'

const input: ObserveInput = {
  source: { key: 'observe-service-test', type: 'test' },
  entity: {
    stableKey: 'task:observe-service',
    type: 'task',
    label: 'Observe Service Test',
  },
  coverage: ['status'],
  facts: { status: 'active' },
}

test('semantic projection failure cannot revoke an accepted canonical observation', async () => {
  let observeCalls = 0
  let indexCalls = 0
  const projectionErrors: unknown[] = []

  const result = await observeWithSemanticProjection(
    {
      async observe() {
        observeCalls += 1
        return {
          observationId: 'observation:accepted',
          entityId: 'entity:accepted',
          changedAttributes: ['status'],
          unchangedAttributes: [],
        }
      },
    },
    {
      async indexEntity() {
        indexCalls += 1
        throw new Error('semantic backend unavailable')
      },
    },
    input,
    error => projectionErrors.push(error),
  )

  assert.equal(observeCalls, 1)
  assert.equal(indexCalls, 1)
  assert.equal(result.observationId, 'observation:accepted')
  assert.equal(result.entityId, 'entity:accepted')
  assert.deepEqual(result.semanticProjection, {
    status: 'degraded',
    warning: 'semantic_projection_failed',
  })
  assert.equal(projectionErrors.length, 1)
  assert.match(String(projectionErrors[0]), /semantic backend unavailable/)
})

test('canonical observation failure remains a request failure and skips projection', async () => {
  let indexCalls = 0

  await assert.rejects(
    observeWithSemanticProjection(
      {
        async observe() {
          throw new Error('canonical write failed')
        },
      },
      {
        async indexEntity() {
          indexCalls += 1
          return true
        },
      },
      input,
    ),
    /canonical write failed/,
  )

  assert.equal(indexCalls, 0)
})
