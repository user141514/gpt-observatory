import assert from 'node:assert/strict'
import test from 'node:test'
import { Table } from 'surrealdb'
import { createDatabase } from './db.js'
import { createStore, rows } from './store.js'

test('same observed value proves unchanged without fabricating a new fact', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)
    const base = {
      source: { key: 'test-observer', type: 'test' },
      entity: { stableKey: 'task:test', type: 'task', label: 'Test task' },
      coverage: ['status'],
    }

    const first = await store.observe({ ...base, facts: { status: 'running' } })
    const second = await store.observe({ ...base, facts: { status: 'running' } })
    const third = await store.observe({ ...base, facts: { status: 'completed' } })

    assert.deepEqual(first.changedAttributes, ['status'])
    assert.deepEqual(second.unchangedAttributes, ['status'])
    assert.deepEqual(third.changedAttributes, ['status'])

    const observations = rows(await db.query('SELECT * FROM observation'))
    const facts = rows(
      await db.query('SELECT * FROM fact WHERE attribute = "status" ORDER BY valid_from'),
    )

    assert.equal(observations.length, 3)
    assert.equal(facts.length, 2)
    assert.ok(facts[0]?.valid_to)
    assert.equal(facts[1]?.valid_to ?? null, null)

    const current = await store.currentEntities()
    const task = current.find(entity => entity.stableKey === 'task:test')
    assert.equal(task?.factDetails.length, 1)
    assert.equal(task?.factDetails[0]?.attribute, 'status')
    assert.equal(task?.factDetails[0]?.value, 'completed')
    assert.equal(task?.factDetails[0]?.source?.key, 'test-observer')
    assert.equal(task?.factDetails[0]?.source?.type, 'test')
    assert.equal(task?.factDetails[0]?.observationStatus, 'ok')
    assert.ok(task?.factDetails[0]?.observedAt)
    assert.ok(task?.factDetails[0]?.validFrom)

    const timeline = await store.timeline()
    const statusEvents = timeline.filter((event) => event.attribute === 'status')
    assert.equal(statusEvents.length, 2)
    assert.equal(statusEvents.filter((event) => event.initial === false).length, 1)
  } finally {
    await db.close()
  }
})

test('current fact provenance survives more than 5000 newer unrelated observations', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)
    const base = {
      source: { key: 'provenance-source', type: 'test' },
      entity: { stableKey: 'task:provenance', type: 'task', label: 'Provenance task' },
      coverage: ['status'],
    }

    await store.observe({ ...base, facts: { status: 'running' } })

    const source = rows(
      await db.query('SELECT id FROM source WHERE key = "provenance-source" LIMIT 1'),
    )[0]
    const entity = rows(
      await db.query('SELECT id FROM entity WHERE stable_key = "task:provenance" LIMIT 1'),
    )[0]
    assert.ok(source?.id)
    assert.ok(entity?.id)

    const start = Date.parse('2026-09-28T00:00:00.000Z')
    const filler = Array.from({ length: 5105 }, (_, index) => {
      const at = new Date(start + index + 1)
      return {
        source: source.id,
        entity: entity.id,
        observed_at: at,
        recorded_at: at,
        coverage: ['heartbeat'],
        snapshot_hash: `filler-${index}`,
        raw_payload: { index },
        status: 'ok',
      }
    })

    await db.insert(new Table('observation'), filler)

    const current = await store.currentEntities()
    const task = current.find(item => item.stableKey === 'task:provenance')
    const status = task?.factDetails.find(fact => fact.attribute === 'status')

    assert.equal(status?.value, 'running')
    assert.equal(status?.source?.key, 'provenance-source')
    assert.equal(status?.source?.type, 'test')
    assert.ok(status?.observationId)
    assert.ok(status?.observedAt)
  } finally {
    await db.close()
  }
})

test('same factual relation adds observation coverage without duplicating the edge', async () => {
  const db = await createDatabase('mem://')
  try {
    const store = createStore(db)
    const input = {
      source: { key: 'test-observer', type: 'test' },
      from: { stableKey: 'task:test', type: 'task', label: 'Test task' },
      predicate: 'USES',
      to: { stableKey: 'repo:test', type: 'repo', label: 'Test repo' },
    }

    const first = await store.setRelation(input)
    const second = await store.setRelation(input)

    assert.equal(first.relationChanged, true)
    assert.equal(second.relationChanged, false)

    const observations = rows(await db.query('SELECT * FROM observation'))
    const relations = rows(await db.query('SELECT * FROM relation'))

    assert.equal(observations.length, 2)
    assert.equal(relations.length, 1)
    assert.equal(relations[0]?.valid_to ?? null, null)
  } finally {
    await db.close()
  }
})
