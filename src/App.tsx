import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  FlaskConical,
  FolderGit2,
  GitBranch,
  History,
  Info,
  Layers3,
  Link2,
  LockKeyhole,
  Maximize2,
  MessageSquareText,
  Monitor,
  Network,
  Orbit,
  RefreshCw,
  RotateCcw,
  Save,
  Search as SearchIcon,
  Server,
  ShieldCheck,
  Sparkles,
  Unlink2,
  Waypoints,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import { api } from './api'
import type {
  CurrentEntity,
  CurrentFactDetail,
  GraphResponse,
  NowResponse,
  SearchResult,
  SupervisedTask,
  SupervisedTasksResponse,
  TaskPromptState,
  TimelineEvent,
} from './types'
import './App.css'

type Tab = 'tasks' | 'now' | 'timeline' | 'graph' | 'search'
type GraphNode = GraphResponse['nodes'][number]

const tabs: Array<{ id: Tab; zh: string; en: string; icon: LucideIcon }> = [
  { id: 'tasks', zh: '监督任务', en: 'SUPERVISED TASKS', icon: ShieldCheck },
  { id: 'now', zh: '事实视图', en: 'FACT EXPLORER', icon: Database },
  { id: 'timeline', zh: '时间线', en: 'TIMELINE', icon: History },
  { id: 'graph', zh: '知识图谱', en: 'KNOWLEDGE GRAPH', icon: Waypoints },
  { id: 'search', zh: '语义检索', en: 'SEMANTIC SEARCH', icon: SearchIcon },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('tasks')
  const [supervised, setSupervised] = useState<SupervisedTasksResponse>({
    integration: {
      available: false,
      ready: false,
      promptAvailable: false,
      watchdogUrl: 'http://127.0.0.1:9235',
      relayUrl: 'http://127.0.0.1:9224',
    },
    tasks: [],
  })
  const [now, setNow] = useState<NowResponse>({ counts: {}, entities: [] })
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [] })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    setRefreshing(true)
    try {
      const supervisedTasks = await api.syncWatchdog()
      const [n, t, g] = await Promise.all([api.now(), api.timeline(), api.graph()])
      setSupervised(supervisedTasks)
      setNow(n)
      setTimeline(t.events)
      setGraph(g)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    try {
      setResults((await api.search(query.trim())).results)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <>
      <div className="ambient-layer" aria-hidden="true" />
      <div className="noise-layer" aria-hidden="true" />

      <main className="shell">
        <header className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow-row">
              <span className="live-pulse" aria-hidden="true" />
              <span>本地事实状态系统</span>
              <small>LOCAL FACTUAL STATE SYSTEM</small>
            </div>

            <div className="hero-title-row">
              <div className="brand-mark" aria-hidden="true"><Orbit size={24} strokeWidth={1.7} /></div>
              <h1>GPT 观测站</h1>
              <span>GPT Observatory</span>
            </div>

            <p className="hero-subtitle">
              用时间、关系与语义，持续看清智能体正在做什么。
              <span>Understand agent work through time, relations and semantic state.</span>
            </p>
          </div>

          <div className="hero-actions">
            <div className="system-state" title={error || 'Canonical API reachable'}>
              <span className={error ? 'system-dot system-dot-error' : 'system-dot'} />
              <div>
                <strong>{error ? '需要检查 / Attention' : '事实源在线 / Canonical Online'}</strong>
                <span>{refreshing ? '正在同步 / Synchronizing…' : '本地 · 持久 · 可追溯 / Local · Durable · Traceable'}</span>
              </div>
            </div>

            <button
              type="button"
              className="refresh-button"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? 'refresh-icon spinning' : 'refresh-icon'} size={16} aria-hidden="true" />
              <span>{refreshing ? '同步中' : '刷新'}<small>{refreshing ? 'SYNCING' : 'REFRESH'}</small></span>
            </button>
          </div>
        </header>

        <section className="metrics" aria-label="Observatory metrics">
          <Metric zh="监督任务" en="Supervised" value={supervised.tasks.length} detail="Watchdog 管理对象" />
          <Metric
            zh="监督可用"
            en="Operational"
            value={supervised.integration.ready
              ? supervised.tasks.filter(task => task.operational).length
              : 0}
            detail="Watchdog 最近成功执行"
          />
          <Metric
            zh="异常"
            en="Degraded"
            value={supervised.integration.ready
              ? supervised.tasks.filter(task => !task.operational).length
              : 0}
            detail="需要检查的监督状态"
          />
          <Metric zh="当前对话" en="Conversations" value={supervised.tasks.length} detail="任务执行绑定" />
          <Metric zh="事实" en="Facts" value={now.counts.facts ?? 0} detail="时态状态区间" />
        </section>

        <nav className="view-nav" aria-label="Observatory views">
          {tabs.map(item => {
            const Icon = item.icon
            return (
              <button
                className={tab === item.id ? 'view-tab active' : 'view-tab'}
                onClick={() => setTab(item.id)}
                key={item.id}
                type="button"
              >
                <Icon className="view-tab-icon" size={17} strokeWidth={1.8} />
                <span>{item.zh}</span>
                <small>{item.en}</small>
              </button>
            )
          })}
        </nav>

        {error && (
          <div className="error-panel" role="alert">
            <strong>观测站接口异常 / Observatory API Error</strong>
            <span>{error}</span>
          </div>
        )}

        <section className="workspace-panel">
          {tab === 'tasks' && (
            <SupervisedTasks
              data={supervised}
              onPromptSaved={refresh}
            />
          )}
          {tab === 'now' && <Now data={now} />}
          {tab === 'timeline' && <Timeline events={timeline} />}
          {tab === 'graph' && <GraphWorkbench data={graph} />}
          {tab === 'search' && (
            <Search query={query} setQuery={setQuery} results={results} submit={search} />
          )}
        </section>
      </main>
    </>
  )
}

function Metric({ zh, en, value, detail }: { zh: string; en: string; value: number; detail: string }) {
  return (
    <article className="metric-card">
      <div className="metric-label">
        <span>{zh}</span>
        <small>{en}</small>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

function SupervisedTasks({
  data,
  onPromptSaved,
}: {
  data: SupervisedTasksResponse
  onPromptSaved: () => Promise<void>
}) {
  const [targetUrl, setTargetUrl] = useState('')
  const [binding, setBinding] = useState(false)
  const [bindingFeedback, setBindingFeedback] = useState<{
    tone: 'ok' | 'error'
    message: string
  } | null>(null)
  const [recentlyUnbound, setRecentlyUnbound] = useState<Array<{
    task: SupervisedTask
    removed: boolean
  }>>([])

  const activeConversationIds = new Set(
    data.tasks.map(task => task.currentConversation.id),
  )
  const visibleUnboundReceipts = recentlyUnbound.filter(
    receipt => !activeConversationIds.has(receipt.task.currentConversation.id),
  )

  const healthy = data.integration.ready
    ? data.tasks.filter(task => task.operational).length
    : 0
  const attention = data.integration.ready
    ? data.tasks.length - healthy
    : 0

  async function bindWatchdog(event: FormEvent) {
    event.preventDefault()
    const url = targetUrl.trim()
    if (!url || binding) return

    setBinding(true)
    setBindingFeedback(null)
    try {
      const result = await api.registerWatchdog(url)
      await onPromptSaved()
      setTargetUrl('')
      setBindingFeedback({
        tone: 'ok',
        message: result.created
          ? `已绑定 ${result.conversationId}`
          : `该对话已经在 Watchdog 中：${result.conversationId}`,
      })
    } catch (cause) {
      setBindingFeedback({
        tone: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setBinding(false)
    }
  }

  async function unbindWatchdog(task: SupervisedTask) {
    const result = await api.unregisterWatchdog(task.currentConversation.id)
    setRecentlyUnbound(current => [
      { task, removed: result.removed },
      ...current.filter(
        receipt => receipt.task.currentConversation.id !== task.currentConversation.id,
      ),
    ])
    await onPromptSaved()
  }

  return (
    <section className="supervised-section">
      <SectionHeading
        kickerZh="Watchdog 权威监督集合"
        kickerEn="WATCHDOG AUTHORITATIVE SET"
        titleZh="正在监督的任务"
        titleEn="Supervised Tasks"
        meta={data.integration.ready
          ? `${data.tasks.length} 个任务 · ${healthy} 正常 · ${attention} 需关注`
          : data.integration.available
            ? `${data.tasks.length} 个任务 · Watchdog reachable but not ready`
            : 'Watchdog integration unavailable'}
      />

      <div className={data.integration.ready ? 'integration-banner online' : 'integration-banner degraded'}>
        <div>
          <span className="integration-dot" />
          <div>
            <strong>
              {data.integration.ready
                ? 'Watchdog 联动正常'
                : data.integration.available
                  ? 'Watchdog 可访问，但监督未就绪'
                  : 'Watchdog 联动不可用'}
            </strong>
            <small>
              {data.integration.available
                ? `最近同步 ${data.integration.lastSyncAt ? dateTime(data.integration.lastSyncAt) : '—'}`
                : data.integration.error ?? 'No successful Watchdog snapshot yet.'}
            </small>
          </div>
        </div>
        <code>{data.integration.watchdogUrl}</code>
      </div>

      <form className="watchdog-bind-panel" onSubmit={bindWatchdog}>
        <div className="watchdog-bind-copy">
          <span className="watchdog-bind-icon"><Link2 size={17} strokeWidth={1.8} /></span>
          <div>
            <strong>直接绑定 Watchdog</strong>
            <small>DIRECT REGISTRATION · 不打开目标对话，不调用模型，只写入本机 Watchdog registry</small>
          </div>
        </div>
        <div className="watchdog-bind-controls">
          <input
            type="url"
            value={targetUrl}
            onChange={event => setTargetUrl(event.target.value)}
            placeholder="https://chatgpt.com/.../c/<conversation-uuid>"
            aria-label="ChatGPT conversation URL"
            disabled={binding}
            required
          />
          <button type="submit" disabled={binding || !targetUrl.trim()}>
            <Link2 size={14} strokeWidth={1.9} />
            <span>{binding ? '绑定中' : '绑定'}</span>
          </button>
        </div>
        {bindingFeedback && (
          <div className={`watchdog-bind-feedback ${bindingFeedback.tone}`} role="status">
            {bindingFeedback.message}
          </div>
        )}
      </form>

      {data.tasks.length ? (
        <div className="supervised-task-grid">
          {data.tasks.map(task => (
            <SupervisedTaskCard
              task={task}
              integrationAvailable={data.integration.ready}
              promptWritable={data.integration.promptAvailable}
              onPromptSaved={onPromptSaved}
              onUnbind={unbindWatchdog}
              key={task.taskId}
            />
          ))}
        </div>
      ) : (
        <Empty
          zh={data.integration.available ? '当前没有被监督的任务' : '尚未取得监督任务快照'}
          en={data.integration.available
            ? 'No Watchdog-registered tasks are active.'
            : 'Waiting for a successful Watchdog snapshot.'}
        />
      )}

      {visibleUnboundReceipts.length > 0 && (
        <div className="recently-unbound-block">
          <div className="recently-unbound-heading">
            <strong>最近解绑</strong>
            <small>LOCAL ACTION RECEIPTS · 不属于当前 Watchdog 权威集合</small>
          </div>
          <div className="supervised-task-grid">
            {visibleUnboundReceipts.map(receipt => (
              <UnboundTaskReceipt
                key={receipt.task.currentConversation.id}
                task={receipt.task}
                removed={receipt.removed}
                onDismiss={() => setRecentlyUnbound(current => current.filter(
                  item => item.task.currentConversation.id
                    !== receipt.task.currentConversation.id,
                ))}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function SupervisedTaskCard({
  task,
  integrationAvailable,
  promptWritable,
  onPromptSaved,
  onUnbind,
}: {
  task: SupervisedTask
  integrationAvailable: boolean
  promptWritable: boolean
  onPromptSaved: () => Promise<void>
  onUnbind: (task: SupervisedTask) => Promise<void>
}) {
  const [unbinding, setUnbinding] = useState(false)
  const [unbindError, setUnbindError] = useState('')
  const status = taskStatus(task, integrationAvailable)

  async function unbindWatchdog() {
    if (unbinding) return
    setUnbinding(true)
    setUnbindError('')
    try {
      await onUnbind(task)
    } catch (cause) {
      setUnbindError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <article className="supervised-task-card">
      <div className="task-card-head">
        <div>
          <span className={`task-status ${status.tone}`}>
            <i />
            {status.zh}
            <small>{status.en}</small>
          </span>
          <h3>{task.label}</h3>
        </div>
        <div className="task-card-actions">
          <span className="task-identity">
            {task.identitySource === 'watchdog_task_id' ? 'TASK ID' : 'LEGACY ID'}
          </span>
          <button
            type="button"
            className="watchdog-unbind-button"
            onClick={() => void unbindWatchdog()}
            disabled={unbinding}
            title="直接从 Watchdog registry 注销此对话"
          >
            <Unlink2 size={13} strokeWidth={1.9} />
            <span>{unbinding ? '解绑中' : '解绑'}</span>
          </button>
        </div>
      </div>

      {unbindError && (
        <div className="watchdog-unbind-error" role="alert">{unbindError}</div>
      )}

      <div className="task-primary-state">
        <div>
          <span>Watchdog 状态</span>
          <small>SUPERVISION STATE</small>
        </div>
        <strong>{task.watchdogState}</strong>
      </div>

      <div className="binding-stack">
        <div className="binding-row conversation-binding">
          <div className="binding-icon">C</div>
          <div className="binding-main">
            <span>当前对话 <small>CURRENT CONVERSATION</small></span>
            <strong>{task.currentConversation.id}</strong>
            <a href={task.currentConversation.url} target="_blank" rel="noreferrer">
              打开对话 / Open conversation
            </a>
          </div>
        </div>

        <div className={
          task.runtimeTabState === 'present'
            ? 'binding-row tab-binding'
            : task.runtimeTabState === 'absent'
              ? 'binding-row tab-binding muted'
              : 'binding-row tab-binding unknown'
        }>
          <div className="binding-icon">T</div>
          <div className="binding-main">
            <span>运行时标签页 <small>RUNTIME TAB</small></span>
            <strong>
              {task.runtimeTabState === 'present'
                ? task.runtimeTab?.title
                : task.runtimeTabState === 'absent'
                  ? '未绑定 / Not currently rendered'
                  : '未知 / Relay observation unavailable'}
            </strong>
            <code>{task.runtimeTabState === 'present' ? task.runtimeTab?.id : '—'}</code>
          </div>
        </div>
      </div>

      <dl className="task-diagnostics">
        <div>
          <dt>最近成功 / Last success</dt>
          <dd>{task.lastSuccessAt ? dateTime(task.lastSuccessAt) : '—'}</dd>
        </div>
        <div>
          <dt>最近轮询 / Last poll</dt>
          <dd>{task.lastPollAt ? dateTime(task.lastPollAt) : '—'}</dd>
        </div>
        <div>
          <dt>连续失败 / Failures</dt>
          <dd>{task.consecutiveFailures}</dd>
        </div>
      </dl>

      {task.lastError && (
        <div className="task-error">
          <span>监督异常 / Supervision error</span>
          <code>{task.lastError}</code>
        </div>
      )}

      {task.prompt ? (
        <TaskPromptEditor
          key={`${task.taskId}:${task.prompt.version}`}
          task={task}
          prompt={task.prompt}
          writable={promptWritable}
          onSaved={onPromptSaved}
        />
      ) : (
        <div className="prompt-feedback degraded">
          当前 Watchdog 没有提供可信的 protocol-v4 prompt state；不会显示或编辑伪造的默认版本。
        </div>
      )}
    </article>
  )
}

function UnboundTaskReceipt({
  task,
  removed,
  onDismiss,
}: {
  task: SupervisedTask
  removed: boolean
  onDismiss: () => void
}) {
  return (
    <article className="supervised-task-card unbound-receipt">
      <div className="task-card-head">
        <div>
          <span className="task-status unknown">
            <i />
            已解绑
            <small>UNREGISTERED</small>
          </span>
          <h3>{task.label}</h3>
        </div>
        <button
          type="button"
          className="receipt-dismiss-button"
          onClick={onDismiss}
        >
          关闭
        </button>
      </div>

      <div className="task-primary-state">
        <div>
          <span>Watchdog 状态</span>
          <small>SUPERVISION STATE</small>
        </div>
        <strong>unregistered</strong>
      </div>

      <div className="binding-row conversation-binding receipt-conversation">
        <div className="binding-icon">C</div>
        <div className="binding-main">
          <span>原对话 <small>FORMER CONVERSATION</small></span>
          <strong>{task.currentConversation.id}</strong>
          <a href={task.currentConversation.url} target="_blank" rel="noreferrer">
            打开对话 / Open conversation
          </a>
        </div>
      </div>

      <div className="unbind-receipt-note">
        {removed
          ? 'Watchdog registry 已确认注销。此卡片只保留本次操作回执，不计入监督任务。'
          : 'Watchdog registry 中已经没有该对话；保留此卡片作为本次操作回执。'}
      </div>
    </article>
  )
}

function TaskPromptEditor({
  task,
  prompt,
  writable,
  onSaved,
}: {
  task: SupervisedTask
  prompt: TaskPromptState
  writable: boolean
  onSaved: () => Promise<void>
}) {
  const [stepIndex, setStepIndex] = useState(prompt.stepIndex + 1)
  const [stepPrompt, setStepPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState('')
  const [feedback, setFeedback] = useState('')

  async function savePrompt(value: string | null) {
    if (!writable || saving) return
    setSaving(true)
    setFeedback('')
    try {
      await api.updateTaskPrompt(task.taskId, {
        expectedVersion: prompt.version,
        stepIndex,
        stepPrompt: value,
        updatedBy: 'observatory-ui',
      })
      setFeedback(
        value == null
          ? '已清空自适应提示词；下一轮只发送基础监督 envelope。'
          : '已保存；Watchdog 下一轮会使用新版本。',
      )
      await onSaved()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setFeedback(
        message.includes('409')
          ? '版本冲突：提示词已被其它入口更新。请刷新后基于最新版本再写。'
          : message,
      )
    } finally {
      setSaving(false)
    }
  }

  async function loadPreview() {
    if (previewing) return
    setPreviewing(true)
    setFeedback('')
    try {
      const current = await api.taskPrompt(task.taskId)
      setPreview(current.renderedPrompt ?? '')
      if (!current.renderedPrompt) {
        setFeedback('Watchdog 没有返回 rendered prompt。')
      }
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <details className="task-prompt-panel">
      <summary>
        <span className="task-prompt-summary-icon">
          <Sparkles size={15} strokeWidth={1.7} />
        </span>
        <span>
          <strong>自适应继续提示词</strong>
          <small>ADAPTIVE CONTINUATION PROMPT</small>
        </span>
        <code>v{prompt.version} · step {prompt.stepIndex}</code>
      </summary>

      <div className="task-prompt-body">
        <div className="prompt-lock-note">
          <LockKeyhole size={15} strokeWidth={1.7} />
          <div>
            <strong>基础监督 envelope 已锁定</strong>
            <span>
              Task ID、SUPERVISOR_DONE、NEED_INPUT 与完成门由 Watchdog 强制拼接，
              自适应内容不能覆盖。
            </span>
          </div>
        </div>

        <div className="current-prompt-block">
          <div className="prompt-block-head">
            <span>当前步骤提示词 <small>CURRENT ADAPTIVE STEP</small></span>
            <code>v{prompt.version}</code>
          </div>
          <p>
            {prompt.stepPrompt
              ?? '当前没有自适应内容；Watchdog 只使用基础继续 envelope。'}
          </p>
          <div className="prompt-meta-row">
            <span>step {prompt.stepIndex}</span>
            <span>{prompt.updatedBy ?? 'system/default'}</span>
            <span>{prompt.updatedAt ? dateTime(prompt.updatedAt) : '未单独更新'}</span>
          </div>
        </div>

        <div className="next-prompt-editor">
          <div className="prompt-editor-head">
            <div>
              <strong>写下一步</strong>
              <small>WRITE NEXT STEP</small>
            </div>
            <label>
              step
              <input
                type="number"
                min={0}
                value={stepIndex}
                onChange={event => {
                  const value = Number(event.target.value)
                  if (Number.isInteger(value) && value >= 0) setStepIndex(value)
                }}
              />
            </label>
          </div>

          <textarea
            value={stepPrompt}
            onChange={event => setStepPrompt(event.target.value)}
            maxLength={12000}
            placeholder="例：只执行 EXP-004 的最小判别实验；完成后汇报结果并根据残差决定下一步，不扩展其它方向。"
            disabled={!writable || saving}
          />

          <div className="prompt-editor-actions">
            <button
              type="button"
              className="prompt-save-button"
              disabled={!writable || saving || !stepPrompt.trim()}
              onClick={() => void savePrompt(stepPrompt.trim())}
            >
              <Save size={13} />
              {saving ? '保存中' : '保存下一步'}
            </button>
            <button
              type="button"
              className="prompt-secondary-button"
              disabled={!writable || saving}
              onClick={() => void savePrompt(null)}
            >
              <RotateCcw size={13} />
              清空自适应
            </button>
            <button
              type="button"
              className="prompt-secondary-button"
              disabled={previewing || !writable}
              onClick={() => void loadPreview()}
            >
              <FileText size={13} />
              {previewing ? '读取中' : '实际发送预览'}
            </button>
          </div>

          {!writable && (
            <p className="prompt-feedback degraded">
              当前 Watchdog 未提供 protocol-v4 prompt 能力或控制接口不可用，提示词保持只读。
            </p>
          )}
          {feedback && <p className="prompt-feedback">{feedback}</p>}
        </div>

        {preview && (
          <div className="prompt-preview">
            <div className="prompt-block-head">
              <span>Watchdog 实际发送内容 <small>RENDERED PROMPT</small></span>
            </div>
            <pre>{preview}</pre>
          </div>
        )}
      </div>
    </details>
  )
}

function taskStatus(task: SupervisedTask, integrationAvailable: boolean) {
  if (!integrationAvailable) {
    return { zh: '状态未知', en: 'UNVERIFIED', tone: 'unknown' }
  }

  const state = task.watchdogState
  if (state === 'need_input') {
    return { zh: '等待输入', en: 'NEED INPUT', tone: 'waiting' }
  }
  if (state === 'submission_unknown') {
    return { zh: '发送待确认', en: 'DELIVERY UNCERTAIN', tone: 'waiting' }
  }
  if (state === 'sent_no_visible_progress') {
    return { zh: '等待进展', en: 'WAITING PROGRESS', tone: 'waiting' }
  }
  if (state === 'send_rejected' || state === 'target_changed' || state === 'degraded') {
    return { zh: '监督异常', en: 'DEGRADED', tone: 'degraded' }
  }
  if (state === 'done') {
    return { zh: '任务完成', en: 'DONE', tone: 'healthy' }
  }
  if (task.operational) {
    return { zh: '监督正常', en: 'OPERATIONAL', tone: 'healthy' }
  }
  return { zh: '监督异常', en: 'DEGRADED', tone: 'degraded' }
}

function Now({ data }: { data: NowResponse }) {
  const [entityQuery, setEntityQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>(
    data.entities[0]?.id,
  )

  const entityTypes = useMemo(
    () => [...new Set(data.entities.map(entity => entity.type))].sort(),
    [data.entities],
  )

  const filteredEntities = useMemo(() => {
    const query = entityQuery.trim().toLocaleLowerCase()
    return data.entities.filter(entity => {
      if (typeFilter !== 'all' && entity.type !== typeFilter) return false
      if (!query) return true
      return [
        entity.label,
        entity.stableKey,
        entity.type,
        ...Object.keys(entity.currentFacts),
      ].some(item => item.toLocaleLowerCase().includes(query))
    })
  }, [data.entities, entityQuery, typeFilter])

  if (!data.entities.length) return <Empty zh="暂无观测" en="No observations yet." />

  const selected = filteredEntities.find(entity => entity.id === selectedEntityId)
    ?? filteredEntities[0]
  const groups = selected ? groupFacts(selected) : []
  const sources = selected ? summarizeSources(selected.factDetails) : []

  return (
    <section className="facts-section">
      <SectionHeading
        kickerZh="可追溯的当前事实"
        kickerEn="TRACEABLE CURRENT STATE"
        titleZh="事实浏览器"
        titleEn="Fact Explorer"
        meta={`${data.entities.length} 个实体 · ${data.counts.facts ?? 0} 条事实`}
      />

      <div className="facts-toolbar">
        <label className="facts-search">
          <SearchIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          <input
            value={entityQuery}
            onChange={event => setEntityQuery(event.target.value)}
            placeholder="搜索实体、稳定键或字段 / Search entities, keys or facts"
          />
        </label>
        <div className="facts-type-filters" aria-label="Entity type filters">
          <button
            type="button"
            className={typeFilter === 'all' ? 'active' : ''}
            onClick={() => setTypeFilter('all')}
          >
            <Layers3 size={13} />
            全部 <small>ALL</small>
          </button>
          {entityTypes.map(type => {
            const label = typeLabel(type)
            return (
              <button
                type="button"
                className={typeFilter === type ? 'active' : ''}
                onClick={() => setTypeFilter(type)}
                key={type}
              >
                <EntityIcon type={type} size={13} />
                {label.zh} <small>{label.en}</small>
              </button>
            )
          })}
        </div>
      </div>

      <div className="facts-workbench">
        <aside className="facts-entity-browser">
          <div className="facts-pane-heading">
            <div>
              <span>实体</span>
              <small>ENTITIES</small>
            </div>
            <b>{filteredEntities.length}</b>
          </div>

          <div className="facts-entity-list">
            {filteredEntities.map(entity => {
              const label = typeLabel(entity.type)
              const active = selected?.id === entity.id
              return (
                <button
                  type="button"
                  className={active ? 'facts-entity-item active' : 'facts-entity-item'}
                  onClick={() => setSelectedEntityId(entity.id)}
                  key={entity.id}
                >
                  <span className="entity-icon-shell">
                    <EntityIcon type={entity.type} size={16} />
                  </span>
                  <span className="facts-entity-copy">
                    <strong>{entity.label}</strong>
                    <span>{label.zh}<small>{label.en}</small></span>
                  </span>
                  <span className="facts-entity-count">{entity.factDetails.length}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="facts-detail-pane">
          {selected ? (
            <>
              <FactEntityHeader entity={selected} />
              <div className="fact-summary">
                <Sparkles size={16} strokeWidth={1.7} aria-hidden="true" />
                <p>{entitySummary(selected)}</p>
              </div>

              <div className="fact-groups">
                {groups.length ? groups.map(group => (
                  <FactGroupSection
                    key={group.id}
                    group={group}
                  />
                )) : (
                  <div className="facts-no-current">
                    <Info size={18} />
                    <span>当前没有开放事实 / No current facts.</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="facts-no-selection">
              <Database size={28} strokeWidth={1.45} />
              <strong>没有匹配的实体</strong>
              <span>No entity matches the current filters.</span>
            </div>
          )}
        </main>

        <aside className="facts-evidence-pane">
          <div className="facts-pane-heading">
            <div>
              <span>证据与身份</span>
              <small>EVIDENCE & IDENTITY</small>
            </div>
          </div>

          {selected && (
            <>
              <section className="facts-context-block">
                <span className="facts-context-label">稳定身份 <small>STABLE KEY</small></span>
                <code>{selected.stableKey}</code>
              </section>

              <section className="facts-context-grid">
                <div>
                  <span>当前事实</span>
                  <strong>{selected.factDetails.length}</strong>
                </div>
                <div>
                  <span>证据源</span>
                  <strong>{sources.length}</strong>
                </div>
                <div>
                  <span>最后观测</span>
                  <strong>{selected.lastObservedAt ? compactTime(selected.lastObservedAt) : '—'}</strong>
                </div>
              </section>

              <section className="facts-context-block">
                <span className="facts-context-label">证据来源 <small>SOURCES</small></span>
                <div className="facts-source-list">
                  {sources.length ? sources.map(source => (
                    <div key={source.key}>
                      <span className="source-icon"><EyeIconForSource type={source.type} /></span>
                      <div>
                        <strong>{source.key}</strong>
                        <span>{source.type}</span>
                        {source.authorityScope && <p>{source.authorityScope}</p>}
                      </div>
                      <b>{source.count}</b>
                    </div>
                  )) : (
                    <p className="quiet-copy">暂无来源元数据 / No source metadata.</p>
                  )}
                </div>
              </section>

              <section className="facts-context-block">
                <span className="facts-context-label">实体类型 <small>ENTITY TYPE</small></span>
                <EntityTypeBadge type={selected.type} />
              </section>

              {Object.keys(selected.metadata).length > 0 && (
                <details className="facts-raw-details">
                  <summary>原始元数据 / Raw metadata</summary>
                  <pre>{JSON.stringify(selected.metadata, null, 2)}</pre>
                </details>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  )
}

function FactEntityHeader({ entity }: { entity: CurrentEntity }) {
  const label = typeLabel(entity.type)
  return (
    <header className="fact-entity-header">
      <div className="fact-entity-icon">
        <EntityIcon type={entity.type} size={25} />
      </div>
      <div>
        <div className="fact-entity-type">
          <span>{label.zh}</span>
          <small>{label.en}</small>
        </div>
        <h2>{entity.label}</h2>
        <p>
          {entity.lastObservedAt
            ? `最后观测于 ${dateTime(entity.lastObservedAt)}`
            : '尚无观测时间 / No observation time'}
        </p>
      </div>
    </header>
  )
}

type FactGroupView = {
  id: FactGroupId
  zh: string
  en: string
  icon: LucideIcon
  facts: CurrentFactDetail[]
}

type FactGroupId =
  | 'core'
  | 'supervision'
  | 'health'
  | 'runtime'
  | 'product'
  | 'infrastructure'
  | 'other'

const FACT_GROUPS: Record<FactGroupId, { zh: string; en: string; icon: LucideIcon }> = {
  core: { zh: '核心状态', en: 'CORE STATE', icon: Activity },
  supervision: { zh: '监督状态', en: 'SUPERVISION', icon: ShieldCheck },
  health: { zh: '服务健康', en: 'SERVICE HEALTH', icon: CheckCircle2 },
  runtime: { zh: '运行绑定', en: 'RUNTIME BINDINGS', icon: Network },
  product: { zh: '产品能力', en: 'PRODUCT CAPABILITIES', icon: Sparkles },
  infrastructure: { zh: '基础设施', en: 'INFRASTRUCTURE', icon: Server },
  other: { zh: '其他事实', en: 'OTHER FACTS', icon: Layers3 },
}

function groupFacts(entity: CurrentEntity): FactGroupView[] {
  const source = entity.factDetails.length
    ? entity.factDetails
    : Object.entries(entity.currentFacts).map(([attribute, factValue]) => ({
        id: `${entity.id}:${attribute}`,
        attribute,
        value: factValue,
        validFrom: entity.lastObservedAt ?? '',
        recordedAt: entity.lastObservedAt ?? '',
        observationId: '',
      }))
  const groups = new Map<FactGroupId, CurrentFactDetail[]>()
  for (const fact of source) {
    const group = factMeta(fact.attribute).group
    groups.set(group, [...(groups.get(group) ?? []), fact])
  }
  const order: FactGroupId[] = [
    'core',
    'supervision',
    'health',
    'runtime',
    'product',
    'infrastructure',
    'other',
  ]
  return order
    .filter(id => groups.has(id))
    .map(id => ({
      id,
      ...FACT_GROUPS[id],
      facts: groups.get(id)!.sort((a, b) =>
        factMeta(a.attribute).zh.localeCompare(factMeta(b.attribute).zh, 'zh-CN')),
    }))
}

function FactGroupSection({ group }: { group: FactGroupView }) {
  const Icon = group.icon
  const collapsible = group.facts.length > 5
  const [expanded, setExpanded] = useState(false)
  const listClassName = collapsible
    ? `fact-row-list ${expanded ? 'is-expanded' : 'is-collapsed'}`
    : 'fact-row-list'

  return (
    <section className="fact-group">
      <div className="fact-group-heading">
        <span className="fact-group-icon"><Icon size={15} strokeWidth={1.75} /></span>
        <div>
          <strong>{group.zh}</strong>
          <small>{group.en}</small>
        </div>
        <div className="fact-group-tools">
          <b className="fact-group-count">{group.facts.length}</b>
          {collapsible && (
            <button
              className="fact-group-toggle"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? '收起' : '展开全部'}
            </button>
          )}
        </div>
      </div>
      <div
        className={listClassName}
        tabIndex={collapsible && !expanded ? 0 : undefined}
        aria-label={collapsible && !expanded ? `${group.zh}，共 ${group.facts.length} 条，可滚动查看` : undefined}
      >
        {group.facts.map(fact => <FactRow fact={fact} key={fact.id} />)}
      </div>
    </section>
  )
}

function FactRow({ fact }: { fact: CurrentFactDetail }) {
  const meta = factMeta(fact.attribute)
  return (
    <article className="fact-row">
      <div className="fact-row-label">
        <strong>{meta.zh}</strong>
        <span>{meta.en}</span>
        <code>{fact.attribute}</code>
      </div>
      <div className="fact-row-value">
        <FactValue value={fact.value} />
        <div className="fact-provenance">
          <span>
            <Clock3 size={11} />
            {fact.observedAt ? dateTime(fact.observedAt) : dateTime(fact.validFrom)}
          </span>
          {fact.source && (
            <span>
              <Database size={11} />
              {fact.source.key}
            </span>
          )}
          {fact.observationStatus && (
            <span className={`observation-status ${fact.observationStatus}`}>
              {fact.observationStatus}
            </span>
          )}
        </div>
        <details className="fact-evidence-details">
          <summary>证据详情 / Evidence</summary>
          <dl>
            <div>
              <dt>Observation ID</dt>
              <dd>{fact.observationId || '—'}</dd>
            </div>
            <div>
              <dt>Observed at</dt>
              <dd>{fact.observedAt ? dateTime(fact.observedAt) : '—'}</dd>
            </div>
            <div>
              <dt>Recorded at</dt>
              <dd>{dateTime(fact.recordedAt)}</dd>
            </div>
            <div>
              <dt>Valid from</dt>
              <dd>{dateTime(fact.validFrom)}</dd>
            </div>
            {fact.source?.authorityScope && (
              <div>
                <dt>Authority scope</dt>
                <dd>{fact.source.authorityScope}</dd>
              </div>
            )}
          </dl>
        </details>
      </div>
    </article>
  )
}

function FactValue({ value: factValue }: { value: unknown }) {
  if (factValue === null || factValue === undefined) {
    return (
      <span className="fact-value-pill unknown">
        <CircleHelp size={12} />
        未知 / Unknown
      </span>
    )
  }
  if (typeof factValue === 'boolean') {
    return factValue ? (
      <span className="fact-value-pill positive">
        <CheckCircle2 size={12} />
        是 / Yes
      </span>
    ) : (
      <span className="fact-value-pill negative">
        <AlertTriangle size={12} />
        否 / No
      </span>
    )
  }
  if (typeof factValue === 'string' && /^https?:\/\//i.test(factValue)) {
    return (
      <a className="fact-link-value" href={factValue} target="_blank" rel="noreferrer">
        <span>{factValue}</span>
        <ExternalLink size={12} />
      </a>
    )
  }
  if (
    typeof factValue === 'string'
    && ['active', 'running', 'ready', 'passed', 'verified', 'installed', 'built', 'ok'].includes(
      factValue.toLocaleLowerCase(),
    )
  ) {
    return <span className="fact-value-pill positive">{factValue}</span>
  }
  if (
    typeof factValue === 'string'
    && ['degraded', 'failed', 'error', 'blocked', 'unavailable'].includes(
      factValue.toLocaleLowerCase(),
    )
  ) {
    return <span className="fact-value-pill negative">{factValue}</span>
  }
  if (typeof factValue === 'object') {
    return <pre className="fact-object-value">{JSON.stringify(factValue, null, 2)}</pre>
  }
  return <strong className="fact-text-value">{String(factValue)}</strong>
}

function entitySummary(entity: CurrentEntity) {
  const facts = entity.currentFacts
  if (entity.type === 'task') {
    const phase = stringValue(facts.phase)
    const status = stringValue(facts.status)
    const supervised = facts.watchdog_registered === true
    const operational = facts.watchdog_operational === true
    const conversation = stringValue(facts.current_conversation_id)

    if (supervised) {
      return [
        `这是一个由 Watchdog 监督的任务${operational ? '，监督链路当前可用' : ''}。`,
        conversation ? `当前执行绑定为 Conversation ${conversation.slice(0, 8)}。` : '',
      ].filter(Boolean).join(' ')
    }
    if (phase || status) {
      return `当前${phase ? `工作阶段为「${phase}」` : ''}${phase && status ? '，' : ''}${status ? `状态为「${status}」` : ''}。`
    }
  }
  if (entity.type === 'conversation') {
    if (facts.watchdog_bound === true) {
      return `这个对话当前承载一个受监督任务，Watchdog 状态为「${stringValue(facts.watchdog_state) ?? 'unknown'}」。`
    }
    return '这是一个已记录的 GPT 对话执行载体。'
  }
  if (entity.type === 'service') {
    const ready = facts.ready === true
    const fresh = facts.polling_fresh === true
    return `服务当前${ready ? '已就绪' : '未就绪'}，观测数据${fresh ? '保持新鲜' : '可能过期'}。`
  }
  if (entity.type === 'repo') {
    return '这是被事实系统引用的代码仓库实体；具体作用由关系图中的事实边说明。'
  }
  return `当前记录 ${entity.factDetails.length} 条开放事实；下方仅展示有来源的当前状态，不推断未观测信息。`
}

function summarizeSources(facts: CurrentFactDetail[]) {
  const map = new Map<string, {
    key: string
    type: string
    authorityScope?: string
    count: number
  }>()
  for (const fact of facts) {
    if (!fact.source) continue
    const current = map.get(fact.source.key)
    map.set(fact.source.key, {
      key: fact.source.key,
      type: fact.source.type,
      authorityScope: fact.source.authorityScope ?? current?.authorityScope,
      count: (current?.count ?? 0) + 1,
    })
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function EyeIconForSource({ type }: { type: string }) {
  if (type.includes('watchdog')) return <ShieldCheck size={13} strokeWidth={1.75} />
  if (type.includes('agent')) return <Bot size={13} strokeWidth={1.75} />
  if (type.includes('migration')) return <GitBranch size={13} strokeWidth={1.75} />
  return <Database size={13} strokeWidth={1.75} />
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <Empty zh="暂无事实版本" en="No fact versions yet." />

  return (
    <section className="timeline">
      <SectionHeading
        kickerZh="事实状态历史"
        kickerEn="FACTUAL STATE HISTORY"
        titleZh="观测到的变化"
        titleEn="Observed Transitions"
        meta={`${events.length} 条事实版本 / ${events.length} fact versions`}
      />

      <div className="timeline-list">
        {events.map(event => (
          <article key={event.id}>
            <time>{dateTime(event.at)}</time>
            <div className="timeline-rail" aria-hidden="true"><span /></div>
            <div className="timeline-content">
              <div className="timeline-title">
                <strong>{event.entityLabel}</strong>
                <span>{fieldLabel(event.attribute)}</span>
              </div>
              <p>
                <code>{event.initial ? '∅' : value(event.from)}</code>
                <span className="arrow">→</span>
                <code>{value(event.to)}</code>
                {event.initial && (
                  <span
                    className="first-observation-mark"
                    title="首次观测 / First observed"
                    aria-label="首次观测 / First observed"
                    data-label="首次观测 · First observed"
                  >
                    ✦
                  </span>
                )}
              </p>
              <div className="transition-note">
                {transitionSummary(event)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function GraphWorkbench({ data }: { data: GraphResponse }) {
  const graphRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null)
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([])
  const [graphQuery, setGraphQuery] = useState('')

  const entityTypes = useMemo(
    () => [...new Set(data.nodes.map(node => node.type))].sort(),
    [data.nodes],
  )

  const visibleNodes = useMemo(
    () => data.nodes.filter(node => !hiddenTypes.includes(node.type)),
    [data.nodes, hiddenTypes],
  )

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(node => node.id)),
    [visibleNodes],
  )

  const visibleEdges = useMemo(
    () => data.edges.filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [data.edges, visibleNodeIds],
  )

  const visibleEdgeIds = useMemo(
    () => new Set(visibleEdges.map(edge => edge.id)),
    [visibleEdges],
  )

  const degreeByNode = useMemo(() => {
    const degree = new Map<string, number>()
    for (const node of visibleNodes) degree.set(node.id, 0)
    for (const edge of visibleEdges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
    return degree
  }, [visibleEdges, visibleNodes])

  const persistentLabelIds = useMemo(() => {
    const isolatedIds = visibleNodes
      .filter(node => (degreeByNode.get(node.id) ?? 0) === 0)
      .map(node => node.id)

    const rankedConnectedIds = visibleNodes
      .filter(node => (degreeByNode.get(node.id) ?? 0) > 0)
      .sort((a, b) => (degreeByNode.get(b.id) ?? 0) - (degreeByNode.get(a.id) ?? 0))
      .slice(0, Math.min(18, Math.max(6, Math.ceil(visibleNodes.length * 0.12))))
      .map(node => node.id)

    return new Set([...isolatedIds, ...rankedConnectedIds])
  }, [degreeByNode, visibleNodes])

  const selectedNode = data.nodes.find(node => node.id === selectedNodeId) ?? null

  const selectedRelations = useMemo(() => {
    if (!selectedNode) return []
    return data.edges
      .filter(edge => edge.source === selectedNode.id || edge.target === selectedNode.id)
      .map(edge => ({
        ...edge,
        direction: edge.source === selectedNode.id ? 'out' as const : 'in' as const,
        peer: data.nodes.find(node => node.id === (edge.source === selectedNode.id ? edge.target : edge.source)),
      }))
  }, [data.edges, data.nodes, selectedNode])

  const selectedRelation = selectedRelations.find(relation => relation.id === selectedRelationId) ?? null
  const selectedNeighborCount = new Set(
    selectedRelations.flatMap(relation => relation.peer ? [relation.peer.id] : []),
  ).size

  useEffect(() => {
    if (!graphRef.current || !visibleNodes.length) {
      cyRef.current?.destroy()
      cyRef.current = null
      return
    }

    const cy = cytoscape({
      container: graphRef.current,
      elements: [
        ...visibleNodes.map(node => {
          const degree = degreeByNode.get(node.id) ?? 0
          const size = Math.max(18, Math.min(32, 18 + Math.sqrt(degree) * 4))
          const taskNode = node.type === 'task'
          return {
            data: {
              id: node.id,
              label: persistentLabelIds.has(node.id) ? node.label : '',
              fullLabel: node.label,
              type: node.type,
              color: entityColor(node.type),
              borderColor: entityBorderColor(node.type),
              nodeWidth: taskNode ? size * 1.18 : size,
              nodeHeight: taskNode ? Math.max(16, size * 0.7) : size,
            },
          }
        }),
        ...visibleEdges.map(edge => ({
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: '',
            fullLabel: edge.predicate,
          },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            shape: 'ellipse',
            width: 'data(nodeWidth)',
            height: 'data(nodeHeight)',
            'background-color': 'data(color)',
            'background-opacity': 0.9,
            'border-color': 'data(borderColor)',
            'border-width': 1,
            color: '#253039',
            'font-family': 'Inter, "Noto Sans SC", "Microsoft YaHei UI", sans-serif',
            'font-size': '10px',
            'font-weight': 560,
            'text-background-color': '#f7f8f7',
            'text-background-opacity': 0.74,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'text-wrap': 'ellipsis',
            'text-max-width': '118px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 10,
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node[type = "task"]',
          style: {
            shape: 'round-rectangle',
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'line-color': '#7d8992',
            'target-arrow-color': '#697781',
            width: 0.95,
            'font-family': 'Inter, "Noto Sans SC", "Microsoft YaHei UI", sans-serif',
            'font-size': '8.5px',
            'font-weight': 560,
            color: '#48555e',
            'text-background-color': '#f7f8f7',
            'text-background-opacity': 0.82,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'arrow-scale': 0.56,
            opacity: 0.82,
          },
        },
        {
          selector: '.is-faded',
          style: { opacity: 0.08, 'text-opacity': 0 },
        },
        {
          selector: 'node.is-context',
          style: {
            opacity: 0.4,
            'text-opacity': 0,
            'border-width': 1.6,
          },
        },
        {
          selector: 'edge.is-context-relation',
          style: {
            width: 0.7,
            opacity: 0.3,
            'line-color': '#a5adb3',
            'target-arrow-color': '#99a3aa',
            'arrow-scale': 0.44,
          },
        },
        {
          selector: 'node.is-neighbor',
          style: {
            label: 'data(fullLabel)',
            opacity: 1,
            'border-color': 'data(borderColor)',
            'border-width': 1.35,
            'text-opacity': 1,
          },
        },
        {
          selector: 'edge.is-active-relation',
          style: {
            label: 'data(fullLabel)',
            width: 1.25,
            opacity: 0.98,
            'line-color': '#53616b',
            'target-arrow-color': '#475660',
            'arrow-scale': 0.62,
            'font-size': '8.75px',
            'font-weight': 600,
            color: '#33424c',
            'text-background-opacity': 0.9,
            'text-background-padding': '3.5px',
          },
        },
        {
          selector: 'node.is-focus',
          style: {
            label: 'data(fullLabel)',
            opacity: 1,
            'border-color': '#465762',
            'border-width': 1.55,
            'underlay-color': '#718796',
            'underlay-opacity': 0.075,
            'underlay-padding': 8,
            'text-opacity': 1,
            'z-index': 10,
          },
        },
        {
          selector: 'edge.is-inspected-relation',
          style: {
            label: 'data(fullLabel)',
            width: 1.55,
            opacity: 1,
            'line-color': '#42515b',
            'target-arrow-color': '#35454f',
            'arrow-scale': 0.67,
            'text-background-opacity': 1,
            'text-background-padding': '4px',
            'z-index': 20,
          },
        },
        {
          selector: 'node.is-inspected-peer',
          style: {
            opacity: 1,
            'border-color': '#596a76',
            'border-width': 1.55,
            'underlay-color': '#8fa8bb',
            'underlay-opacity': 0.07,
            'underlay-padding': 5,
            'text-opacity': 1,
          },
        },
        {
          selector: 'node.is-search-match',
          style: {
            label: 'data(fullLabel)',
            'border-color': '#957b52',
            'border-width': 1.8,
            'text-opacity': 1,
          },
        },
        {
          selector: 'node.is-hover',
          style: {
            label: 'data(fullLabel)',
            'text-opacity': 1,
            'border-width': 1.45,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        padding: 86,
        nodeDimensionsIncludeLabels: true,
        nodeRepulsion: () => 15000,
        idealEdgeLength: () => 126,
        nodeOverlap: 24,
        componentSpacing: 72,
        gravity: 0.28,
        numIter: 1400,
      },
      minZoom: 0.25,
      maxZoom: 2.5,
    })

    cy.on('tap', 'node', event => {
      const node = event.target
      const id = node.id()
      setSelectedRelationId(null)
      setSelectedNodeId(id)
      focusNeighborhood(cy, id)
    })

    cy.on('mouseover', 'node', event => {
      event.target.addClass('is-hover')
    })

    cy.on('mouseout', 'node', event => {
      event.target.removeClass('is-hover')
    })

    cy.on('tap', event => {
      if (event.target === cy) {
        setSelectedRelationId(null)
        setSelectedNodeId(null)
        clearGraphFocus(cy)
      }
    })

    cyRef.current = cy

    return () => {
      cy.destroy()
      if (cyRef.current === cy) cyRef.current = null
    }
  }, [degreeByNode, persistentLabelIds, visibleEdges, visibleNodes])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    if (selectedNodeId && visibleNodeIds.has(selectedNodeId)) {
      focusNeighborhood(cy, selectedNodeId)
      if (selectedRelationId && visibleEdgeIds.has(selectedRelationId)) {
        focusRelation(cy, selectedRelationId)
      }
    } else {
      clearGraphFocus(cy)
    }
  }, [selectedNodeId, selectedRelationId, visibleEdgeIds, visibleNodeIds])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().removeClass('is-search-match')

    const normalized = graphQuery.trim().toLocaleLowerCase()
    if (!normalized) return

    const matches = cy.nodes().filter(node => {
      const label = String(node.data('label') ?? '').toLocaleLowerCase()
      const type = String(node.data('type') ?? '').toLocaleLowerCase()
      return label.includes(normalized) || type.includes(normalized)
    })

    matches.addClass('is-search-match')
  }, [graphQuery])

  function toggleType(type: string) {
    setHiddenTypes(current =>
      current.includes(type)
        ? current.filter(item => item !== type)
        : [...current, type],
    )
  }

  function zoom(multiplier: number) {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * multiplier)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }

  function fitGraph() {
    cyRef.current?.fit(undefined, 72)
  }

  function locateFirstMatch() {
    const cy = cyRef.current
    if (!cy || !graphQuery.trim()) return
    const normalized = graphQuery.trim().toLocaleLowerCase()
    const match = cy.nodes().filter(node =>
      String(node.data('label') ?? '').toLocaleLowerCase().includes(normalized),
    ).first()

    if (!match || match.empty()) return
    setSelectedRelationId(null)
    setSelectedNodeId(match.id())
    cy.animate({ center: { eles: match }, zoom: 1.25 }, { duration: 260 })
    focusNeighborhood(cy, match.id())
  }

  if (!data.nodes.length) return <Empty zh="暂无事实图谱" en="No factual graph yet." />

  return (
    <section className="graph-section">
      <SectionHeading
        kickerZh="事实关系拓扑"
        kickerEn="FACTUAL TOPOLOGY"
        titleZh="知识图谱"
        titleEn="Knowledge Graph"
        meta={`${visibleNodes.length}/${data.nodes.length} 节点 · ${visibleEdges.length} 关系 / nodes · edges`}
      />

      <div className="graph-workbench">
        <aside className="graph-sidebar">
          <GraphPanelHeading zh="探索" en="EXPLORE" />

          <label className="graph-search">
            <span>查找节点 / Find node</span>
            <div>
              <input
                value={graphQuery}
                onChange={event => setGraphQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') locateFirstMatch()
                }}
                placeholder="名称或类型 / label or type"
              />
              <button type="button" onClick={locateFirstMatch} aria-label="查找节点 / Find node">
                <SearchIcon size={14} />
              </button>
            </div>
          </label>

          <div className="graph-filter-block">
            <div className="graph-filter-title">
              <span>实体类型</span>
              <small>ENTITY TYPES</small>
            </div>
            <div className="graph-filter-list">
              {entityTypes.map(type => {
                const enabled = !hiddenTypes.includes(type)
                const label = typeLabel(type)
                return (
                  <button
                    type="button"
                    className={enabled ? 'graph-filter active' : 'graph-filter'}
                    onClick={() => toggleType(type)}
                    key={type}
                  >
                    <i style={{ background: entityColor(type) }} />
                    <span>{label.zh}<small>{label.en}</small></span>
                    <b>{data.nodes.filter(node => node.type === type).length}</b>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="graph-legend">
            <div className="graph-filter-title">
              <span>色彩语义</span>
              <small>COLOR SEMANTICS</small>
            </div>
            <Legend color="#9eb4c4" zh="对话与项目" en="Conversation & Projects" />
            <Legend color="#aab9aa" zh="代码与服务" en="Code & Services" />
            <Legend color="#d0bb93" zh="任务与执行" en="Tasks & Execution" />
          </div>
        </aside>

        <div className="graph-stage">
          <div className="graph-toolbar">
            <div className="graph-toolbar-copy">
              <span>关系画布</span>
              <small>RELATION CANVAS</small>
            </div>
            <div className="graph-controls">
              <button type="button" onClick={() => zoom(1.18)} title="放大 / Zoom in" aria-label="放大 / Zoom in">
                <ZoomIn size={14} />
              </button>
              <button type="button" onClick={() => zoom(0.84)} title="缩小 / Zoom out" aria-label="缩小 / Zoom out">
                <ZoomOut size={14} />
              </button>
              <button type="button" className="fit-button" onClick={fitGraph}>
                <Maximize2 size={12} />
                适配 <small>FIT</small>
              </button>
            </div>
          </div>

          <div className="graph" ref={graphRef} />

          <div className={selectedNode ? 'graph-stage-note has-focus' : 'graph-stage-note'}>
            <span>
              {selectedRelation
                ? selectedRelation.predicate + ' · ' + (selectedRelation.peer?.label ?? 'Unknown entity')
                : selectedNode
                  ? '聚焦 ' + selectedNode.label + ' · ' + selectedRelations.length + ' 条直接关系'
                  : '点击节点查看邻接关系，空白处取消聚焦。'}
            </span>
            <small>
              {selectedRelation
                ? 'RELATION TRACE · 在检查器中选择其他关系即可切换'
                : selectedNode
                  ? typeLabel(selectedNode.type).en + ' · ' + selectedNeighborCount + ' neighbors · Select a relation in the inspector to trace it.'
                  : 'Click a node to isolate its neighborhood. Click canvas to reset.'}
            </small>
          </div>
        </div>

        <aside className="graph-inspector">
          <GraphPanelHeading zh="实体检查器" en="ENTITY INSPECTOR" />

          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              relations={selectedRelations}
              selectedRelationId={selectedRelationId}
              onRelationSelect={setSelectedRelationId}
            />
          ) : (
            <div className="inspector-empty">
              <CircleHelp size={28} strokeWidth={1.45} />
              <strong>选择一个节点</strong>
              <span>Select a node to inspect factual state and relations.</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function GraphPanelHeading({ zh, en }: { zh: string; en: string }) {
  return (
    <div className="graph-panel-heading">
      <div><span>{zh}</span><small>{en}</small></div>
    </div>
  )
}

function NodeInspector({
  node,
  relations,
  selectedRelationId,
  onRelationSelect,
}: {
  node: GraphNode
  relations: Array<GraphResponse['edges'][number] & { direction: 'in' | 'out'; peer?: GraphNode }>
  selectedRelationId: string | null
  onRelationSelect: (relationId: string | null) => void
}) {
  return (
    <div className="inspector-content">
      <div className="inspector-identity">
        <EntityTypeBadge type={node.type} />
        <h3>{node.label}</h3>
        <code>{node.stableKey}</code>
      </div>

      <InspectorSection zh="当前事实" en="CURRENT FACTS">
        {Object.entries(node.facts).length ? (
          <dl className="inspector-facts">
            {Object.entries(node.facts).map(([key, fact]) => (
              <div key={key}>
                <dt>{fieldLabel(key)}</dt>
                <dd>{value(fact)}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="quiet-copy">暂无当前事实 / No current facts.</p>}
      </InspectorSection>

      <InspectorSection zh="关系" en="RELATIONS">
        {relations.length ? (
          <div className="relation-list">
            {relations.map(relation => (
              <button
                type="button"
                className={relation.id === selectedRelationId ? 'relation-item active' : 'relation-item'}
                aria-pressed={relation.id === selectedRelationId}
                onClick={() => onRelationSelect(
                  relation.id === selectedRelationId ? null : relation.id,
                )}
                key={relation.id}
              >
                <span className={relation.direction === 'out' ? 'relation-direction out' : 'relation-direction in'}>
                  {relation.direction === 'out'
                    ? <ArrowRight size={12} />
                    : <ArrowLeft size={12} />}
                </span>
                <div>
                  <strong>{relation.predicate}</strong>
                  <span>{relation.peer?.label ?? 'Unknown entity'}</span>
                </div>
              </button>
            ))}
          </div>
        ) : <p className="quiet-copy">暂无当前关系 / No current relations.</p>}
      </InspectorSection>

      <InspectorSection zh="最后观测" en="LAST OBSERVED">
        <p className="inspector-time">{node.lastObservedAt ? dateTime(node.lastObservedAt) : '未知 / Unknown'}</p>
      </InspectorSection>
    </div>
  )
}

function InspectorSection({ zh, en, children }: { zh: string; en: string; children: ReactNode }) {
  return (
    <section className="inspector-section">
      <div className="inspector-section-title"><span>{zh}</span><small>{en}</small></div>
      {children}
    </section>
  )
}

function Legend({ color, zh, en }: { color: string; zh: string; en: string }) {
  return (
    <div className="legend-row">
      <i style={{ background: color }} />
      <span>{zh}<small>{en}</small></span>
    </div>
  )
}

function Search({
  query,
  setQuery,
  results,
  submit,
}: {
  query: string
  setQuery: (value: string) => void
  results: SearchResult[]
  submit: (event: FormEvent) => void
}) {
  return (
    <section className="search">
      <SectionHeading
        kickerZh="本地 384 维语义检索"
        kickerEn="384-D LOCAL SEMANTIC RETRIEVAL"
        titleZh="按含义搜索事实状态"
        titleEn="Search Factual State by Meaning"
        meta="派生向量索引 · Canonical facts remain authoritative"
      />

      <form onSubmit={submit}>
        <div className="search-input-wrap">
          <SearchIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索对话、任务、仓库、实验… / Search conversations, tasks, repositories, experiments…"
          />
        </div>
        <button type="submit"><span>搜索</span><small>SEARCH</small></button>
      </form>

      <div className="search-results">
        {results.map(result => (
          <article key={result.id}>
            <div className="search-result-head">
              <strong>{result.targetKey}</strong>
              <small>距离 / distance {result.distance.toFixed(4)}</small>
            </div>
            <pre>{result.text}</pre>
          </article>
        ))}
      </div>
    </section>
  )
}

function SectionHeading({
  kickerZh,
  kickerEn,
  titleZh,
  titleEn,
  meta,
}: {
  kickerZh: string
  kickerEn: string
  titleZh: string
  titleEn: string
  meta: string
}) {
  return (
    <div className="view-heading">
      <div>
        <div className="view-kicker"><span>{kickerZh}</span><small>{kickerEn}</small></div>
        <h2>{titleZh}<small>{titleEn}</small></h2>
      </div>
      <p>{meta}</p>
    </div>
  )
}

function EntityTypeBadge({ type }: { type: string }) {
  const label = typeLabel(type)
  return (
    <span className="entity-type-badge">
      <i style={{ background: entityColor(type) }} />
      {label.zh}
      <small>{label.en}</small>
    </span>
  )
}

function Empty({ zh, en }: { zh: string; en: string }) {
  return (
    <div className="empty">
      <Database className="empty-mark" size={30} strokeWidth={1.4} aria-hidden="true" />
      <strong>{zh}</strong>
      <span>{en}</span>
    </div>
  )
}

function focusNeighborhood(cy: Core, nodeId: string) {
  clearGraphFocus(cy)
  const node = cy.getElementById(nodeId)
  if (!node || node.empty()) return

  const connectedEdges = node.connectedEdges()
  const neighborNodes = connectedEdges.connectedNodes().difference(node)
  const contextNodes = neighborNodes
    .neighborhood()
    .nodes()
    .difference(node)
    .difference(neighborNodes)
  const contextEdges = neighborNodes.edgesWith(contextNodes)

  cy.elements().addClass('is-faded')
  contextNodes.removeClass('is-faded').addClass('is-context')
  contextEdges.removeClass('is-faded').addClass('is-context-relation')
  neighborNodes.removeClass('is-faded').addClass('is-neighbor')
  connectedEdges.removeClass('is-faded').addClass('is-active-relation')
  node.removeClass('is-faded').addClass('is-focus')
}

function focusRelation(cy: Core, relationId: string) {
  const relation = cy.getElementById(relationId)
  if (!relation || relation.empty()) return

  relation.addClass('is-inspected-relation')
  relation.connectedNodes()
    .filter(node => !node.hasClass('is-focus'))
    .addClass('is-inspected-peer')
}

function clearGraphFocus(cy: Core) {
  cy.elements().removeClass(
    'is-faded is-context is-context-relation is-neighbor is-focus is-active-relation '
      + 'is-inspected-relation is-inspected-peer',
  )
}

function entityColor(type: string) {
  if (type === 'conversation') return '#9eb4c4'
  if (type === 'task') return '#d0bb93'
  if (['project', 'agent_session'].includes(type)) return '#a9bbc7'
  if (['repo', 'branch', 'worktree', 'file', 'artifact', 'service'].includes(type)) return '#aab9aa'
  if (['agent', 'host', 'process', 'experiment', 'run'].includes(type)) return '#c8b38e'
  return '#b7bec2'
}

function entityBorderColor(type: string) {
  if (type === 'conversation') return '#839aaa'
  if (type === 'task') return '#ad9365'
  if (['project', 'agent_session'].includes(type)) return '#8fa2ae'
  if (['repo', 'branch', 'worktree', 'file', 'artifact', 'service'].includes(type)) return '#90a190'
  if (['agent', 'host', 'process', 'experiment', 'run'].includes(type)) return '#aa9268'
  return '#98a3a9'
}

function typeLabel(type: string): { zh: string; en: string } {
  const labels: Record<string, { zh: string; en: string }> = {
    conversation: { zh: '对话', en: 'Conversation' },
    task: { zh: '任务', en: 'Task' },
    agent: { zh: '智能体', en: 'Agent' },
    agent_session: { zh: '智能体会话', en: 'Agent Session' },
    project: { zh: '项目', en: 'Project' },
    repo: { zh: '仓库', en: 'Repository' },
    branch: { zh: '分支', en: 'Branch' },
    worktree: { zh: '工作树', en: 'Worktree' },
    experiment: { zh: '实验', en: 'Experiment' },
    run: { zh: '运行', en: 'Run' },
    process: { zh: '进程', en: 'Process' },
    host: { zh: '主机', en: 'Host' },
    file: { zh: '文件', en: 'File' },
    artifact: { zh: '产物', en: 'Artifact' },
  }
  return labels[type] ?? { zh: type, en: type }
}

function transitionSummary(event: TimelineEvent) {
  const field = fieldLabel(event.attribute).split(' / ')[0]
  const next = value(event.to)

  if (event.initial) {
    const initialTemplates: Record<string, string> = {
      phase: `「${event.entityLabel}」当前工作阶段记录为「${next}」。`,
      status: `「${event.entityLabel}」当前状态记录为「${next}」。`,
      canonical_db: `「${event.entityLabel}」当前使用的事实库为「${next}」。`,
      ui: `「${event.entityLabel}」当前采用「${next}」界面方案。`,
      graph_ui: `「${event.entityLabel}」当前图谱呈现为「${next}」。`,
      agent_cli: `「${event.entityLabel}」的智能体 CLI 状态记录为「${next}」。`,
      agent_mcp: `「${event.entityLabel}」的智能体 MCP 状态记录为「${next}」。`,
      orca_access: `「${event.entityLabel}」的 Orca 接入状态记录为「${next}」。`,
      global_skill: `「${event.entityLabel}」的全局技能状态记录为「${next}」。`,
      bilingual_ui: `「${event.entityLabel}」当前界面语言配置为「${next}」。`,
      typography: `「${event.entityLabel}」当前字体层级方案为「${next}」。`,
    }
    return initialTemplates[event.attribute]
      ?? `「${event.entityLabel}」的${field}记录为「${next}」。`
  }

  const previous = value(event.from)
  const templates: Record<string, string> = {
    phase: `「${event.entityLabel}」的工作阶段从「${previous}」推进到「${next}」。`,
    status: `「${event.entityLabel}」的状态从「${previous}」更新为「${next}」。`,
    canonical_db: `「${event.entityLabel}」使用的事实库从「${previous}」切换为「${next}」。`,
    ui: `「${event.entityLabel}」的界面方案从「${previous}」调整为「${next}」。`,
    graph_ui: `「${event.entityLabel}」的图谱呈现从「${previous}」调整为「${next}」。`,
    agent_cli: `「${event.entityLabel}」的智能体 CLI 状态从「${previous}」更新为「${next}」。`,
    agent_mcp: `「${event.entityLabel}」的智能体 MCP 状态从「${previous}」更新为「${next}」。`,
    orca_access: `「${event.entityLabel}」的 Orca 接入状态从「${previous}」更新为「${next}」。`,
  }

  return templates[event.attribute]
    ?? `「${event.entityLabel}」的${field}从「${previous}」变化为「${next}」。`
}

type FactFieldMeta = {
  zh: string
  en: string
  group: FactGroupId
}

const FACT_FIELD_META: Record<string, FactFieldMeta> = {
  status: { zh: '状态', en: 'Status', group: 'core' },
  phase: { zh: '工作阶段', en: 'Phase', group: 'core' },
  current_conversation_id: { zh: '当前对话', en: 'Current conversation', group: 'runtime' },
  binding_changed_at: { zh: '绑定更新时间', en: 'Binding changed at', group: 'runtime' },
  target_url: { zh: '目标地址', en: 'Target URL', group: 'runtime' },
  watchdog_bound: { zh: 'Watchdog 绑定', en: 'Watchdog bound', group: 'runtime' },
  watchdog_registered: { zh: '已纳入监督', en: 'Registered', group: 'supervision' },
  watchdog_state: { zh: '监督状态', en: 'Watchdog state', group: 'supervision' },
  watchdog_connected: { zh: '监督连接', en: 'Connected', group: 'supervision' },
  watchdog_operational: { zh: '监督可用', en: 'Operational', group: 'supervision' },
  watchdog_consecutive_failures: { zh: '连续失败', en: 'Consecutive failures', group: 'supervision' },
  watchdog_last_error: { zh: '最近错误', en: 'Last error', group: 'supervision' },
  watchdog_last_poll_at: { zh: '最近轮询', en: 'Last poll', group: 'supervision' },
  watchdog_last_success_at: { zh: '最近成功', en: 'Last success', group: 'supervision' },
  watchdog_registered_at: { zh: '监督注册时间', en: 'Registered at', group: 'supervision' },
  watchdog_prompt_version: { zh: '提示词版本', en: 'Prompt version', group: 'supervision' },
  watchdog_prompt_step_index: { zh: '提示词步骤', en: 'Prompt step', group: 'supervision' },
  watchdog_prompt_step_prompt: { zh: '自适应步骤提示词', en: 'Adaptive step prompt', group: 'supervision' },
  watchdog_prompt_updated_at: { zh: '提示词更新时间', en: 'Prompt updated at', group: 'supervision' },
  watchdog_prompt_updated_by: { zh: '提示词更新者', en: 'Prompt updated by', group: 'supervision' },
  task_identity_source: { zh: '任务身份来源', en: 'Task identity source', group: 'supervision' },
  watchdog_live_gate: { zh: 'Watchdog 实机验收', en: 'Watchdog live gate', group: 'supervision' },
  watchdog_protocol: { zh: 'Watchdog 协议', en: 'Watchdog protocol', group: 'supervision' },
  supervision_model: { zh: '监督模型', en: 'Supervision model', group: 'supervision' },
  ready: { zh: '服务就绪', en: 'Ready', group: 'health' },
  polling_fresh: { zh: '轮询新鲜度', en: 'Polling fresh', group: 'health' },
  active_count: { zh: '活动任务数', en: 'Active count', group: 'health' },
  degraded_count: { zh: '异常任务数', en: 'Degraded count', group: 'health' },
  last_poll_error: { zh: '轮询错误', en: 'Last poll error', group: 'health' },
  protocol_version: { zh: '协议版本', en: 'Protocol version', group: 'health' },
  ui: { zh: '视觉界面', en: 'UI system', group: 'product' },
  graph_ui: { zh: '图谱界面', en: 'Graph UI', group: 'product' },
  web_ui: { zh: '网页界面', en: 'Web UI', group: 'product' },
  bilingual_ui: { zh: '双语界面', en: 'Bilingual UI', group: 'product' },
  typography: { zh: '字体层级', en: 'Typography', group: 'product' },
  agent_cli: { zh: '智能体 CLI', en: 'Agent CLI', group: 'product' },
  agent_mcp: { zh: '智能体 MCP', en: 'Agent MCP', group: 'product' },
  global_skill: { zh: '全局技能', en: 'Global skill', group: 'product' },
  orca_access: { zh: 'Orca 接入', en: 'Orca access', group: 'product' },
  orca_review: { zh: 'Orca 审核', en: 'Orca review', group: 'product' },
  canonical_db: { zh: '事实数据库', en: 'Canonical DB', group: 'infrastructure' },
  obsidian_projection: { zh: 'Obsidian 投影', en: 'Obsidian projection', group: 'infrastructure' },
  tests: { zh: '测试状态', en: 'Tests', group: 'infrastructure' },
}

function factMeta(key: string): FactFieldMeta {
  const known = FACT_FIELD_META[key]
  if (known) return known

  const human = key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
  return {
    zh: key.replace(/_/g, ' '),
    en: human,
    group: 'other',
  }
}

function fieldLabel(key: string) {
  const meta = factMeta(key)
  return `${meta.zh} / ${meta.en}`
}

function EntityIcon({ type, size = 16 }: { type: string; size?: number }) {
  const props = { size, strokeWidth: 1.75 }
  if (type === 'task') return <ShieldCheck {...props} />
  if (type === 'conversation') return <MessageSquareText {...props} />
  if (type === 'agent' || type === 'agent_session') return <Bot {...props} />
  if (type === 'project') return <Layers3 {...props} />
  if (type === 'repo') return <FolderGit2 {...props} />
  if (type === 'branch' || type === 'worktree') return <GitBranch {...props} />
  if (type === 'experiment') return <FlaskConical {...props} />
  if (type === 'run') return <Activity {...props} />
  if (type === 'process') return <Cpu {...props} />
  if (type === 'host') return <Monitor {...props} />
  if (type === 'service') return <Server {...props} />
  if (type === 'file') return <FileText {...props} />
  if (type === 'artifact') return <Box {...props} />
  return <Database {...props} />
}

function stringValue(v: unknown) {
  return typeof v === 'string' && v.length ? v : undefined
}

function value(v: unknown) {
  return v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v)
}

function compactTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dateTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}