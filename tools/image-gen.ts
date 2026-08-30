export interface ImageGenResult {
  success: boolean
  data?: string
  output?: string
  error?: string
}

function getGeminiApiKey(): string {
  return process.env.ADDY_GEMINI_API_KEY || process.env.ADJ_GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''
}

function getOpenAIKey(): string {
  return process.env.ADDY_OPENAI_API_KEY || process.env.ADJ_OPENAI_API_KEY || process.env.OPENAI_API_KEY || ''
}

export async function generateImage(prompt: string): Promise<ImageGenResult> {
  if (!prompt?.trim()) return { success: false, error: 'No prompt provided' }

  const trimmed = prompt.trim().slice(0, 1000)

  // Try Gemini Imagen first
  const geminiKey = getGeminiApiKey()
  if (geminiKey) {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateImages?key=' + geminiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed, sampleCount: 1 }),
        }
      )
      if (res.ok) {
        const data = await res.json() as any
        const imageData = data?.images?.[0]?.imageBytes
        if (imageData) {
          return {
            success: true,
            data: '![Generated Image](data:image/png;base64,' + imageData + ')',
            output: 'Generated image for: "' + trimmed + '"',
          }
        }
      }
    } catch {}
  }

  // Fallback: OpenAI DALL-E 3
  const openaiKey = getOpenAIKey()
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openaiKey,
        },
        body: JSON.stringify({ prompt: trimmed, n: 1, size: '1024x1024', response_format: 'b64_json' }),
      })
      if (res.ok) {
        const data = await res.json() as any
        const b64 = data?.data?.[0]?.b64_json
        if (b64) {
          return {
            success: true,
            data: '![Generated Image](data:image/png;base64,' + b64 + ')',
            output: 'Generated image for: "' + trimmed + '"',
          }
        }
      }
    } catch {}
  }

  return { success: false, error: 'No available AI provider could generate the image' }
}
