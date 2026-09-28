import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Surreal, createRemoteEngines } from 'surrealdb'
import { createNodeEngines } from '@surrealdb/node'
import { SCHEMA } from './schema.js'

export type ObservatoryDb = Surreal

export async function createDatabase(endpoint?: string): Promise<ObservatoryDb> {
  const databaseEndpoint = endpoint ?? process.env.OBSERVATORY_DB_URL ?? defaultDatabaseUrl()

  const db = new Surreal({
    engines: {
      ...createRemoteEngines(),
      ...createNodeEngines(),
    },
  })

  await db.connect(databaseEndpoint, {
    namespace: 'gpt_observatory',
    database: 'main',
  })
  await db.query(SCHEMA)
  return db
}

function defaultDatabaseUrl(): string {
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true })
  return 'rocksdb://./data/observatory'
}
