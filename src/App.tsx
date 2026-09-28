import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { api } from './api'
import type { GraphResponse, NowResponse, SearchResult, TimelineEvent } from './types'
import './App.css'

type Tab = 'now' | 'timeline' | 'graph' | 'search'
type GraphNode = GraphResponse['nodes'][number]

const tabs: Array<{ id: Tab; zh: string; en: string }> = [
  { id: 'now', zh: '当前状态', en: 'NOW' },
  { id: 'timeline', zh: '时间线', en: 'TIMELINE' },
  { id: 'graph', zh: '知识图谱', en: 'KNOWLEDGE GRAPH' },
  { id: 'search', zh: '语义检索', en: 'SEMANTIC SEARCH' },
]

const metricLabels: Array<{ key: string; zh: string; en: string; detail: string }> = [
  { key: 'entities', zh: '实体', en: 'Entities', detail: '被观测对象' },
  { key: 'observations', zh: '观测', en: 'Observations', detail: '事实证据点' },
  { key: 'facts', zh: '事实', en: 'Facts', detail: '时态状态区间' },
  { key: 'relations', zh: '关系', en: 'Relations', detail: '事实关系边' },
  { key: 'semantic', zh: '语义索引', en: 'Semantic', detail: '向量检索记录' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('now')
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
      const [n, t, g] = await Promise.all([api.now(), api.timeline(), api.graph()])
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
              <span className={refreshing ? 'refresh-icon spinning' : 'refresh-icon'} aria-hidden="true">↻</span>
              <span>{refreshing ? '同步中' : '刷新'}<small>{refreshing ? 'SYNCING' : 'REFRESH'}</small></span>
            </button>
          </div>
        </header>

        <section className="metrics" aria-label="Observatory metrics">
          {metricLabels.map(metric => (
            <Metric
              key={metric.key}
              zh={metric.zh}
              en={metric.en}
              value={now.counts[metric.key] ?? 0}
              detail={metric.detail}
            />
          ))}
        </section>

        <nav className="view-nav" aria-label="Observatory views">
          {tabs.map(item => (
            <button
              className={tab === item.id ? 'view-tab active' : 'view-tab'}
              onClick={() => setTab(item.id)}
              key={item.id}
              type="button"
            >
              <span>{item.zh}</span>
              <small>{item.en}</small>
            </button>
          ))}
        </nav>

        {error && (
          <div className="error-panel" role="alert">
            <strong>观测站接口异常 / Observatory API Error</strong>
            <span>{error}</span>
          </div>
        )}

        <section className="workspace-panel">
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

function Now({ data }: { data: NowResponse }) {
  if (!data.entities.length) return <Empty zh="暂无观测" en="No observations yet." />

  return (
    <section>
      <SectionHeading
        kickerZh="实时事实"
        kickerEn="CURRENT FACTS"
        titleZh="当前状态"
        titleEn="Current State"
        meta={`${data.entities.length} 个实体 / ${data.entities.length} entities`}
      />

      <div className="cards">
        {data.entities.map(entity => (
          <article key={entity.id}>
            <div className="cardhead">
              <div>
                <EntityTypeBadge type={entity.type} />
                <h2>{entity.label}</h2>
              </div>
              <time>{time(entity.lastObservedAt)}</time>
            </div>

            <code className="key">{entity.stableKey}</code>

            <dl>
              {Object.entries(entity.currentFacts).map(([key, fact]) => (
                <div key={key}>
                  <dt>{fieldLabel(key)}</dt>
                  <dd>{value(fact)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
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
              </p>
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
    const ranked = [...visibleNodes]
      .sort((a, b) => (degreeByNode.get(b.id) ?? 0) - (degreeByNode.get(a.id) ?? 0))
      .slice(0, Math.min(18, Math.max(6, Math.ceil(visibleNodes.length * 0.12))))
    return new Set(ranked.map(node => node.id))
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
          const size = Math.max(18, Math.min(38, 18 + Math.sqrt(degree) * 5))
          return {
            data: {
              id: node.id,
              label: persistentLabelIds.has(node.id) ? node.label : '',
              fullLabel: node.label,
              type: node.type,
              color: entityColor(node.type),
              size,
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
            width: 'data(size)',
            height: 'data(size)',
            'background-color': 'data(color)',
            'background-opacity': 0.94,
            'border-color': '#ffffff',
            'border-width': 2,
            color: '#4a555f',
            'font-size': '9.5px',
            'font-weight': 600,
            'text-wrap': 'ellipsis',
            'text-max-width': '96px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 7,
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'line-color': '#c7cdd2',
            'target-arrow-color': '#bac1c7',
            width: 0.8,
            'font-size': '8px',
            color: '#77818a',
            'text-background-color': '#f7f8f6',
            'text-background-opacity': 0.86,
            'text-background-padding': '2px',
            'arrow-scale': 0.55,
            opacity: 0.68,
          },
        },
        {
          selector: '.is-faded',
          style: { opacity: 0.13, 'text-opacity': 0.12 },
        },
        {
          selector: 'node.is-neighbor',
          style: {
            label: 'data(fullLabel)',
            'border-color': '#7b8995',
            'border-width': 2.2,
            'text-opacity': 1,
          },
        },
        {
          selector: 'edge.is-active-relation',
          style: {
            label: 'data(fullLabel)',
            width: 1.4,
            opacity: 0.95,
            'line-color': '#8e9aa4',
            'target-arrow-color': '#7e8b95',
            'font-size': '8.5px',
          },
        },
        {
          selector: 'node.is-focus',
          style: {
            label: 'data(fullLabel)',
            'border-color': '#344452',
            'border-width': 3,
            'text-opacity': 1,
          },
        },
        {
          selector: 'node.is-search-match',
          style: {
            label: 'data(fullLabel)',
            'border-color': '#a38a61',
            'border-width': 3,
            'text-opacity': 1,
          },
        },
        {
          selector: 'node.is-hover',
          style: {
            label: 'data(fullLabel)',
            'text-opacity': 1,
            'border-width': 2.5,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        padding: 86,
        nodeRepulsion: () => 12000,
        idealEdgeLength: () => 118,
        nodeOverlap: 18,
        gravity: 0.3,
        numIter: 1400,
      },
      minZoom: 0.25,
      maxZoom: 2.5,
    })

    cy.on('tap', 'node', event => {
      const node = event.target
      const id = node.id()
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
    } else {
      clearGraphFocus(cy)
    }
  }, [selectedNodeId, visibleNodeIds])

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
              <button type="button" onClick={locateFirstMatch}>⌕</button>
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
            <Legend color="#aab9c8" zh="工作与对话" en="Work & Conversation" />
            <Legend color="#aebcab" zh="代码与载体" en="Code & Artifacts" />
            <Legend color="#c5ad88" zh="执行与实验" en="Runtime & Experiments" />
          </div>
        </aside>

        <div className="graph-stage">
          <div className="graph-toolbar">
            <div className="graph-toolbar-copy">
              <span>关系画布</span>
              <small>RELATION CANVAS</small>
            </div>
            <div className="graph-controls">
              <button type="button" onClick={() => zoom(1.18)} title="放大 / Zoom in">＋</button>
              <button type="button" onClick={() => zoom(0.84)} title="缩小 / Zoom out">−</button>
              <button type="button" className="fit-button" onClick={fitGraph}>适配 <small>FIT</small></button>
            </div>
          </div>

          <div className="graph" ref={graphRef} />

          <div className="graph-stage-note">
            <span>点击节点查看邻接关系，空白处取消聚焦。</span>
            <small>Click a node to isolate its neighborhood. Click canvas to reset.</small>
          </div>
        </div>

        <aside className="graph-inspector">
          <GraphPanelHeading zh="实体检查器" en="ENTITY INSPECTOR" />

          {selectedNode ? (
            <NodeInspector node={selectedNode} relations={selectedRelations} />
          ) : (
            <div className="inspector-empty">
              <div>◎</div>
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
}: {
  node: GraphNode
  relations: Array<GraphResponse['edges'][number] & { direction: 'in' | 'out'; peer?: GraphNode }>
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
              <div key={relation.id}>
                <span className={relation.direction === 'out' ? 'relation-direction out' : 'relation-direction in'}>
                  {relation.direction === 'out' ? '→' : '←'}
                </span>
                <div>
                  <strong>{relation.predicate}</strong>
                  <span>{relation.peer?.label ?? 'Unknown entity'}</span>
                </div>
              </div>
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
          <span aria-hidden="true">⌕</span>
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
      <div className="empty-mark" aria-hidden="true">◎</div>
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
  const neighborNodes = connectedEdges.connectedNodes()
  cy.elements().addClass('is-faded')
  node.removeClass('is-faded').addClass('is-focus')
  neighborNodes.removeClass('is-faded').addClass('is-neighbor')
  connectedEdges.removeClass('is-faded').addClass('is-active-relation')
}

function clearGraphFocus(cy: Core) {
  cy.elements().removeClass('is-faded is-neighbor is-focus is-active-relation')
}

function entityColor(type: string) {
  if (['task', 'conversation', 'project', 'agent_session'].includes(type)) return '#aab9c8'
  if (['repo', 'branch', 'worktree', 'file', 'artifact'].includes(type)) return '#aebcab'
  if (['agent', 'host', 'process', 'experiment', 'run'].includes(type)) return '#c5ad88'
  return '#b9bec2'
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

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    status: '状态 / status',
    phase: '阶段 / phase',
    canonical_db: '事实库 / canonical DB',
    web_ui: '网页界面 / web UI',
    ui: '视觉界面 / UI',
    tests: '测试 / tests',
    obsidian_projection: 'Obsidian 投影 / projection',
    agent_cli: '智能体 CLI / agent CLI',
    agent_mcp: '智能体 MCP / agent MCP',
    global_skill: '全局技能 / global skill',
    orca_access: 'Orca 接入 / Orca access',
  }
  return labels[key] ?? key
}

function value(v: unknown) {
  return v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v)
}

function time(v?: string) {
  return v ? new Date(v).toLocaleTimeString('zh-CN', { hour12: false }) : '未观测 / unobserved'
}

function dateTime(v: string) {
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}