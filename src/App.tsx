import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import cytoscape from 'cytoscape'
import { api } from './api'
import type { GraphResponse, NowResponse, SearchResult, TimelineEvent } from './types'
import './App.css'

type Tab = 'now' | 'timeline' | 'graph' | 'search'

const tabs: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'now', label: 'NOW', hint: 'Current factual state' },
  { id: 'timeline', label: 'TIMELINE', hint: 'State transitions' },
  { id: 'graph', label: 'GRAPH', hint: 'Factual topology' },
  { id: 'search', label: 'SEARCH', hint: 'Semantic retrieval' },
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

  async function search(e: FormEvent) {
    e.preventDefault()
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
              <small>LOCAL FACTUAL STATE SYSTEM</small>
            </div>
            <h1>GPT Observatory</h1>
            <p className="hero-subtitle">
              Temporal facts, factual graph, semantic retrieval and durable local state.
            </p>
          </div>

          <div className="hero-actions">
            <div className="system-state" title={error || 'Canonical API reachable'}>
              <span className={error ? 'system-dot system-dot-error' : 'system-dot'} />
              <div>
                <strong>{error ? 'Attention required' : 'Canonical state online'}</strong>
                <span>{refreshing ? 'Synchronizing…' : 'Local / persistent / inspectable'}</span>
              </div>
            </div>
            <button
              type="button"
              className="refresh-button"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <span className={refreshing ? 'refresh-icon spinning' : 'refresh-icon'} aria-hidden="true">↻</span>
              {refreshing ? 'Syncing' : 'Refresh'}
            </button>
          </div>
        </header>

        <section className="metrics" aria-label="Observatory metrics">
          <Metric label="Entities" value={now.counts.entities ?? 0} detail="Observed objects" />
          <Metric label="Observations" value={now.counts.observations ?? 0} detail="Evidence points" />
          <Metric label="Facts" value={now.counts.facts ?? 0} detail="State intervals" />
          <Metric label="Relations" value={now.counts.relations ?? 0} detail="Factual edges" />
          <Metric label="Semantic" value={now.counts.semantic ?? 0} detail="Vector records" />
        </section>

        <nav className="view-nav" aria-label="Observatory views">
          {tabs.map(item => (
            <button
              className={tab === item.id ? 'view-tab active' : 'view-tab'}
              onClick={() => setTab(item.id)}
              key={item.id}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>

        {error && (
          <div className="error-panel" role="alert">
            <strong>Observatory API error</strong>
            <span>{error}</span>
          </div>
        )}

        <section className="workspace-panel">
          {tab === 'now' && <Now data={now} />}
          {tab === 'timeline' && <Timeline events={timeline} />}
          {tab === 'graph' && <Graph data={graph} />}
          {tab === 'search' && (
            <Search
              query={query}
              setQuery={setQuery}
              results={results}
              submit={search}
            />
          )}
        </section>
      </main>
    </>
  )
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function Now({ data }: { data: NowResponse }) {
  if (!data.entities.length) return <Empty text="No observations yet." />

  return (
    <section className="cards">
      {data.entities.map(entity => (
        <article key={entity.id}>
          <div className="cardhead">
            <div>
              <small>{entity.type}</small>
              <h2>{entity.label}</h2>
            </div>
            <time>{time(entity.lastObservedAt)}</time>
          </div>

          <code className="key">{entity.stableKey}</code>

          <dl>
            {Object.entries(entity.currentFacts).map(([key, fact]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value(fact)}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </section>
  )
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <Empty text="No fact versions yet." />

  return (
    <section className="timeline">
      <div className="view-heading">
        <div>
          <span className="view-kicker">Factual state history</span>
          <h2>Observed transitions</h2>
        </div>
        <small>{events.length} recorded fact versions</small>
      </div>

      <div className="timeline-list">
        {events.map(event => (
          <article key={event.id}>
            <time>{dateTime(event.at)}</time>
            <div className="timeline-rail" aria-hidden="true"><span /></div>
            <div className="timeline-content">
              <div className="timeline-title">
                <strong>{event.entityLabel}</strong>
                <span>{event.attribute}</span>
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

function Graph({ data }: { data: GraphResponse }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !data.nodes.length) return

    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...data.nodes.map(node => ({
          data: { id: node.id, label: node.label, type: node.type },
        })),
        ...data.edges.map(edge => ({
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.predicate,
          },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': '#7c8da3',
            'border-color': '#f8fafc',
            'border-width': 3,
            'text-valign': 'bottom',
            'text-margin-y': 10,
            color: '#334155',
            'font-size': '12px',
            'font-weight': 600,
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            width: 44,
            height: 44,
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'line-color': '#aab6c5',
            'target-arrow-color': '#aab6c5',
            width: 1.5,
            'font-size': '10px',
            color: '#64748b',
            'text-background-color': '#f8fafc',
            'text-background-opacity': 0.82,
            'text-background-padding': '4px',
          },
        },
      ],
      layout: { name: 'cose', animate: false, padding: 36 },
    })

    return () => cy.destroy()
  }, [data])

  if (!data.nodes.length) return <Empty text="No factual graph yet." />

  return (
    <section className="graph-section">
      <div className="view-heading">
        <div>
          <span className="view-kicker">Factual topology</span>
          <h2>Current relationship graph</h2>
        </div>
        <small>{data.nodes.length} nodes · {data.edges.length} current edges</small>
      </div>
      <div className="graph" ref={ref} />
    </section>
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
      <div className="view-heading">
        <div>
          <span className="view-kicker">384-dimensional local retrieval</span>
          <h2>Search factual state by meaning</h2>
        </div>
        <small>Derived vector index · canonical facts remain authoritative</small>
      </div>

      <form onSubmit={submit}>
        <div className="search-input-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search conversations, tasks, repositories, experiments…"
          />
        </div>
        <button type="submit">Search</button>
      </form>

      <div className="search-results">
        {results.map(result => (
          <article key={result.id}>
            <div className="search-result-head">
              <strong>{result.targetKey}</strong>
              <small>distance {result.distance.toFixed(4)}</small>
            </div>
            <pre>{result.text}</pre>
          </article>
        ))}
      </div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">◎</div>
      <strong>{text}</strong>
      <span>Waiting for factual observations.</span>
    </div>
  )
}

function value(v: unknown) {
  return v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v)
}

function time(v?: string) {
  return v ? new Date(v).toLocaleTimeString() : 'unobserved'
}

function dateTime(v: string) {
  return new Date(v).toLocaleString()
}
