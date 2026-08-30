import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export interface ProjectInfo {
  rootPath: string
  name: string
  language: string[]
  framework: string | null
  gitBranch: string | null
  hasUncommittedChanges: boolean
  lastCommitMessage: string | null
  lastCommitDate: string | null
}

export function detectProject(rootPath: string): ProjectInfo {
  const name = path.basename(rootPath)
  const language: string[] = []
  let framework: string | null = null

  if (fs.existsSync(path.join(rootPath, 'package.json'))) {
    language.push('JavaScript/TypeScript')
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps?.electron) framework = 'Electron'
      else if (deps?.next) framework = 'Next.js'
      else if (deps?.react) framework = 'React'
      else if (deps?.vue) framework = 'Vue'
      else if (deps?.express) framework = 'Express'
      else if (deps?.astro) framework = 'Astro'
    } catch {}
  }
  if (fs.existsSync(path.join(rootPath, 'requirements.txt')) ||
      fs.existsSync(path.join(rootPath, 'pyproject.toml'))) {
    language.push('Python')
    if (fs.existsSync(path.join(rootPath, 'pyproject.toml'))) {
      try {
        const content = fs.readFileSync(path.join(rootPath, 'pyproject.toml'), 'utf-8')
        if (content.includes('django')) framework = 'Django'
        else if (content.includes('fastapi')) framework = 'FastAPI'
        else if (content.includes('flask')) framework = 'Flask'
      } catch {}
    }
  }
  if (fs.existsSync(path.join(rootPath, 'Cargo.toml'))) language.push('Rust')
  if (fs.existsSync(path.join(rootPath, 'go.mod'))) language.push('Go')
  if (fs.existsSync(path.join(rootPath, 'Gemfile'))) language.push('Ruby')

  if (language.length === 0) {
    const entries = fs.readdirSync(rootPath)
    if (entries.some(e => e.endsWith('.py'))) language.push('Python')
    if (entries.some(e => e.endsWith('.rs'))) language.push('Rust')
    if (entries.some(e => e.endsWith('.go'))) language.push('Go')
    if (entries.some(e => e.endsWith('.ts') || e.endsWith('.tsx') || e.endsWith('.js'))) language.push('JavaScript/TypeScript')
  }

  let gitBranch: string | null = null
  let hasUncommittedChanges = false
  let lastCommitMessage: string | null = null
  let lastCommitDate: string | null = null

  try {
    gitBranch = execSync('git branch --show-current', { cwd: rootPath, encoding: 'utf-8', windowsHide: true }).trim()
    const status = execSync('git status --porcelain', { cwd: rootPath, encoding: 'utf-8', windowsHide: true })
    hasUncommittedChanges = status.trim().length > 0
    lastCommitMessage = execSync('git log -1 --pretty=%s', { cwd: rootPath, encoding: 'utf-8', windowsHide: true }).trim()
    lastCommitDate = execSync('git log -1 --pretty=%ci', { cwd: rootPath, encoding: 'utf-8', windowsHide: true }).trim()
  } catch {}

  return { rootPath, name, language, framework, gitBranch, hasUncommittedChanges, lastCommitMessage, lastCommitDate }
}

export function findRecentProjects(searchRoots: string[], maxDepth = 2): ProjectInfo[] {
  const found: ProjectInfo[] = []
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(root, entry.name)
      if (fs.existsSync(path.join(fullPath, '.git')) ||
          fs.existsSync(path.join(fullPath, 'package.json')) ||
          fs.existsSync(path.join(fullPath, 'requirements.txt')) ||
          fs.existsSync(path.join(fullPath, 'pyproject.toml')) ||
          fs.existsSync(path.join(fullPath, 'Cargo.toml')) ||
          fs.existsSync(path.join(fullPath, 'go.mod'))) {
        found.push(detectProject(fullPath))
      }
    }
  }
  return found.sort((a, b) => {
    if (!a.lastCommitDate) return 1
    if (!b.lastCommitDate) return -1
    return new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime()
  })
}
