import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import cytoscape from 'cytoscape'
import { api } from './api'
import type { GraphResponse, NowResponse, SearchResult, TimelineEvent } from './types'
import './App.css'

type Tab = 'now' | 'timeline' | 'graph' | 'search'

export default function App() {
  const [tab, setTab] = useState<Tab>('now')
  const [now, setNow] = useState<NowResponse>({ counts: {}, entities: [] })
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [] })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const [n, t, g] = await Promise.all([api.now(), api.timeline(), api.graph()])
      setNow(n); setTimeline(t.events); setGraph(g); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function search(e: FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    try { setResults((await api.search(query.trim())).results); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return <main className="shell">
    <header><div><small>LOCAL FACTUAL STATE SYSTEM</small><h1>GPT Observatory</h1></div>
      <button onClick={() => void refresh()}>Refresh</button></header>
    <section className="metrics">
      {['entities','observations','facts','relations','semantic'].map(k =>
        <div key={k}><span>{k}</span><strong>{now.counts[k] ?? 0}</strong></div>)}
    </section>
    <nav>{(['now','timeline','graph','search'] as Tab[]).map(t =>
      <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>{t.toUpperCase()}</button>)}</nav>
    {error && <p className="error">{error}</p>}
    {tab === 'now' && <Now data={now} />}
    {tab === 'timeline' && <Timeline events={timeline} />}
    {tab === 'graph' && <Graph data={graph} />}
    {tab === 'search' && <Search query={query} setQuery={setQuery} results={results} submit={search} />}
  </main>
}

function Now({ data }: { data: NowResponse }) {
  if (!data.entities.length) return <Empty text="No observations yet." />
  return <section className="cards">{data.entities.map(e => <article key={e.id}>
    <div className="cardhead"><div><small>{e.type}</small><h2>{e.label}</h2></div><time>{time(e.lastObservedAt)}</time></div>
    <code className="key">{e.stableKey}</code>
    <dl>{Object.entries(e.currentFacts).map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{value(v)}</dd></div>)}</dl>
  </article>)}</section>
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <Empty text="No fact versions yet." />
  return <section className="timeline">{events.map(e => <article key={e.id}>
    <time>{dateTime(e.at)}</time><div><strong>{e.entityLabel}</strong> <span>{e.attribute}</span>
    <p><code>{e.initial ? '∅' : value(e.from)}</code> → <code>{value(e.to)}</code></p></div>
  </article>)}</section>
}

function Graph({ data }: { data: GraphResponse }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !data.nodes.length) return
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...data.nodes.map(n => ({ data: { id:n.id, label:n.label } })),
        ...data.edges.map(e => ({ data: { id:e.id, source:e.source, target:e.target, label:e.predicate } }))
      ],
      style: [
        { selector:'node', style:{ label:'data(label)', 'background-color':'#64748b', 'text-valign':'bottom', 'text-margin-y':8, color:'#334155' } },
        { selector:'edge', style:{ label:'data(label)', 'curve-style':'bezier', 'target-arrow-shape':'triangle', 'line-color':'#94a3b8', 'target-arrow-color':'#94a3b8', 'font-size':10 } }
      ],
      layout:{ name:'cose', animate:false, padding:24 }
    })
    return () => cy.destroy()
  }, [data])
  if (!data.nodes.length) return <Empty text="No factual graph yet." />
  return <section><p className="lede">{data.nodes.length} nodes · {data.edges.length} current factual edges</p><div className="graph" ref={ref}/></section>
}

function Search({ query, setQuery, results, submit }: { query:string; setQuery:(v:string)=>void; results:SearchResult[]; submit:(e:FormEvent)=>void }) {
  return <section className="search"><p className="lede">384-d local semantic retrieval over factual state.</p>
    <form onSubmit={submit}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by meaning…"/><button>Search</button></form>
    {results.map(r => <article key={r.id}><strong>{r.targetKey}</strong><small> distance {r.distance.toFixed(4)}</small><pre>{r.text}</pre></article>)}
  </section>
}

function Empty({ text }: { text:string }) { return <div className="empty">{text}</div> }
function value(v:unknown) { return v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v) }
function time(v?:string) { return v ? new Date(v).toLocaleTimeString() : 'unobserved' }
function dateTime(v:string) { return new Date(v).toLocaleString() }
