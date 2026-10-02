import assert from 'node:assert/strict'
import test from 'node:test'
import { createRegistryRefreshGate } from '../src/registry-refresh.js'

test('confirmed registry snapshot fences an earlier refresh response delivered after unbind', async () => {
  const gate = createRegistryRefreshGate()
  let visible = ['conversation-a']
  let releaseOldResponse!: (tasks: string[]) => void
  const oldResponse = new Promise<string[]>(resolve => { releaseOldResponse = resolve })
  const acceptOld = gate.begin()
  const oldRefresh = oldResponse.then(tasks => {
    if (acceptOld()) visible = tasks
  })

  const acceptConfirmed = gate.begin()
  visible = []
  releaseOldResponse(['conversation-a'])
  await oldRefresh

  assert.equal(acceptConfirmed(), true)
  assert.equal(acceptOld(), false)
  assert.deepEqual(visible, [], 'late pre-unbind response cannot restore the task')
})

test('latest refresh also fences older facts and errors', () => {
  const gate = createRegistryRefreshGate()
  const older = gate.begin()
  const latest = gate.begin()
  assert.equal(older(), false)
  assert.equal(latest(), true)
})
