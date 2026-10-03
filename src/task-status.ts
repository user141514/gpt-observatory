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

type RuntimeTabTask = Pick<SupervisedTask,
  'watchdogState' | 'runtimeTabState' | 'runtimeTab' | 'runtimeTabObservation'
  | 'connected' | 'lastError' | 'consecutiveFailures'
>

export function runtimeTabPresentation(task: RuntimeTabTask, registryAvailable: boolean, now = Date.now()) {
  const observation = task.runtimeTabObservation
  if (!registryAvailable || !task.connected || task.lastError || task.consecutiveFailures > 0
    || task.watchdogState === 'observation_unavailable' || observation?.available === false
    || (observation?.source === 'browser' && !observation.readable)) {
    return { status: 'unavailable', label: '暂时无法读取页面', detail: '等待下一次成功读取' }
  }

  if (observation?.available && observation.source === 'browser') {
    const age = now - Date.parse(observation.observedAt ?? '')
    // Match Watchdog's browser-observation validity window; DONE may retain an old sample.
    if (!Number.isFinite(age) || age < -5_000 || age > 30_000) {
      return {
        status: 'stale',
        label: age > 30_000 ? '页面观测已过期' : '观测时间待确认',
        detail: age > 30_000 ? '最近一次读取已超过30秒' : '尚无有效的页面观测时间',
      }
    }
  }

  if (task.runtimeTabState === 'present' && task.runtimeTab?.id) {
    return { status: 'present', label: task.runtimeTab.title?.trim() || '已识别标签页', detail: task.runtimeTab.id }
  }
  if (task.runtimeTabState === 'absent') {
    return { status: 'absent', label: '当前页面未显示', detail: '未观测到运行时标签页' }
  }
  if (observation?.available && observation.source === 'browser' && observation.readable) {
    return { status: 'readable', label: '最近读取正常', detail: '标签页编号未提供' }
  }
  return { status: 'not_reported', label: '标签页信息未提供', detail: '监督器未返回标签页信息' }
}

export function observationUnavailableMessage(task: TaskState): string | undefined {
  if (task.watchdogState === 'observation_unavailable'
    && task.observationUnavailableReason === 'persistent_turn_identity_unavailable') {
    return '当前页面未提供持久轮次标识，暂不能读取监督状态。'
  }
  return undefined
}
