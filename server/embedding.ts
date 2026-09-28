import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers'

export const EMBEDDING_DIMENSION = 384
export const TRANSFORMER_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const TRANSFORMER_EMBEDDING_DTYPE = 'q8'
export const TRANSFORMER_EMBEDDING_REVISION =
  '751bff37182d3f1213fa05d7196b954e230abad9'
export const FALLBACK_EMBEDDING_MODEL = 'observatory/local-hash-384-v1'

export interface EmbeddingResult {
  vector: number[]
  model: string
}

interface EmbeddingBackend {
  model: string
  embed(text: string): Promise<number[]>
}

let backendPromise: Promise<EmbeddingBackend> | undefined

export async function embed(text: string): Promise<EmbeddingResult> {
  const backend = await getBackend()
  return {
    vector: await backend.embed(text),
    model: backend.model,
  }
}

export async function embeddingModel(): Promise<string> {
  return (await getBackend()).model
}

async function getBackend(): Promise<EmbeddingBackend> {
  backendPromise ??= createBackend()
  return backendPromise
}

async function createBackend(): Promise<EmbeddingBackend> {
  const home = observatoryHome()
  const modelsRoot = join(home, 'models')
  const cacheRoot = join(home, 'cache', 'transformers')
  const modelRoot = join(modelsRoot, 'Xenova', 'all-MiniLM-L6-v2')

  mkdirSync(modelsRoot, { recursive: true })
  mkdirSync(cacheRoot, { recursive: true })

  // Production must never depend on an implicit network fetch.
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = modelsRoot
  env.cacheDir = cacheRoot

  if (existsSync(modelRoot)) {
    try {
      const extractor = await pipeline(
        'feature-extraction',
        TRANSFORMER_EMBEDDING_MODEL,
        {
          dtype: TRANSFORMER_EMBEDDING_DTYPE,
          local_files_only: true,
        },
      ) as FeatureExtractionPipeline

      return {
        model: `${TRANSFORMER_EMBEDDING_MODEL}@${TRANSFORMER_EMBEDDING_REVISION}#${TRANSFORMER_EMBEDDING_DTYPE}`,
        async embed(text: string) {
          const output = await extractor(text, {
            pooling: 'mean',
            normalize: true,
          })
          return Array.from(output.data as Float32Array)
        },
      }
    } catch (error) {
      console.warn(
        `Local MiniLM model was present but could not be loaded; falling back to ${FALLBACK_EMBEDDING_MODEL}: ${errorMessage(error)}`,
      )
    }
  }

  return {
    model: FALLBACK_EMBEDDING_MODEL,
    async embed(text: string) {
      return hashEmbedding(text)
    },
  }
}

function hashEmbedding(text: string): number[] {
  const vector = new Float64Array(EMBEDDING_DIMENSION)
  const normalizedText = text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()

  if (!normalizedText) return Array.from(vector)

  const wordTokens = normalizedText.match(/[\p{L}\p{N}_-]+/gu) ?? []
  for (const token of wordTokens) {
    addFeature(vector, `w:${token}`, 1)
  }

  const compact = Array.from(normalizedText.replace(/\s+/gu, ''))
  for (let index = 0; index < compact.length; index += 1) {
    addFeature(vector, `c1:${compact[index]}`, 0.18)
    if (index + 1 < compact.length) {
      addFeature(vector, `c2:${compact[index]}${compact[index + 1]}`, 0.42)
    }
    if (index + 2 < compact.length) {
      addFeature(
        vector,
        `c3:${compact[index]}${compact[index + 1]}${compact[index + 2]}`,
        0.24,
      )
    }
  }

  let norm = 0
  for (const item of vector) norm += item * item
  norm = Math.sqrt(norm)

  if (!norm) return Array.from(vector)
  return Array.from(vector, value => value / norm)
}

function addFeature(vector: Float64Array, feature: string, weight: number) {
  const digest = createHash('sha256').update(feature).digest()
  const index = digest.readUInt32LE(0) % EMBEDDING_DIMENSION
  const sign = digest[4] % 2 === 0 ? 1 : -1
  vector[index] += weight * sign
}

function observatoryHome() {
  if (process.env.GPT_OBSERVATORY_HOME) {
    return resolve(process.env.GPT_OBSERVATORY_HOME)
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return resolve(process.env.LOCALAPPDATA, 'GPTObservatory')
  }
  if (process.env.XDG_DATA_HOME) {
    return resolve(process.env.XDG_DATA_HOME, 'gpt-observatory')
  }
  return resolve(homedir(), '.local', 'share', 'gpt-observatory')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
