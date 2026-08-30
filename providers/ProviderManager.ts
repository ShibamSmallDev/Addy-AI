import { type AIProvider, type ChatOptions, type HealthCheckResult, type ProviderStats, type ProviderName } from './AIProvider'
import { GeminiProvider } from './GeminiProvider'
import { getSetting, setSetting } from '../database'

const SETTING_KEY = 'adj_active_provider'
const MODEL_SETTING_PREFIX = 'adj_provider_model_'

const FALLBACK_CHAIN: ProviderName[] = ['gemini']

export class ProviderManager {
  private providers: Map<ProviderName, AIProvider> = new Map()
  private executionProvider: ProviderName = 'gemini'
  private initialized = false

  init() {
    if (this.initialized) return
    this.initialized = true
    this.restoreSavedProvider()
  }

  registerProvider(name: ProviderName, provider: AIProvider) {
    this.providers.set(name, provider)
    console.log('[ProviderManager] Registered provider: ' + name)
  }

  private restoreSavedProvider() {
    try {
      const saved = getSetting(SETTING_KEY) as ProviderName | null
      if (saved && this.providers.has(saved)) {
        this.executionProvider = saved
      }
    } catch {}
  }

  getActiveProvider(): AIProvider {
    let provider = this.providers.get(this.executionProvider)
    if (!provider && this.executionProvider === 'gemini') {
      provider = new GeminiProvider()
      this.providers.set('gemini', provider)
    }
    if (!provider) throw new Error('Provider "' + this.executionProvider + '" not found')
    return provider
  }

  getProvider(name: ProviderName): AIProvider | undefined {
    return this.providers.get(name)
  }

  setActiveProvider(name: ProviderName): boolean {
    if (!this.providers.has(name)) return false
    this.executionProvider = name
    try { setSetting(SETTING_KEY, name) } catch {}
    console.log('[ProviderManager] Active provider: ' + name)
    return true
  }

  getExecutionProviderName(): ProviderName {
    return this.executionProvider
  }

  getProviderStats(): Record<string, ProviderStats> {
    const stats: Record<string, ProviderStats> = {}
    for (const [name, provider] of this.providers) {
      stats[name] = provider.getStats()
    }
    return stats
  }

  async chat(
    content: string,
    messages: Array<{ id: string; role: string; content: string; timestamp: number }>,
    systemPrompt: string,
    signal?: AbortSignal
  ): Promise<string> {
    const execProv = this.getActiveProvider()
    const mdlLabel = 'getStats' in execProv
      ? (execProv as any).getStats()?.model || 'default'
      : 'default'
    const originalModel = execProv.getModel()
    console.log('[ProviderManager] Execution: ' + this.executionProvider + ', Model: ' + mdlLabel)

    // Try model-level fallback within Gemini
    const modelChain = [originalModel, ...execProv.getFallbackModels()]
    const lastError: Error[] = []

    for (const modelName of modelChain) {
      try {
        if (modelName !== execProv.getModel()) {
          execProv.setModel?.(modelName)
        }
        const result = await execProv.chat({
          messages: messages as any,
          systemPrompt,
          signal,
        })
        if (execProv.getModel() !== originalModel) {
          try { setSetting(MODEL_SETTING_PREFIX + this.executionProvider, execProv.getModel()) } catch {}
        }
        return result
      } catch (e: any) {
        lastError.push(e)
        console.log('[ProviderManager] Model ' + modelName + ' failed: ' + e.message.slice(0, 100))
      }
    }

    const allMessages = lastError.map((e) => '  ' + this.executionProvider + ': ' + e.message).join('\n')
    throw new Error('AI provider unavailable:\n' + allMessages)
  }

  getAllProviderNames(): ProviderName[] {
    return FALLBACK_CHAIN
  }

  async generateResilientCompletion(prompt: string, systemPrompt = ''): Promise<string> {
    const message = {
      id: 'completion-' + Date.now(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }
    return this.chat(prompt, [message], systemPrompt)
  }
}

export const providerManager = new ProviderManager()
