import type { SupervisedTask, WatchdogRegisterResult } from './types.js'

export function manualBindFeedback(result: Pick<WatchdogRegisterResult, 'mechanicalAttached' | 'normalBinding'>): {
  tone: 'ok' | 'error'; message: string
} {
  if (result.mechanicalAttached !== true) {
    return { tone: 'error', message: '注册已确认，但机械兜底尚无挂载确认；不要视为双路径就绪。' }
  }
  const binding = result.normalBinding
  if (binding?.status === 'observed') {
    return { tone: 'ok', message: '机械兜底已挂载；正常路径已重新挂载并已取得页面观测。' }
  }
  if (binding?.status === 'unavailable') {
    return { tone: 'error', message: `机械兜底已挂载；正常路径观测失败：${binding.reason ?? '原因未提供'}。` }
  }
  if (binding?.status === 'pending') {
    return { tone: 'ok', message: '机械兜底已挂载；正常路径正在重新挂载，以下任务卡会更新观测结果。' }
  }
  return { tone: 'error', message: '机械兜底已挂载；正常路径尚无重绑回执。' }
}

type TaskState = Pick<SupervisedTask, 'watchdogState' | 'operational'> & {
  observationUnavailableReason?: string
}

export function taskStatus(task: TaskState, integrationReady: boolean, registryAvailable = integrationReady) {
  if (!registryAvailable) {
    return { zh: '状态未知', en: 'UNVERIFIED', tone: 'unknown' }
  }
  const state = task.watchdogState
  if (state === 'rebinding') return { zh: '正在重新挂载', en: 'REBINDING', tone: 'waiting' }
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
  if (task.watchdogState !== 'observation_unavailable') return undefined
  if (task.observationUnavailableReason === 'persistent_turn_identity_unavailable') {
    return '当前页面未提供持久轮次标识，暂不能读取监督状态。'
  }
  if (task.observationUnavailableReason === 'human_turn_anchor_unavailable') {
    return '浏览器连接仍可用，但旧人工轮次锚点已离开当前页面；请重新绑定此对话以确认当前轮次。'
  }
  return undefined
}
