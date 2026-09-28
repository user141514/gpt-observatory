import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface CurrentEntity {
  id: string
  stableKey: string
  type: string
  label: string
  lastObservedAt?: string
  currentFacts: Record<string, unknown>
}

interface GraphResponse {
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
}

interface TimelineEvent {
  entityLabel: string
  attribute: string
  from?: unknown
  to: unknown
  at: string
}

const apiBase = process.env.OBSERVATORY_API ?? 'http://127.0.0.1:4317'

async function main() {
  const [now, graph, timeline] = await Promise.all([
    getJson<{ entities: CurrentEntity[] }>(`${apiBase}/api/now`),
    getJson<GraphResponse>(`${apiBase}/api/graph`),
    getJson<{ events: TimelineEvent[] }>(`${apiBase}/api/timeline`),
  ])

  const root = resolve(process.cwd(), 'obsidian-vault')
  const entitiesDir = resolve(root, 'Entities')
  const viewsDir = resolve(root, 'Views')
  const dashboardDir = resolve(root, '00 Dashboard')

  await rm(root, { recursive: true, force: true })
  await Promise.all([
    mkdir(entitiesDir, { recursive: true }),
    mkdir(viewsDir, { recursive: true }),
    mkdir(dashboardDir, { recursive: true }),
  ])

  const entityById = new Map(now.entities.map((entity) => [entity.id, entity]))
  const linksBySource = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const source = String(edge.source)
    const target = entityById.get(String(edge.target))
    if (!target) continue
    const list = linksBySource.get(source) ?? []
    list.push(`- ${String(edge.predicate)} → [[${safeName(target.label)}]]`)
    linksBySource.set(source, list)
  }

  for (const entity of now.entities) {
    const facts = Object.entries(entity.currentFacts)
      .map(([key, value]) => `- **${key}**: ${inline(value)}`)
      .join('\n')
    const links = (linksBySource.get(entity.id) ?? []).join('\n') || '- None'
    const frontmatterFacts = Object.entries(entity.currentFacts)
      .map(([key, value]) => `  ${yamlKey(key)}: ${yamlValue(value)}`)
      .join('\n')

    const note = `---
observatory_entity: true
entity_id: "${escapeYaml(entity.id)}"
stable_key: "${escapeYaml(entity.stableKey)}"
entity_type: "${escapeYaml(entity.type)}"
status: ${yamlValue(entity.currentFacts.status ?? '')}
last_observed_at: "${escapeYaml(entity.lastObservedAt ?? '')}"
facts:
${frontmatterFacts || '  {}'}
---

# ${entity.label}

## Current factual state

${facts || '- No current facts'}

## Current factual relations

${links}

## Provenance

Canonical source: GPT Observatory API backed by SurrealDB.
This note is a rebuildable projection; edit canonical facts through the ingestion API, not here.
`

    await writeFile(resolve(entitiesDir, `${safeName(entity.label)}.md`), note, 'utf8')
  }

  const dashboard = `# NOW

Generated: ${new Date().toISOString()}

## Entities

${now.entities
  .map(
    (entity) =>
      `- [[${safeName(entity.label)}]] — ${entity.type} — last observed ${entity.lastObservedAt ?? 'unknown'}`,
  )
  .join('\n')}

## Recent factual changes

${timeline.events
  .slice(0, 40)
  .map(
    (event) =>
      `- ${event.at} — [[${safeName(event.entityLabel)}]] — ${event.attribute}: ${inline(event.from)} → ${inline(event.to)}`,
  )
  .join('\n')}
`
  await writeFile(resolve(dashboardDir, 'NOW.md'), dashboard, 'utf8')

  const base = `filters:
  and:
    - 'observatory_entity == true'
properties:
  entity_type:
    displayName: Type
  status:
    displayName: Status
  last_observed_at:
    displayName: Last observed
views:
  - type: table
    name: Entities
    order:
      - file.name
      - entity_type
      - status
      - last_observed_at
  - type: graph
    name: Graph
`
  await writeFile(resolve(viewsDir, 'Entities.base'), base, 'utf8')

  await writeFile(
    resolve(root, 'README.md'),
    `# GPT Observatory projection

Open this directory as an Obsidian vault.

Recommended views:
- Core Graph: works immediately from generated wikilinks.
- Bases: open \`Views/Entities.base\`.
- Base Graph community plugin: adds the graph view to Bases.
- ExcaliBrain / Juggl: can consume the same wikilinks and frontmatter for local graph exploration.

The vault is generated output. SurrealDB remains canonical.
`,
    'utf8',
  )

  console.log(
    `Exported ${now.entities.length} entities and ${graph.edges.length} current relations to ${root}`,
  )
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Observatory API ${response.status} ${response.statusText}: ${url}`)
  }
  return response.json() as Promise<T>
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'unnamed'
}

function inline(value: unknown): string {
  if (value === undefined) return '∅'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function yamlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : JSON.stringify(value)
}

function yamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return `"${escapeYaml(typeof value === 'string' ? value : JSON.stringify(value))}"`
}

function escapeYaml(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
