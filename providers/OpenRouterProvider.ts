import { type AIProvider, type ChatOptions, type HealthCheckResult, type ModelInfo, type ProviderStats } from './AIProvider'

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'google/gemini-2.5-flash'
const FALLBACK_MODELS = ['google/gemini-2.5-flash', 'openai/gpt-4o-mini']

export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter'
  private modelName: string
  private totalRequests = 0
  private totalTokens = 0
  private lastRequestTime: number | null = null
  private errors: string[] = []
  private latencies: number[] = []
  private totalFailures = 0

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
    return [...FALLBACK_MODELS]
  }

  private getApiKey(): string {
    return process.env.ADDY_OPENROUTER_API_KEY || process.env.ADJ_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || ''
  }

  private async request(
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string,
    maxTokens = 4096,
    signal?: AbortSignal
  ): Promise<string> {
    const apiKey = this.getApiKey()
    if (!apiKey) throw new Error('OpenRouter API key not configured')

    const body: any = {
      model: this.modelName,
      max_tokens: maxTokens,
      messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages,
    }

    const start = Date.now()
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://addy-ai.app',
        'X-Title': 'Addy AI Assistant',
      },
      body: JSON.stringify(body),
      signal,
    })

    const latency = Date.now() - start
    this.latencies.push(latency)
    if (this.latencies.length > 100) this.latencies.shift()

    if (!response.ok) {
      this.totalFailures++
      const errText = await response.text().catch(() => 'Unknown error')
      this.errors.push('[OpenRouter] HTTP ' + response.status + ': ' + errText.slice(0, 200))
      throw new Error('OpenRouter HTTP ' + response.status + ': ' + errText.slice(0, 200))
    }

    const data: any = await response.json()
    this.totalRequests++
    this.lastRequestTime = Date.now()

    if (data.usage?.total_tokens) {
      this.totalTokens += data.usage.total_tokens
    }

    return data.choices?.[0]?.message?.content || ''
  }

  async chat(options: ChatOptions): Promise<string> {
    const systemPrompt = options.systemPrompt + (options.memories ? '\n\n' + options.memories : '')
    const msgs = options.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: m.content,
    }))
    return this.request(msgs, systemPrompt, options.maxTokens || 4096, options.signal)
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await this.request([{ role: 'user', content: 'ok' }], undefined, 10)
      return { ok: true, latency: Date.now() - start }
    } catch (e: any) {
      return { ok: false, latency: Date.now() - start, error: e.message }
    }
  }

  async getModelInfo(): Promise<ModelInfo> {
    return { name: this.modelName, provider: 'openrouter', supportsStreaming: true, contextLength: 128000 }
  }

  async listModels(): Promise<string[]> {
    const apiKey = this.getApiKey()
    if (!apiKey) return []
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models')
      if (!response.ok) return []
      const data: any = await response.json()
      return (data.data || []).map((m: any) => m.id)
    } catch {
      return []
    }
  }

  getStats(): ProviderStats {
    const count = this.latencies.length
    const avgLat = count > 0 ? Math.round(this.latencies.reduce((a, b) => a + b, 0) / count) : 0
    const total = this.totalRequests + this.totalFailures
    return {
      provider: 'openrouter',
      model: this.modelName,
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens,
      errors: this.errors.slice(-10),
      lastRequestTime: this.lastRequestTime,
      averageLatency: avgLat,
      successRate: total > 0 ? Math.round((this.totalRequests / total) * 100) : 100,
    }
  }
}
