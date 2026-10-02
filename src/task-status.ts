import type { SupervisedTask } from './types.js'

type TaskState = Pick<SupervisedTask, 'watchdogState' | 'operational'> & {
  observationUnavailableReason?: string
}

export function taskStatus(task: TaskState, integrationReady: boolean, registryAvailable = integrationReady) {
  if (!registryAvailable) {
    return { zh: '状态未知', en: 'UNVERIFIED', tone: 'unknown' }
  }
  const state = task.watchdogState
  if (state === 'observation_unavailable') {
    return { zh: '观测不可用', en: 'OBSERVATION UNAVAILABLE', tone: 'unknown' }
  }
  if (!integrationReady) return { zh: '状态未知', en: 'UNVERIFIED', tone: 'unknown' }
  if (state === 'need_input') return { zh: '等待输入', en: 'NEED INPUT', tone: 'waiting' }
  if (state === 'submission_unknown') return { zh: '发送待确认', en: 'DELIVERY UNCERTAIN', tone: 'waiting' }
  if (state === 'sent_no_visible_progress') return { zh: '等待进展', en: 'WAITING PROGRESS', tone: 'waiting' }
  if (state === 'send_rejected' || state === 'target_changed' || state === 'degraded') {
    return { zh: '监督异常', en: 'DEGRADED', tone: 'degraded' }
  }
  if (state === 'done') return { zh: '任务完成', en: 'DONE', tone: 'healthy' }
  if (task.operational) return { zh: '监督正常', en: 'OPERATIONAL', tone: 'healthy' }
  return { zh: '监督异常', en: 'DEGRADED', tone: 'degraded' }
}

export function observationUnavailableMessage(task: TaskState): string | undefined {
  if (task.watchdogState === 'observation_unavailable'
    && task.observationUnavailableReason === 'persistent_turn_identity_unavailable') {
    return '当前页面未提供持久轮次标识，暂不能读取监督状态。'
  }
  return undefined
}
