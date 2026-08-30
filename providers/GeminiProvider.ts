import { GoogleGenAI } from '@google/genai'
import { type AIProvider, type ChatOptions, type HealthCheckResult, type ModelInfo, type ProviderStats } from './AIProvider'

const DEFAULT_MODEL = 'gemini-3.5-flash'
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite']

export const WORKING_MODELS = FALLBACK_MODELS

export async function generateContentWithFallback(
  ai: GoogleGenAI,
  contents: string | Array<{ role: string; parts: Array<{ text: string }> }>,
  config?: Record<string, unknown>
): Promise<string> {
  let lastError: unknown = null
  for (const model of WORKING_MODELS) {
    try {
      const res = await ai.models.generateContent({ model, contents, config: config as any })
      if (res.text) return res.text
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All Gemini models failed')
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini'
  private modelName: string
  private totalRequests = 0
  private totalTokens = 0
  private lastRequestTime: number | null = null
  private errors: string[] = []
  private latencies: number[] = []

  constructor(modelName?: string) {
    this.modelName = modelName || DEFAULT_MODEL
  }

  setModel(modelName: string) {
    this.modelName = modelName
  }

  getModel(): string {
    return this.modelName
  }

  getFallbackModels(): string[] {
    return FALLBACK_MODELS.filter(m => m !== this.modelName)
  }

  private getApiKey(): string {
    return process.env.ADDY_GEMINI_API_KEY || process.env.ADJ_GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''
  }

  async chat(options: ChatOptions): Promise<string> {
    const apiKey = this.getApiKey()
    if (!apiKey) throw new Error('Gemini API key not configured')

    const ai = new GoogleGenAI({ apiKey })
    const recentMessages = options.messages.slice(-20)

    let systemPrompt = options.systemPrompt
    if (options.memories) systemPrompt += '\n\n' + options.memories

    const history = recentMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user' as const,
      parts: [{ text: m.content }],
    }))

    const lastMessage = recentMessages[recentMessages.length - 1]
    if (!lastMessage) throw new Error('No messages to send')

    const start = Date.now()
    const result = await ai.models.generateContent({
      model: this.modelName,
      contents: lastMessage.content,
      config: {
        systemInstruction: systemPrompt,
      },
    })
    const latency = Date.now() - start
    this.latencies.push(latency)
    if (this.latencies.length > 100) this.latencies.shift()

    this.totalRequests++
    this.lastRequestTime = Date.now()

    return result.text || ''
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const apiKey = this.getApiKey()
    if (!apiKey) return { ok: false, latency: 0, error: 'No API key' }

    const start = Date.now()
    try {
      const ai = new GoogleGenAI({ apiKey })
      await ai.models.generateContent({ model: this.modelName, contents: 'ok' })
      return { ok: true, latency: Date.now() - start }
    } catch (e: any) {
      return { ok: false, latency: Date.now() - start, error: e.message }
    }
  }

  async getModelInfo(): Promise<ModelInfo> {
    return { name: this.modelName, provider: 'gemini', supportsStreaming: true, contextLength: 1000000 }
  }

  getStats(): ProviderStats {
    const count = this.latencies.length
    const avgLat = count > 0 ? Math.round(this.latencies.reduce((a, b) => a + b, 0) / count) : 0
    return {
      provider: 'gemini',
      model: this.modelName,
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens,
      errors: this.errors.slice(-10),
      lastRequestTime: this.lastRequestTime,
      averageLatency: avgLat,
      successRate: this.totalRequests > 0 ? 100 : 100,
    }
  }

  async listModels(): Promise<string[]> {
    const apiKey = this.getApiKey()
    if (!apiKey) return []
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey)
      if (!response.ok) return []
      const data: any = await response.json()
      return (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace('models/', ''))
    } catch {
      return []
    }
  }
}
