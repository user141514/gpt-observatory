import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ObservationAuthorityError,
  observeExternalWithSemanticProjection,
  observeWithSemanticProjection,
} from './observe-service.js'
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

test('external observation cannot overwrite Watchdog-owned prompt facts', async () => {
  let observeCalls = 0
  let indexCalls = 0

  const forbidden: ObserveInput = {
    source: { key: 'external-agent', type: 'agent' },
    entity: {
      stableKey: 'task:task-alpha',
      type: 'task',
      label: 'Task Alpha',
    },
    coverage: ['watchdog_prompt_version'],
    facts: {
      watchdog_prompt_version: 999,
      watchdog_prompt_step_prompt: 'spoofed prompt',
    },
  }

  await assert.rejects(
    observeExternalWithSemanticProjection(
      {
        async observe() {
          observeCalls += 1
          return {
            observationId: 'should-not-exist',
            entityId: 'should-not-exist',
            changedAttributes: [],
            unchangedAttributes: [],
          }
        },
      },
      {
        async indexEntity() {
          indexCalls += 1
          return true
        },
      },
      forbidden,
    ),
    (error: unknown) =>
      error instanceof ObservationAuthorityError
      && error.attributes.includes('watchdog_prompt_version')
      && error.attributes.includes('watchdog_prompt_step_prompt'),
  )

  assert.equal(observeCalls, 0)
  assert.equal(indexCalls, 0)
})

test('external observation cannot close a Watchdog prompt interval via coverage only', async () => {
  let observeCalls = 0
  const forbidden: ObserveInput = {
    source: { key: 'external-agent', type: 'agent' },
    entity: {
      stableKey: 'task:task-alpha',
      type: 'task',
      label: 'Task Alpha',
    },
    coverage: ['status', 'watchdog_prompt_step_prompt'],
    facts: { status: 'active' },
  }

  await assert.rejects(
    observeExternalWithSemanticProjection(
      {
        async observe() {
          observeCalls += 1
          return {
            observationId: 'should-not-exist',
            entityId: 'should-not-exist',
            changedAttributes: [],
            unchangedAttributes: [],
          }
        },
      },
      {
        async indexEntity() {
          return true
        },
      },
      forbidden,
    ),
    ObservationAuthorityError,
  )

  assert.equal(observeCalls, 0)
})

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
