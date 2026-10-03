import assert from 'node:assert/strict'
import test from 'node:test'
import { observationUnavailableMessage, runtimeTabPresentation, taskStatus } from '../src/task-status.js'

const observedAt = '2026-10-03T16:14:28.528Z'
const observedNow = Date.parse(observedAt)
const readableTask = {
  watchdogState: 'waiting_for_assistant',
  runtimeTabState: 'unknown' as const,
  connected: true,
  consecutiveFailures: 0,
  runtimeTabObservation: {
    available: true, readable: true, source: 'browser', observedAt,
    reason: 'observation_identity_incomplete',
  },
}

test('page readability is separate from missing runtime tab metadata', () => {
  const display = runtimeTabPresentation(readableTask, true, observedNow + 5_000)
  assert.equal(display.status, 'readable')
  assert.match(display.label, /读取正常/)
  assert.match(display.detail, /编号未提供/)
  assert.equal(runtimeTabPresentation({
    ...readableTask, runtimeTabObservation: undefined,
  }, true, observedNow).status, 'not_reported')
})

test('old or invalid observations never imply a current readable tab', () => {
  for (const offset of [30_001, -5_001]) {
    assert.equal(runtimeTabPresentation(readableTask, true, observedNow + offset).status, 'stale')
  }
  assert.equal(runtimeTabPresentation(readableTask, true, observedNow + 30_000).status, 'readable')
  for (const observedAt of [undefined, 'not-a-date']) {
    assert.equal(runtimeTabPresentation({
      ...readableTask, runtimeTabObservation: { ...readableTask.runtimeTabObservation, observedAt },
    }, true, observedNow).status, 'stale')
  }
  assert.equal(runtimeTabPresentation({
    ...readableTask, runtimeTabObservation: { ...readableTask.runtimeTabObservation, source: 'native_terminal' },
  }, true, observedNow).status, 'not_reported')
})

test('failed or disconnected observation overrides retained success and tab metadata', () => {
  const withTab = {
    ...readableTask, runtimeTabState: 'present' as const,
    runtimeTab: { id: 'TAB_A', title: '', url: 'https://chatgpt.com/c/chat-a' },
  }
  assert.equal(runtimeTabPresentation(withTab, true, observedNow).label, '已识别标签页')
  for (const task of [
    { ...withTab, connected: false },
    { ...withTab, lastError: 'observation read failed' },
    { ...withTab, consecutiveFailures: 1 },
    { ...withTab, watchdogState: 'observation_unavailable' },
    { ...withTab, runtimeTabObservation: { ...withTab.runtimeTabObservation, available: false } },
    { ...withTab, runtimeTabObservation: { ...withTab.runtimeTabObservation, readable: false } },
  ]) {
    assert.equal(runtimeTabPresentation(task, true, observedNow).status, 'unavailable')
  }
  assert.equal(runtimeTabPresentation(withTab, false, observedNow).status, 'unavailable')
  assert.equal(runtimeTabPresentation(withTab, true, observedNow + 31_000).status, 'stale')
})

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
