import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDatabase } from './db.js'
import { createStore } from './store.js'

test('semantic search stays offline and self-heals its current embedding index', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpt-observatory-semantic-'))
  const previousHome = process.env.GPT_OBSERVATORY_HOME
  const previousFetch = globalThis.fetch

  process.env.GPT_OBSERVATORY_HOME = home
  globalThis.fetch = async () => {
    throw new Error('NETWORK_FETCH_FORBIDDEN_IN_OFFLINE_EMBEDDING_TEST')
  }

  const db = await createDatabase('mem://')

  try {
    const {
      EMBEDDING_DIMENSION,
      FALLBACK_EMBEDDING_MODEL,
      embed,
    } = await import('./embedding.js')
    const { createSemanticIndex } = await import('./semantic.js')

    const first = await embed('GPT Observatory commercial local application')
    const second = await embed('GPT Observatory commercial local application')

    assert.equal(first.model, FALLBACK_EMBEDDING_MODEL)
    assert.equal(first.vector.length, EMBEDDING_DIMENSION)
    assert.deepEqual(first.vector, second.vector)

    const norm = Math.sqrt(first.vector.reduce((sum, value) => sum + value * value, 0))
    assert.ok(Math.abs(norm - 1) < 1e-9)

    const store = createStore(db)
    await store.observe({
      source: { key: 'offline-semantic-test', type: 'test' },
      entity: {
        stableKey: 'task:offline-search',
        type: 'task',
        label: 'Offline Search Task',
      },
      coverage: ['status', 'phase'],
      facts: {
        status: 'active',
        phase: 'commercial local app ready',
      },
    })
    await store.observe({
      source: { key: 'offline-semantic-test', type: 'test' },
      entity: {
        stableKey: 'service:unrelated',
        type: 'service',
        label: 'Unrelated Service',
      },
      coverage: ['status'],
      facts: {
        status: 'idle',
      },
    })

    assert.equal((await store.counts()).semantic, 0)

    const semantic = createSemanticIndex(db, store)
    const results = await semantic.search('commercial local app')

    assert.ok(results.length > 0)
    assert.equal(results[0]?.targetKey, 'task:offline-search')
    assert.equal(results[0]?.embeddingModel, FALLBACK_EMBEDDING_MODEL)

    const counts = await store.counts()
    assert.equal(counts.semantic, 2)
  } finally {
    await db.close()
    globalThis.fetch = previousFetch
    if (previousHome === undefined) {
      delete process.env.GPT_OBSERVATORY_HOME
    } else {
      process.env.GPT_OBSERVATORY_HOME = previousHome
    }
    await rm(home, { recursive: true, force: true })
  }
})
