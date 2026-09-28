export interface AgentContextOptions {
  recent?: number
}

const DEFAULT_API = process.env.OBSERVATORY_API ?? 'http://127.0.0.1:4317'

export class ObservatoryAgentClient {
  readonly baseUrl: string

  constructor(baseUrl = DEFAULT_API) {
    this.baseUrl = baseUrl
  }

  async health() {
    return this.get('/api/health')
  }

  async now() {
    return this.get('/api/now')
  }

  async timeline() {
    return this.get('/api/timeline')
  }

  async graph() {
    return this.get('/api/graph')
  }

  async search(query: string) {
    return this.get(`/api/search?q=${encodeURIComponent(query)}`)
  }

  async observe(payload: unknown) {
    return this.post('/api/observe', payload)
  }

  async relate(payload: unknown) {
    return this.post('/api/relations', payload)
  }

  async reindex() {
    return this.post('/api/semantic/reindex', {})
  }

  async context(options: AgentContextOptions = {}) {
    const recent = Math.max(1, Math.min(100, options.recent ?? 20))
    const [health, now, timeline, graph] = await Promise.all([
      this.health(),
      this.now(),
      this.timeline(),
      this.graph(),
    ])

    const timelineValue = timeline as { events?: unknown[] }
    const graphValue = graph as { nodes?: unknown[]; edges?: unknown[] }

    return {
      generatedAt: new Date().toISOString(),
      canonicalApi: this.baseUrl,
      health,
      current: now,
      recentChanges: Array.isArray(timelineValue.events)
        ? timelineValue.events.slice(0, recent)
        : [],
      graph: {
        nodes: Array.isArray(graphValue.nodes) ? graphValue.nodes : [],
        edges: Array.isArray(graphValue.edges) ? graphValue.edges : [],
      },
    }
  }

  private async get(path: string): Promise<unknown> {
    return this.request(path, { method: 'GET' })
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), init)
    const text = await response.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Preserve raw body when a boundary returns non-JSON.
    }
    if (!response.ok) {
      throw new Error(
        `Observatory API ${response.status} ${response.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
      )
    }
    return body
  }
}
