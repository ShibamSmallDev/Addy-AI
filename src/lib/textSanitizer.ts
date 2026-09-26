/**
 * Text Sanitizer & Tool Call Leakage Filter
 *
 * Strips out leaked raw function calls, JSON payloads, XML/HTML tool tags,
 * and pseudo-call artifacts from model transcripts before they can render
 * onto the main avatar caption screen or in chat logs.
 */

export function filterToolCallLeakage(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove XML/HTML style tool tags (<tool_call>...</tool_call>, <function_call>...</function_call>, <thought>...</thought>, etc.)
  cleaned = cleaned.replace(/<(tool_call|function_call|thought|action|invoke)[\s\S]*?<\/\1>/gi, "");
  cleaned = cleaned.replace(/<(tool_call|function_call|thought|action|invoke)[\s\S]*?$/gi, "");

  // 2. Remove fenced code blocks that contain tool calls or JSON execution payloads
  cleaned = cleaned.replace(/```(?:json)?\s*\{[\s\S]*?"(?:name|action|tool|function|call)"[\s\S]*?\}\s*```/gi, "");

  // 3. Remove raw inline JSON function call blocks: {"name": "...", "args": {...}} or {"functionCall": {...}}
  cleaned = cleaned.replace(/\{[^{}]*"name"\s*:\s*"(?:desktopBrowser|mouse|type|inject|press|open|close|switch|create|read|delete|save|change|volume|brightness|system|social|youtube|cron|execution)[a-zA-Z0-9_]*"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, "");
  cleaned = cleaned.replace(/\{[^{}]*"functionCall"\s*:\s*\{[^{}]*\}[^{}]*\}/gi, "");

  // 4. Remove pseudo-function call syntax: call:toolName{...} or toolName({...})
  cleaned = cleaned.replace(/(?:call:)?(?:desktopBrowser[A-Za-z0-9_]*|mouse[A-Za-z0-9_]*|typeText|injectText|pressKey[A-Za-z0-9_]*|openApplication|closeApplication|switchApplication|locateElement|analyzeScreenshot|saveCustomMemory|changeBackground|social[A-Za-z0-9_]*|youtubeSearch)\s*\([^)]*\)/gi, "");
  cleaned = cleaned.replace(/(?:call:)(?:desktopBrowser[A-Za-z0-9_]*|mouse[A-Za-z0-9_]*|typeText|injectText|pressKey[A-Za-z0-9_]*|openApplication|closeApplication|switchApplication|locateElement|analyzeScreenshot|saveCustomMemory|changeBackground|social[A-Za-z0-9_]*|youtubeSearch)\s*\{[^}]*\}/gi, "");

  // 5. Remove system log prefixes like "[Function Call]: ...", "[Action: ...]", "[Tool: ...]"
  cleaned = cleaned.replace(/\[(?:Function Call|Tool Call|Action|Executed|Desktop Agent|Tool|System)\s*:[^\]]*\]/gi, "");

  // 6. Strip Unicode emojis, pictographs, and roleplay asterisks
  cleaned = stripEmojisAndAsterisks(cleaned);

  if (!cleaned.trim()) return "";

  const leadingSpace = /^\s/.test(text);
  const trailingSpace = /\s$/.test(text);

  return (leadingSpace ? " " : "") + cleaned.trim() + (trailingSpace ? " " : "");
}

/**
 * Strips Unicode emojis, symbols, and roleplay asterisk actions (*giggles*, etc.)
 * to prevent audio synthesizers from pronouncing them or cluttering transcripts.
 */
export function stripEmojisAndAsterisks(text: string): string {
  if (!text) return "";
  // Unicode regex covering emojis, variation selectors, pictographs
  let cleaned = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, "");
  // Strip roleplay asterisk actions e.g. *smiles warmly*, *laughs*
  cleaned = cleaned.replace(/\*[^*]+\*/g, "");
  // Collapse whitespace
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  return cleaned;
}
