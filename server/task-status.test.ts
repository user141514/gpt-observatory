import assert from 'node:assert/strict'
import test from 'node:test'
import { observationUnavailableMessage, taskStatus } from '../src/task-status.js'

const unavailable = {
  watchdogState: 'observation_unavailable',
  operational: false,
  observationUnavailableReason: 'persistent_turn_identity_unavailable',
  lastError: 'RuntimeError: persistent_turn_identity_unavailable',
}

test('a fresh registry classifies unavailable observation explicitly even when supervision is not ready', () => {
  for (const ready of [true, false]) {
    assert.deepEqual(taskStatus(unavailable, ready, true), {
      zh: '观测不可用', en: 'OBSERVATION UNAVAILABLE', tone: 'unknown',
    })
  }
})

test('an unavailable registry keeps the last known observation state unverified', () => {
  assert.deepEqual(taskStatus(unavailable, false, false), {
    zh: '状态未知', en: 'UNVERIFIED', tone: 'unknown',
  })
})

test('known persistent turn identity reason gets human text while preserving raw error', () => {
  assert.equal(
    observationUnavailableMessage(unavailable),
    '当前页面未提供持久轮次标识，暂不能读取监督状态。',
  )
  assert.equal(unavailable.lastError, 'RuntimeError: persistent_turn_identity_unavailable')
})

test('unrelated state or reason does not fabricate the known observation explanation', () => {
  assert.equal(observationUnavailableMessage({
    ...unavailable, watchdogState: 'target_changed',
  }), undefined)
  assert.equal(observationUnavailableMessage({
    ...unavailable, observationUnavailableReason: 'supervision_identity_mismatch',
  }), undefined)
  assert.deepEqual(taskStatus({ watchdogState: 'need_input', operational: false }, true), {
    zh: '等待输入', en: 'NEED INPUT', tone: 'waiting',
  })
})
