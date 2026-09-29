import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { z } from 'zod'
import { createDatabase } from './db.js'
import {
  ObservationAuthorityError,
  observeExternalWithSemanticProjection,
} from './observe-service.js'
import { createSemanticIndex } from './semantic.js'
import { createStore } from './store.js'
import {
  createWatchdogBridge,
  WatchdogRequestError,
} from './watchdog.js'

const app = express()
app.use(express.json({ limit: '2mb' }))

const db = await createDatabase()
const store = createStore(db)
const semantic = createSemanticIndex(db, store)
const watchdog = createWatchdogBridge(store)

const sourceSchema = z.object({
  key: z.string().min(1),
  type: z.string().min(1),
  authorityScope: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const entitySchema = z.object({
  stableKey: z.string().min(1),
  type: z.string().min(1),
  label: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const observeSchema = z.object({
  source: sourceSchema,
  entity: entitySchema,
  observedAt: z.string().datetime().optional(),
  coverage: z.array(z.string()).min(1),
  facts: z.record(z.string(), z.unknown()),
  rawPayload: z.unknown().optional(),
  status: z.enum(['ok', 'partial', 'error']).optional(),
})

const promptUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  stepIndex: z.number().int().nonnegative(),
  stepPrompt: z.string().max(12000).nullable().optional(),
  updatedBy: z.string().min(1).max(128).optional(),
})

const relationSchema = z.object({
  source: sourceSchema,
  from: entitySchema,
  predicate: z.string().min(1),
  to: entitySchema,
  observedAt: z.string().datetime().optional(),
  rawPayload: z.unknown().optional(),
})

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'gpt-observatory',
    apiVersion: 1,
    counts: await store.counts(),
  })
})

app.get('/api/now', async (_req, res) => {
  res.json({
    counts: await store.counts(),
    entities: await store.currentEntities(),
  })
})

app.get('/api/timeline', async (_req, res) => {
  res.json({ events: await store.timeline() })
})

app.get('/api/graph', async (_req, res) => {
  res.json(await store.graph())
})

app.get('/api/supervised-tasks', async (_req, res) => {
  res.json(watchdog.current())
})

app.post('/api/watchdog/sync', async (_req, res, next) => {
  try {
    res.json(await watchdog.sync())
  } catch (error) {
    next(error)
  }
})

app.get('/api/supervised-tasks/:taskId/prompt', async (req, res, next) => {
  try {
    res.json(await watchdog.getPrompt(req.params.taskId))
  } catch (error) {
    if (sendWatchdogBoundaryError(res, error)) return
    next(error)
  }
})

app.put('/api/supervised-tasks/:taskId/prompt', async (req, res, next) => {
  try {
    const input = promptUpdateSchema.parse(req.body)
    res.json(await watchdog.updatePrompt({
      taskId: req.params.taskId,
      expectedVersion: input.expectedVersion,
      stepIndex: input.stepIndex,
      stepPrompt: input.stepPrompt,
      updatedBy: input.updatedBy,
    }))
  } catch (error) {
    if (sendWatchdogBoundaryError(res, error)) return
    next(error)
  }
})

app.get('/api/search', async (req, res, next) => {
  try {
    const query = z.string().min(1).parse(req.query.q)
    res.json({ query, results: await semantic.search(query) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/observe', async (req, res, next) => {
  try {
    const input = observeSchema.parse(req.body)
    const result = await observeExternalWithSemanticProjection(
      store,
      semantic,
      input,
      error => {
        console.error(
          'Semantic projection failed after canonical observation was accepted.',
          error,
        )
      },
    )
    res.status(201).json(result)
  } catch (error) {
    next(error)
  }
})

app.post('/api/relations', async (req, res, next) => {
  try {
    const input = relationSchema.parse(req.body)
    const result = await store.setRelation(input)
    res.status(201).json(result)
  } catch (error) {
    next(error)
  }
})

app.post('/api/semantic/reindex', async (_req, res, next) => {
  try {
    res.json(await semantic.reindexAll())
  } catch (error) {
    next(error)
  }
})

const moduleDir = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(moduleDir, '../dist')
const indexFile = join(distDir, 'index.html')

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

if (existsSync(indexFile)) {
  app.use(express.static(distDir, {
    index: false,
    immutable: false,
    maxAge: '1h',
  }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile(indexFile)
  })
}

function sendWatchdogBoundaryError(
  res: express.Response,
  error: unknown,
): boolean {
  if (!(error instanceof WatchdogRequestError)) return false

  const body =
    error.body && typeof error.body === 'object'
      ? error.body
      : {
          error: 'watchdog_request_failed',
          message: String(error.body ?? error.message),
        }
  res.status(error.status).json(body)
  return true
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error)
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'invalid_request', details: error.issues })
    return
  }
  if (error instanceof ObservationAuthorityError) {
    res.status(400).json({
      error: 'reserved_fact_authority',
      message: error.message,
      attributes: error.attributes,
    })
    return
  }
  res.status(500).json({
    error: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
  })
})

const port = Number(process.env.OBSERVATORY_PORT ?? 4317)
const watchdogSyncSeconds = Math.max(
  15,
  Number(process.env.WATCHDOG_SYNC_SECONDS ?? 60),
)

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`GPT Observatory API listening on http://127.0.0.1:${port}`)
})

void watchdog.sync()

const watchdogTimer = setInterval(() => {
  void watchdog.sync()
}, watchdogSyncSeconds * 1000)
watchdogTimer.unref()

async function shutdown() {
  clearInterval(watchdogTimer)
  server.close()
  await db.close()
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
