import assert from 'node:assert/strict'
import test from 'node:test'
import { createDatabase } from './db.js'
import { createStore } from './store.js'
import { createWatchdogBridge } from './watchdog.js'
import * as statusUi from '../src/task-status.js'

test('binding feedback never turns pending/unavailable normal observation into full success', () => {
  const feedback = (statusUi as any).manualBindFeedback
  assert.equal(typeof feedback, 'function')
  const pending = feedback({ mechanicalAttached: true, normalBinding: { status: 'pending' } })
  assert.match(pending.message, /正在重新挂载/)
  const failed = feedback({ mechanicalAttached: true, normalBinding: { status: 'unavailable', reason: 'no_anchor' } })
  assert.equal(failed.tone, 'error')
  assert.match(failed.message, /no_anchor/)
  assert.equal(feedback({ mechanicalAttached: false }).tone, 'error')
  const ready = feedback({ mechanicalAttached: true, normalBinding: { status: 'observed' } })
  assert.equal(ready.tone, 'ok')
  assert.match(ready.message, /已取得页面观测/)
})

const cid = '00000000-0000-4000-8000-000000000173'
const operation = '00000000-0000-4000-8000-000000000174'
const normal = { status: 'pending', operation_id: operation, registration_id: operation,
  requested_at: 1791350000, reason: 'normal_rebind_pending' }

for (const state of ['rebinding', 'observation_unavailable']) {
  test(`${state} cannot be operational despite a non-throwing poll`, async () => {
    const db = await createDatabase('mem://')
    try {
      const bridge = createWatchdogBridge(createStore(db), { fetchImpl: async input => {
        const url = String(input)
        if (url.endsWith('/health')) return Response.json({ ready: true, polling_fresh: true, protocol_version: 2 })
        if (url.endsWith('/watches')) return Response.json({ watches: [{
          conversation_id: cid, target_url: `https://chatgpt.com/c/${cid}`, state,
          connected: true, last_success_at: 1791350001, last_error: null,
          diagnostics: { observation_available: false }, normal_binding: normal,
        }] })
        throw new Error(`Unexpected request ${url}`)
      } })
      const snapshot = await bridge.sync()
      assert.equal(snapshot.tasks[0]?.operational, false)
      assert.deepEqual((snapshot.tasks[0] as any).normalBinding?.status, 'pending')
    } finally { await db.close() }
  })
}

test('manual binding preserves mechanical receipt and separately reports normal rebind request', async () => {
  const db = await createDatabase('mem://')
  try {
    const bridge = createWatchdogBridge(createStore(db), { fetchImpl: async input => {
      const url = String(input)
      if (url.endsWith('/register')) return Response.json({ conversation_id: cid, created: false,
        operation_id: operation, mechanical_attached: true, normal_binding: normal })
      if (url.endsWith('/health')) return Response.json({ ready: true, polling_fresh: true, protocol_version: 2 })
      if (url.endsWith('/watches')) return Response.json({ watches: [{ conversation_id: cid,
        target_url: `https://chatgpt.com/c/${cid}`, state: 'rebinding', connected: false,
        normal_binding: normal }] })
      throw new Error(`Unexpected request ${url}`)
    } })
    const result: any = await bridge.register(`https://chatgpt.com/c/${cid}`, operation)
    assert.equal(result.confirmed, true)
    assert.equal(result.mechanicalAttached, true)
    assert.equal(result.normalBinding?.operationId, operation)
    assert.equal(result.normalBinding?.status, 'pending')
  } finally { await db.close() }
})
