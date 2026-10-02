import assert from 'node:assert/strict'
import test from 'node:test'
import { createLifecycleCommandGate } from '../src/lifecycle-command.js'

test('a later unbind cannot overtake an earlier delayed lifecycle confirmation', async () => {
  const gate = createLifecycleCommandGate()
  let visible = ['a', 'b']
  let releaseEarlier!: (tasks: string[]) => void
  const earlierResponse = new Promise<string[]>(resolve => { releaseEarlier = resolve })
  const earlierUnbind = gate.run(async () => {
    visible = await earlierResponse
  })

  let laterSent = false
  await assert.rejects(gate.run(async () => {
    laterSent = true
    visible = []
  }), { name: 'LifecycleCommandPendingError' })
  assert.equal(laterSent, false, 'all bind/unbind widgets share one pending command')

  releaseEarlier(['b'])
  await earlierUnbind
  await gate.run(async () => { visible = [] })
  assert.deepEqual(visible, [], 'the earlier snapshot is applied before the later request can start')
})

test('failed lifecycle confirmation releases the shared gate', async () => {
  const gate = createLifecycleCommandGate()
  await assert.rejects(gate.run(async () => {
    throw new Error('confirmation unavailable')
  }), /confirmation unavailable/)
  const result = await gate.run(async () => 'confirmed')
  assert.equal(result, 'confirmed')
})
