import { Ollama } from 'ollama'

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
const LOCAL_MODEL = process.env.LOCAL_MODEL || 'gemma3:latest'

let client: Ollama | null = null
let _available: boolean | null = null

function getClient(): Ollama {
  if (!client) {
    client = new Ollama({ host: OLLAMA_HOST })
  }
  return client
}

export async function isLocalAvailable(): Promise<boolean> {
  if (_available !== null) return _available
  try {
    const c = getClient()
    const list = await c.list()
    _available = list.models?.some(m => m.name.startsWith(LOCAL_MODEL.split(':')[0])) ?? false
    if (!_available) {
      console.warn(`[LocalProvider] Model "${LOCAL_MODEL}" not found in Ollama. Available:`, list.models?.map(m => m.name).join(', '))
    }
    return _available
  } catch {
    _available = false
    console.warn('[LocalProvider] Ollama not reachable at', OLLAMA_HOST)
    return false
  }
}

export async function localChat(prompt: string, system?: string): Promise<string> {
  const c = getClient()
  const res = await c.chat({
    model: LOCAL_MODEL,
    messages: [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user', content: prompt },
    ],
    options: { temperature: 0.2, num_predict: 512 },
  })
  return res.message.content
}

export async function localClassify(prompt: string, system: string): Promise<Record<string, unknown> | null> {
  const c = getClient()
  const res = await c.chat({
    model: LOCAL_MODEL,
    messages: [
      { role: 'system', content: system + '\nRespond ONLY with valid JSON. No markdown, no code fences.' },
      { role: 'user', content: prompt },
    ],
    options: { temperature: 0.1, num_predict: 300 },
  })
  const text = res.message.content.trim()
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) return null
  try {
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1))
  } catch {
    return null
  }
}

export async function localSummarize(text: string, query: string, maxWords = 150): Promise<string> {
  const c = getClient()
  const res = await c.chat({
    model: LOCAL_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a content relevance filter. Given a text and a user query, extract only the parts relevant to the query. Return a concise summary in under ${maxWords} words. If nothing is relevant, return "NOT_RELEVANT".`,
      },
      { role: 'user', content: `Query: ${query}\n\nText:\n${text}` },
    ],
    options: { temperature: 0.1, num_predict: 200 },
  })
  return res.message.content.trim()
}
