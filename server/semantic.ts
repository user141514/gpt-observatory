import { createHash } from 'node:crypto'
import { RecordId } from 'surrealdb'
import type { ObservatoryDb } from './db.js'
import { EMBEDDING_MODEL, embed } from './embedding.js'
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
  async function reindexAll(): Promise<{ indexed: number }> {
    const entities = await store.currentEntities()
    let indexed = 0
    for (const entity of entities) {
      await indexEntity(entity.id)
      indexed += 1
    }
    return { indexed }
  }

  async function indexEntity(entityId: string): Promise<void> {
    const state = await store.currentStateText(entityId)
    if (!state) return

    const vector = await embed(state.text)
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
        embedding: vector,
        source_fact_ids: state.factIds,
        embedding_model: EMBEDDING_MODEL,
        now,
      },
    )
  }

  async function search(query: string): Promise<Array<Record<string, unknown>>> {
    const vector = await embed(query)
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
         WHERE embedding <|8,100|> $embedding
         ORDER BY distance ASC
         LIMIT 8`,
        { embedding: vector },
      ),
    )

    return matches.map((match) => ({
      id: idString(match.id),
      targetType: match.target_type,
      targetKey: match.target_key,
      text: match.text,
      embeddingModel: match.embedding_model,
      distance: Number(match.distance),
    }))
  }

  return { reindexAll, indexEntity, search }
}
