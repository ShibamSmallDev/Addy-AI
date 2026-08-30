export interface ArtifactSection {
  heading: string
  content: string
}

export interface ArtifactSpec {
  type: string
  filename: string
  title: string
  sections: ArtifactSection[]
}

const NOISE_WORDS = /\b(?:file|document|report|sheet|spreadsheet|presentation|slide|slides|archive|zip|pdf|docx?|xlsx?|pptx?)\b/gi
const CONTENT_DELIMITERS = /\b(?:containing|with|about|that\s+contains|that\s+has|featuring|titled|called|named|entitled)\b/i

function generateCodeSamples(languages: string[]): ArtifactSection[] {
  const SAMPLES: Record<string, { heading: string; code: string }> = {
    java: { heading: 'Java', code: 'public class HelloWorld {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}' },
    python: { heading: 'Python', code: 'def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))' },
    javascript: { heading: 'JavaScript', code: 'function greet(name) {\n    return `Hello, ${name}!`;\n}\n\nconsole.log(greet("World"));' },
    c: { heading: 'C', code: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}' },
    'c++': { heading: 'C++', code: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}' },
    go: { heading: 'Go', code: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}' },
    rust: { heading: 'Rust', code: 'fn main() {\n    println!("Hello, World!");\n}' },
    typescript: { heading: 'TypeScript', code: 'function greet(name: string): string {\n    return `Hello, ${name}!`;\n}\n\nconsole.log(greet("World"));' },
    swift: { heading: 'Swift', code: 'func greet(name: String) -> String {\n    return "Hello, \\(name)!"\n}\n\nprint(greet(name: "World"))' },
    kotlin: { heading: 'Kotlin', code: 'fun greet(name: String): String {\n    return "Hello, $name!"\n}\n\nfun main() {\n    println(greet("World"))\n}' },
  }
  return languages
    .map(lang => lang.toLowerCase().trim())
    .filter(lang => SAMPLES[lang])
    .map(lang => ({ heading: SAMPLES[lang]!.heading, content: SAMPLES[lang]!.code }))
}

function detectLanguages(text: string): string[] {
  const known = ['java', 'python', 'javascript', 'typescript', 'c\\+\\+', '\\bc\\b', 'go', 'rust', 'swift', 'kotlin', 'ruby', 'php', 'html', 'css']
  const found = known.filter(lang => new RegExp('\\b' + lang + '\\b', 'i').test(text))
  return found.map(l => l.replace(/\\+/, '+'))
}

const ALL_LANGUAGES = ['Java', 'Python', 'JavaScript', 'C', 'C++', 'TypeScript', 'Go', 'Rust', 'Swift', 'Kotlin']

function isCodeRequest(text: string): boolean {
  const patterns = [
    /\b(?:code|program|script|function|algorithm|implementation)\b/i,
    /\b(?:all\s+languages|multiple\s+languages|various\s+languages)\b/i,
  ]
  return patterns.some(p => p.test(text))
}

function expandContent(contentDesc: string): ArtifactSection[] {
  const lower = contentDesc.toLowerCase().trim()

  if (/code\s+from\s+all\s+languages|code\sin\s+(?:all|multiple|various)\s+languages|all\s+programming\s+languages/i.test(lower)) {
    return generateCodeSamples(ALL_LANGUAGES)
  }

  if (isCodeRequest(lower)) {
    const detected = detectLanguages(lower)
    const langs = detected.length > 0 ? detected : ALL_LANGUAGES.slice(0, 3)
    return generateCodeSamples(langs)
  }

  return []
}

export function planArtifact(type: string, description: string): ArtifactSpec {
  const remaining = description.trim()

  let titlePart = remaining
  let contentDesc = remaining
  const delimiterMatch = remaining.match(CONTENT_DELIMITERS)
  if (delimiterMatch) {
    titlePart = remaining.slice(0, delimiterMatch.index).trim()
    contentDesc = remaining.slice(delimiterMatch.index! + delimiterMatch[0].length).trim()
  }

  let filename = titlePart.replace(NOISE_WORDS, '').replace(/\s+/g, ' ').trim()
  if (!filename || filename.length < 2) {
    filename = 'generated_' + type
  }

  const sections = expandContent(contentDesc)

  return { type, filename, title: titlePart || filename, sections }
}
