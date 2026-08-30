import { type AvailableAgent } from './AgentRegistry'
import type { ProviderManager } from '../providers/ProviderManager'

export type TaskCategory = 'multi-file-edit' | 'single-file-edit' | 'reasoning-only' | 'research' | 'unclear'

export interface TaskClassification {
  category: TaskCategory
  suggestedAgent: string | null
  reasoning: string
  confidence: number
}

const CLASSIFY_SYSTEM = 'You are Addy task classifier. Categorize the task as one of: multi-file-edit (needs a coding agent), single-file-edit (Addy can do it), reasoning-only (questions/planning), research (needs web search), or unclear. If it needs a coding agent, pick from the available list. Respond with JSON: {"category":"...", "suggestedAgent": "..." or null, "reasoning":"...", "confidence": 0.0-1.0}'

export async function classifyTask(
  taskDescription: string,
  availableAgents: AvailableAgent[],
  providerManager: ProviderManager
): Promise<TaskClassification> {
  const agentList = availableAgents.filter(a => a.available).map(a => a.name).join(', ')
  const prompt = `Task: "${taskDescription}"\nAvailable coding agents: ${agentList || 'none'}\nRules: multi-file edits needing testing -> delegate. Single small edits, explanations -> Addy handles directly. Pure questions, planning -> never delegate.`

  try {
    const provider = providerManager.getActiveProvider()
    const response = await provider.chat({
      messages: [{
        id: 'classify-' + Date.now(),
        role: 'user',
        content: prompt,
        timestamp: Date.now()
      }],
      systemPrompt: CLASSIFY_SYSTEM,
      maxTokens: 300
    })
    const parsed = JSON.parse(response.trim())
    return {
      category: parsed.category || 'unclear',
      suggestedAgent: parsed.suggestedAgent || null,
      reasoning: parsed.reasoning || '',
      confidence: parsed.confidence || 0,
    }
  } catch {
    return { category: 'unclear', suggestedAgent: null, reasoning: 'Classification failed', confidence: 0 }
  }
}
