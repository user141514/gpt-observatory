import { createHash, randomUUID } from 'node:crypto'
import { RecordId } from 'surrealdb'
import type { ObservatoryDb } from './db.js'

export interface SourceInput {
  key: string
  type: string
  authorityScope?: string
  metadata?: Record<string, unknown>
}

export interface EntityInput {
  stableKey: string
  type: string
  label?: string
  metadata?: Record<string, unknown>
}

export interface ObserveInput {
  source: SourceInput
  entity: EntityInput
  observedAt?: string
  coverage: string[]
  facts: Record<string, unknown>
  rawPayload?: unknown
  status?: 'ok' | 'partial' | 'error'
}

export interface RelationInput {
  source: SourceInput
  from: EntityInput
  predicate: string
  to: EntityInput
  observedAt?: string
  rawPayload?: unknown
}

export interface ClearFactInput {
  source: SourceInput
  entity: EntityInput
  attribute: string
  observedAt?: string
  rawPayload?: unknown
}

export interface ClearRelationInput {
  source: SourceInput
  from: EntityInput
  predicate: string
  observedAt?: string
  rawPayload?: unknown
}

export interface ObserveResult {
  observationId: string
  entityId: string
  changedAttributes: string[]
  unchangedAttributes: string[]
}

export interface CurrentEntity {
  id: string
  stableKey: string
  type: string
  label: string
  metadata: Record<string, unknown>
  lastObservedAt?: string
  currentFacts: Record<string, unknown>
}

type DbRow = Record<string, any>

export function createStore(db: ObservatoryDb) {
  async function ensureSource(input: SourceInput): Promise<RecordId> {
    const id = stableRecordId('source', input.key)
    const now = new Date()
    await db.query(
      input.authorityScope
        ? `UPSERT $id MERGE {
            key: $key,
            type: $type,
            authority_scope: $authority_scope,
            metadata: $metadata,
            created_at: $now,
            updated_at: $now
          } RETURN AFTER`
        : `UPSERT $id MERGE {
            key: $key,
            type: $type,
            metadata: $metadata,
            created_at: $now,
            updated_at: $now
          } RETURN AFTER`,
      {
        id,
        key: input.key,
        type: input.type,
        authority_scope: input.authorityScope,
        metadata: input.metadata ?? {},
        now,
      },
    )
    return id
  }

  async function ensureEntity(input: EntityInput): Promise<RecordId> {
    const id = stableRecordId('entity', input.stableKey)
    const now = new Date()
    await db.query(
      `UPSERT $id MERGE {
        stable_key: $stable_key,
        type: $type,
        label: $label,
        metadata: $metadata,
        created_at: $now,
        updated_at: $now
      } RETURN AFTER`,
      {
        id,
        stable_key: input.stableKey,
        type: input.type,
        label: input.label ?? input.stableKey,
        metadata: input.metadata ?? {},
        now,
      },
    )
    return id
  }

  async function observe(input: ObserveInput): Promise<ObserveResult> {
    const sourceId = await ensureSource(input.source)
    const entityId = await ensureEntity(input.entity)
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date()
    const recordedAt = new Date()
    const observationId = new RecordId('observation', randomUUID())
    const rawPayload = input.rawPayload ?? { facts: input.facts }
    const snapshotHash = hashCanonical({
      coverage: [...input.coverage].sort(),
      facts: input.facts,
      rawPayload,
    })

    await db.query(
      `CREATE $id SET
        source = $source,
        entity = $entity,
        observed_at = $observed_at,
        recorded_at = $recorded_at,
        coverage = $coverage,
        snapshot_hash = $snapshot_hash,
        raw_payload = $raw_payload,
        status = $status
      RETURN AFTER`,
      {
        id: observationId,
        source: sourceId,
        entity: entityId,
        observed_at: observedAt,
        recorded_at: recordedAt,
        coverage: input.coverage,
        snapshot_hash: snapshotHash,
        raw_payload: rawPayload,
        status: input.status ?? 'ok',
      },
    )

    const changedAttributes: string[] = []
    const unchangedAttributes: string[] = []

    for (const [attribute, value] of Object.entries(input.facts)) {
      const current = firstRow(
        await db.query(
          `SELECT * FROM fact
           WHERE entity = $entity
             AND attribute = $attribute
             AND valid_to IS NONE
           ORDER BY valid_from DESC
           LIMIT 1`,
          { entity: entityId, attribute },
        ),
      )

      if (current && canonicalJson(current.value) === canonicalJson(value)) {
        unchangedAttributes.push(attribute)
        continue
      }

      if (current?.id) {
        await db.query('UPDATE $id SET valid_to = $valid_to', {
          id: current.id,
          valid_to: observedAt,
        })
      }

      const factId = new RecordId('fact', randomUUID())
      await db.query(
        `CREATE $id SET
          observation = $observation,
          entity = $entity,
          attribute = $attribute,
          value = $value,
          valid_from = $valid_from,
          valid_to = NONE,
          recorded_at = $recorded_at
        RETURN AFTER`,
        {
          id: factId,
          observation: observationId,
          entity: entityId,
          attribute,
          value,
          valid_from: observedAt,
          recorded_at: recordedAt,
        },
      )
      changedAttributes.push(attribute)
    }

    return {
      observationId: idString(observationId),
      entityId: idString(entityId),
      changedAttributes,
      unchangedAttributes,
    }
  }

  async function setRelation(input: RelationInput): Promise<{
    observationId: string
    relationChanged: boolean
  }> {
    const sourceId = await ensureSource(input.source)
    const fromId = await ensureEntity(input.from)
    const toId = await ensureEntity(input.to)
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date()
    const observationId = new RecordId('observation', randomUUID())

    await db.query(
      `CREATE $id SET
        source = $source,
        entity = $entity,
        observed_at = $observed_at,
        recorded_at = time::now(),
        coverage = [$coverage],
        snapshot_hash = $snapshot_hash,
        raw_payload = $raw_payload,
        status = "ok"`,
      {
        id: observationId,
        source: sourceId,
        entity: fromId,
        observed_at: observedAt,
        coverage: `relation:${input.predicate}`,
        snapshot_hash: hashCanonical({ predicate: input.predicate, to: input.to.stableKey }),
        raw_payload: input.rawPayload ?? {
          predicate: input.predicate,
          from: input.from.stableKey,
          to: input.to.stableKey,
        },
      },
    )

    const currentRelations = rows(
      await db.query(
        `SELECT * FROM relation
         WHERE in = $from
           AND predicate = $predicate
           AND valid_to IS NONE`,
        { from: fromId, predicate: input.predicate },
      ),
    )

    const unchanged = currentRelations.some((relation) => idString(relation.out) === idString(toId))
    if (unchanged) {
      return { observationId: idString(observationId), relationChanged: false }
    }

    for (const relation of currentRelations) {
      await db.query('UPDATE $id SET valid_to = $valid_to', {
        id: relation.id,
        valid_to: observedAt,
      })
    }

    await db.query(
      `RELATE $from->relation->$to SET
        predicate = $predicate,
        observation = $observation,
        source = $source,
        valid_from = $valid_from,
        valid_to = NONE,
        recorded_at = time::now()`,
      {
        from: fromId,
        to: toId,
        predicate: input.predicate,
        observation: observationId,
        source: sourceId,
        valid_from: observedAt,
      },
    )

    return { observationId: idString(observationId), relationChanged: true }
  }

  async function clearFact(input: ClearFactInput): Promise<{
    observationId: string
    factsClosed: number
  }> {
    const sourceId = await ensureSource(input.source)
    const entityId = await ensureEntity(input.entity)
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date()
    const observationId = new RecordId('observation', randomUUID())

    await db.query(
      `CREATE $id SET
        source = $source,
        entity = $entity,
        observed_at = $observed_at,
        recorded_at = time::now(),
        coverage = [$coverage],
        snapshot_hash = $snapshot_hash,
        raw_payload = $raw_payload,
        status = "ok"`,
      {
        id: observationId,
        source: sourceId,
        entity: entityId,
        observed_at: observedAt,
        coverage: input.attribute,
        snapshot_hash: hashCanonical({ attribute: input.attribute, cleared: true }),
        raw_payload: input.rawPayload ?? {
          attribute: input.attribute,
          entity: input.entity.stableKey,
          cleared: true,
        },
      },
    )

    const current = rows(
      await db.query(
        `SELECT * FROM fact
         WHERE entity = $entity
           AND attribute = $attribute
           AND valid_to IS NONE`,
        { entity: entityId, attribute: input.attribute },
      ),
    )

    for (const fact of current) {
      await db.query('UPDATE $id SET valid_to = $valid_to', {
        id: fact.id,
        valid_to: observedAt,
      })
    }

    return {
      observationId: idString(observationId),
      factsClosed: current.length,
    }
  }

  async function clearRelation(input: ClearRelationInput): Promise<{
    observationId: string
    relationsClosed: number
  }> {
    const sourceId = await ensureSource(input.source)
    const fromId = await ensureEntity(input.from)
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date()
    const observationId = new RecordId('observation', randomUUID())

    await db.query(
      `CREATE $id SET
        source = $source,
        entity = $entity,
        observed_at = $observed_at,
        recorded_at = time::now(),
        coverage = [$coverage],
        snapshot_hash = $snapshot_hash,
        raw_payload = $raw_payload,
        status = "ok"`,
      {
        id: observationId,
        source: sourceId,
        entity: fromId,
        observed_at: observedAt,
        coverage: `relation:${input.predicate}`,
        snapshot_hash: hashCanonical({ predicate: input.predicate, cleared: true }),
        raw_payload: input.rawPayload ?? {
          predicate: input.predicate,
          from: input.from.stableKey,
          cleared: true,
        },
      },
    )

    const current = rows(
      await db.query(
        `SELECT * FROM relation
         WHERE in = $from
           AND predicate = $predicate
           AND valid_to IS NONE`,
        { from: fromId, predicate: input.predicate },
      ),
    )

    for (const relation of current) {
      await db.query('UPDATE $id SET valid_to = $valid_to', {
        id: relation.id,
        valid_to: observedAt,
      })
    }

    return {
      observationId: idString(observationId),
      relationsClosed: current.length,
    }
  }

  async function currentEntities(): Promise<CurrentEntity[]> {
    const entityRows = rows(
      await db.query(
        'SELECT * FROM entity WHERE type NOT IN ["browser_tab", "supervised_task"] ORDER BY type, label',
      ),
    )
    const factRows = rows(
      await db.query(
        'SELECT * FROM fact WHERE valid_to IS NONE ORDER BY entity, attribute',
      ),
    )
    const observationRows = rows(
      await db.query(
        'SELECT entity, observed_at FROM observation ORDER BY observed_at DESC LIMIT 1000',
      ),
    )

    const factsByEntity = new Map<string, Record<string, unknown>>()
    for (const fact of factRows) {
      const key = idString(fact.entity)
      const facts = factsByEntity.get(key) ?? {}
      facts[fact.attribute] = toJsonValue(fact.value)
      factsByEntity.set(key, facts)
    }

    const lastObserved = new Map<string, string>()
    for (const observation of observationRows) {
      const key = idString(observation.entity)
      if (!lastObserved.has(key)) {
        lastObserved.set(key, iso(observation.observed_at))
      }
    }

    return entityRows.map((entity) => ({
      id: idString(entity.id),
      stableKey: entity.stable_key,
      type: entity.type,
      label: entity.label,
      metadata: toJsonValue(entity.metadata) as Record<string, unknown>,
      lastObservedAt: lastObserved.get(idString(entity.id)),
      currentFacts: factsByEntity.get(idString(entity.id)) ?? {},
    }))
  }

  async function timeline(): Promise<Array<Record<string, unknown>>> {
    const factRows = rows(
      await db.query(
        'SELECT * FROM fact ORDER BY entity, attribute, valid_from ASC',
      ),
    )
    const entityRows = rows(await db.query('SELECT id, stable_key, label, type FROM entity'))
    const entities = new Map(entityRows.map((entity) => [idString(entity.id), entity]))
    const grouped = new Map<string, DbRow[]>()

    for (const fact of factRows) {
      const key = `${idString(fact.entity)}::${fact.attribute}`
      const group = grouped.get(key) ?? []
      group.push(fact)
      grouped.set(key, group)
    }

    const events: Array<Record<string, unknown>> = []
    for (const group of grouped.values()) {
      group.sort((a, b) => +new Date(a.valid_from) - +new Date(b.valid_from))
      for (let i = 0; i < group.length; i += 1) {
        const fact = group[i]
        const previous = i > 0 ? group[i - 1] : undefined
        const entity = entities.get(idString(fact.entity))
        if (entity?.type === 'browser_tab' || entity?.type === 'supervised_task') continue
        events.push({
          id: idString(fact.id),
          entityId: idString(fact.entity),
          stableKey: entity?.stable_key ?? idString(fact.entity),
          entityLabel: entity?.label ?? entity?.stable_key ?? idString(fact.entity),
          entityType: entity?.type ?? 'unknown',
          attribute: fact.attribute,
          from: previous ? toJsonValue(previous.value) : undefined,
          to: toJsonValue(fact.value),
          at: iso(fact.valid_from),
          initial: !previous,
        })
      }
    }

    return events.sort((a, b) => +new Date(String(b.at)) - +new Date(String(a.at)))
  }

  async function graph(): Promise<{
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }> {
    const entities = await currentEntities()
    const relationRows = rows(
      await db.query(
        'SELECT * FROM relation WHERE valid_to IS NONE ORDER BY valid_from DESC',
      ),
    )
    const visibleNodeIds = new Set(entities.map(entity => entity.id))

    return {
      nodes: entities.map((entity) => ({
        id: entity.id,
        stableKey: entity.stableKey,
        label: entity.label,
        type: entity.type,
        facts: entity.currentFacts,
        lastObservedAt: entity.lastObservedAt,
      })),
      edges: relationRows
        .filter(
          relation =>
            visibleNodeIds.has(idString(relation.in))
            && visibleNodeIds.has(idString(relation.out)),
        )
        .map((relation) => ({
          id: idString(relation.id),
          source: idString(relation.in),
          target: idString(relation.out),
          predicate: relation.predicate,
          validFrom: iso(relation.valid_from),
          observationId: idString(relation.observation),
        })),
    }
  }

  async function counts(): Promise<Record<string, number>> {
    const [entities, observations, facts, relations, semantic] = await Promise.all([
      countTable('entity'),
      countTable('observation'),
      countTable('fact'),
      countTable('relation'),
      countTable('semantic_doc'),
    ])
    return { entities, observations, facts, relations, semantic }
  }

  async function countTable(table: string): Promise<number> {
    const result = firstRow(await db.query(`SELECT count() AS count FROM ${table} GROUP ALL`))
    return Number(result?.count ?? 0)
  }

  async function currentStateText(entityId: string): Promise<{
    stableKey: string
    text: string
    factIds: string[]
  } | undefined> {
    const id = parseRecordId(entityId)
    const entity = firstRow(await db.query('SELECT * FROM $id', { id }))
    if (!entity) return undefined

    const facts = rows(
      await db.query(
        `SELECT * FROM fact
         WHERE entity = $entity
           AND valid_to IS NONE
         ORDER BY attribute`,
        { entity: id },
      ),
    )

    const factualLines = facts.map(
      (fact) => `${fact.attribute}: ${canonicalJson(toJsonValue(fact.value))}`,
    )
    const text = [
      `entity type: ${entity.type}`,
      `entity key: ${entity.stable_key}`,
      `label: ${entity.label}`,
      ...factualLines,
    ].join('\n')

    return {
      stableKey: entity.stable_key,
      text,
      factIds: facts.map((fact) => idString(fact.id)),
    }
  }

  return {
    ensureSource,
    ensureEntity,
    observe,
    setRelation,
    clearFact,
    clearRelation,
    currentEntities,
    timeline,
    graph,
    counts,
    currentStateText,
  }
}

export function rows(result: unknown): DbRow[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return []
  return result[0] as DbRow[]
}

export function firstRow(result: unknown): DbRow | undefined {
  return rows(result)[0]
}

export function idString(value: unknown): string {
  if (value && typeof value === 'object' && 'toString' in value) {
    return String(value)
  }
  return String(value)
}

export function parseRecordId(value: string): RecordId {
  const separator = value.indexOf(':')
  if (separator <= 0) throw new Error(`Invalid record id: ${value}`)
  return new RecordId(value.slice(0, separator), value.slice(separator + 1))
}

function stableRecordId(table: string, key: string): RecordId {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 32)
  return new RecordId(table, hash)
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortValue(nested)]),
    )
  }
  return value
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function toJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}
