import { createHash } from 'node:crypto'
import { RecordId } from 'surrealdb'
import type { ObservatoryDb } from './db.js'
import { embed, embeddingModel } from './embedding.js'
import { idString, rows, type CurrentEntity } from './store.js'

export function createSemanticIndex(
  db: ObservatoryDb,
  store: {
    currentEntities(): Promise<CurrentEntity[]>
    currentStateText(entityId: string): Promise<
      { stableKey: string; text: string; factIds: string[] } | undefined
    >
  },
) {
  async function reindexAll(): Promise<{ indexed: number; embeddingModel: string }> {
    const entities = await store.currentEntities()
    const model = await embeddingModel()
    let indexed = 0

    for (const entity of entities) {
      if (await indexEntity(entity.id)) indexed += 1
    }

    return { indexed, embeddingModel: model }
  }

  async function indexEntity(entityId: string): Promise<boolean> {
    const state = await store.currentStateText(entityId)
    if (!state) return false

    const embedded = await embed(state.text)
    const id = new RecordId(
      'semantic_doc',
      createHash('sha256').update(`entity_state:${state.stableKey}`).digest('hex').slice(0, 32),
    )
    const now = new Date()

    await db.query(
      `UPSERT $id MERGE {
        target_type: "entity_state",
        target_key: $target_key,
        text: $text,
        embedding: $embedding,
        source_fact_ids: $source_fact_ids,
        embedding_model: $embedding_model,
        created_at: $now,
        updated_at: $now
      } RETURN AFTER`,
      {
        id,
        target_key: state.stableKey,
        text: state.text,
        embedding: embedded.vector,
        source_fact_ids: state.factIds,
        embedding_model: embedded.model,
        now,
      },
    )

    return true
  }

  async function ensureCurrentIndex(): Promise<string> {
    const model = await embeddingModel()
    const entities = await store.currentEntities()
    const existingRows = rows(
      await db.query(
        `SELECT target_key, source_fact_ids, embedding_model
         FROM semantic_doc
         WHERE target_type = "entity_state"`,
      ),
    )
    const existingByKey = new Map(
      existingRows.map(row => [String(row.target_key), row]),
    )

    for (const entity of entities) {
      const state = await store.currentStateText(entity.id)
      if (!state) continue

      const existing = existingByKey.get(state.stableKey)
      const currentFactIds = normalizeFactIds(state.factIds)
      const indexedFactIds = normalizeFactIds(existing?.source_fact_ids)

      if (
        !existing
        || existing.embedding_model !== model
        || !sameStrings(indexedFactIds, currentFactIds)
      ) {
        await indexEntity(entity.id)
      }
    }

    return model
  }

  async function search(query: string): Promise<Array<Record<string, unknown>>> {
    const model = await ensureCurrentIndex()
    const embedded = await embed(query)

    if (embedded.model !== model) {
      throw new Error(
        `Embedding backend changed during search: ${model} -> ${embedded.model}`,
      )
    }

    const matches = rows(
      await db.query(
        `SELECT
           id,
           target_type,
           target_key,
           text,
           embedding_model,
           vector::distance::knn() AS distance
         FROM semantic_doc
         WHERE embedding_model = $embedding_model
           AND embedding <|8,100|> $embedding
         ORDER BY distance ASC
         LIMIT 8`,
        {
          embedding: embedded.vector,
          embedding_model: embedded.model,
        },
      ),
    )

    return matches.map(match => ({
      id: idString(match.id),
      targetType: match.target_type,
      targetKey: match.target_key,
      text: match.text,
      embeddingModel: match.embedding_model,
      distance: Number(match.distance),
    }))
  }

  return {
    reindexAll,
    indexEntity,
    ensureCurrentIndex,
    search,
  }
}

function normalizeFactIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(String).sort()
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}
