import { env, pipeline } from '@xenova/transformers'

env.localModelPath = './models/'
env.allowRemoteModels = true
env.allowLocalModels = false

let embedPipeline: any = null
const MODEL = 'Xenova/all-MiniLM-L6-v2'

async function getPipeline(): Promise<any> {
  if (!embedPipeline) {
    embedPipeline = await pipeline('feature-extraction', MODEL, {
      quantized: true,
    })
  }
  return embedPipeline
}

interface QueueItem {
  text: string
  resolve: (vec: number[]) => void
  reject: (err: any) => void
}

let batchQueue: QueueItem[] = []
let batchTimer: NodeJS.Timeout | null = null

async function processBatch() {
  if (batchQueue.length === 0) return
  const currentBatch = batchQueue
  batchQueue = []
  batchTimer = null

  try {
    const pipe = await getPipeline()
    const texts = currentBatch.map(item => item.text)
    
    // Feature extraction on string array
    const results = await pipe(texts, { pooling: 'mean', normalize: true })
    
    // Extract 384-dim vector slice per item
    const dim = 384
    const rawData = Array.from(results.data) as number[]

    currentBatch.forEach((item, index) => {
      const start = index * dim
      const slice = rawData.slice(start, start + dim)
      item.resolve(slice.length === dim ? slice : [])
    })
  } catch (err) {
    console.error('[Embeddings] Batch execution failed, falling back to individual:', err)
    for (const item of currentBatch) {
      try {
        const pipe = await getPipeline()
        const res = await pipe(item.text, { pooling: 'mean', normalize: true })
        item.resolve(Array.from(res.data) as number[])
      } catch (e) {
        item.resolve([])
      }
    }
  }
}

export async function computeEmbedding(text: string): Promise<number[]> {
  if (!text || !text.trim()) return []
  return new Promise((resolve, reject) => {
    batchQueue.push({ text, resolve, reject })
    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        void processBatch()
      }, 250)
    }
  })
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function embedBuffer(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer)
}

export function bufferToEmbed(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
}
