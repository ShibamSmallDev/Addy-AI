import { type AIProvider, type ChatOptions, type HealthCheckResult, type ProviderStats, type ProviderName } from './AIProvider'
import { GeminiProvider } from './GeminiProvider'
import { getSetting, setSetting } from '../database'
import { isCapacityError } from '../server_paths'

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
    // Restore each registered provider's saved model choice so a model picked in
    // Settings survives a restart (previously only the provider NAME persisted).
    for (const [name, provider] of this.providers) {
      try {
        const model = getSetting(MODEL_SETTING_PREFIX + name) as string | null
        if (model) provider.setModel?.(model)
      } catch {}
    }
  }

  /** Set a provider's model and persist it across restarts. */
  setProviderModel(name: ProviderName, model: string): boolean {
    const provider = this.providers.get(name)
    if (!provider || !model) return false
    provider.setModel?.(model)
    try { setSetting(MODEL_SETTING_PREFIX + name, model) } catch {}
    console.log('[ProviderManager] Model for ' + name + ': ' + model)
    return true
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

    try {
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
          return result
        } catch (e: any) {
          lastError.push(e)
          console.log('[ProviderManager] Model ' + modelName + ' failed: ' + e.message.slice(0, 100))
          // Upstream capacity problems are not model-specific. Walking the whole
          // chain just multiplies the user's wait by 5, so stop immediately.
          if (isCapacityError(e)) {
            console.warn('[ProviderManager] Capacity error - aborting model fallback chain.')
            break
          }
        }
      }
    } finally {
      // Restore user's configured model so transient errors do not permanently demote selection
      if (execProv.getModel() !== originalModel) {
        execProv.setModel?.(originalModel)
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
