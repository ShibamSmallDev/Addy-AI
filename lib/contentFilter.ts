const MAX_RAW_CHARS = 4000

export async function filterContentForCloud(
  content: string,
  _query: string
): Promise<string> {
  if (content.length <= MAX_RAW_CHARS) return content
  return content.slice(0, MAX_RAW_CHARS)
}
