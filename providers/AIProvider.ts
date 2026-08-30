export interface ModelInfo {
  name: string
  provider: string
  supportsStreaming: boolean
  contextLength: number
}

export interface ProviderStats {
  provider: string
  model: string
  totalRequests: number
  totalTokens: number
  errors: string[]
  lastRequestTime: number | null
  averageLatency: number
  successRate: number
  keyCount?: number
}

export interface ChatOptions {
  messages: { id: string; role: string; content: string; timestamp: number }[]
  systemPrompt: string
  memories?: string
  projectContext?: string
  maxTokens?: number
  tools?: Array<{ name: string; description: string; parameters: any }>
  signal?: AbortSignal
}

export interface HealthCheckResult {
  ok: boolean
  latency: number
  error?: string
}

export interface AIProvider {
  readonly name: string
  chat(options: ChatOptions): Promise<string>
  healthCheck(): Promise<HealthCheckResult>
  getModelInfo(): Promise<ModelInfo>
  getStats(): ProviderStats
  setModel?(modelName: string): void
  getModel(): string
  getFallbackModels(): string[]
  listModels(): Promise<{ id: string; displayName?: string; description?: string }[] | string[]>
}

export type ProviderName = 'gemini'
