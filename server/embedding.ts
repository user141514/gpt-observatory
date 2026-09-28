import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

export const EMBEDDING_DIMENSION = 384
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined

export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor()
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  })
  return Array.from(output.data as Float32Array)
}

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline('feature-extraction', EMBEDDING_MODEL, {
    dtype: 'fp32',
  }) as Promise<FeatureExtractionPipeline>
  return extractorPromise
}
