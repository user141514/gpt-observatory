import assert from 'node:assert/strict'
import test from 'node:test'
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

    const timeline = await store.timeline()
    const statusEvents = timeline.filter((event) => event.attribute === 'status')
    assert.equal(statusEvents.length, 2)
    assert.equal(statusEvents.filter((event) => event.initial === false).length, 1)
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
