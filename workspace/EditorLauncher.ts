import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execAsync = promisify(exec)

interface EditorEntry {
  name: string
  command: string
  flag: string
  paths: string[]
}

const KNOWN_EDITORS: EditorEntry[] = [
  {
    name: 'VS Code',
    command: 'code',
    flag: '--goto',
    paths: [
      'LOCALAPPDATA\\Programs\\Microsoft VS Code\\Code.exe',
      'PROGRAMFILES\\Microsoft VS Code\\Code.exe',
      'PROGRAMFILES(X86)\\Microsoft VS Code\\Code.exe',
    ],
  },
  {
    name: 'VS Code Insiders',
    command: 'code-insiders',
    flag: '--goto',
    paths: ['LOCALAPPDATA\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe'],
  },
  {
    name: 'Cursor',
    command: 'cursor',
    flag: '--goto',
    paths: ['LOCALAPPDATA\\Programs\\cursor\\Cursor.exe', 'USERPROFILE\\AppData\\Local\\cursor\\Cursor.exe'],
  },
  {
    name: 'Windsurf',
    command: 'windsurf',
    flag: '--goto',
    paths: [],
  },
  {
    name: 'WebStorm',
    command: 'webstorm',
    flag: '',
    paths: [],
  },
]

function resolveEnvPath(template: string): string {
  const envMap: Record<string, string | undefined> = {
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PROGRAMFILES: process.env.PROGRAMFILES,
    'PROGRAMFILES(X86)': process.env['PROGRAMFILES(X86)'],
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
  }
  let resolved = template
  for (const [key, val] of Object.entries(envMap)) {
    if (val) resolved = resolved.replace(key, val)
  }
  return resolved
}

export interface EditorInfo {
  name: string
  command: string
  available: boolean
  version: string | null
}

export function detectEditors(): EditorInfo[] {
  return KNOWN_EDITORS.map(editor => {
    const resolvedPath = findEditorPath(editor)
    const cmd = resolvedPath || editor.command
    try {
      const { execSync } = require('child_process')
      const output = execSync(cmd + ' --version', { encoding: 'utf-8', timeout: 5000, windowsHide: true })
      return { name: editor.name, command: cmd, available: true, version: output?.split('\n')[0]?.trim() || null }
    } catch {
      return { name: editor.name, command: cmd, available: false, version: null }
    }
  })
}

function findEditorPath(editor: EditorEntry): string | null {
  for (const template of editor.paths) {
    const resolved = resolveEnvPath(template)
    if (resolved && existsSync(resolved)) return resolved
  }
  return null
}

export async function openInEditor(
  editorCommand: string,
  projectPath: string,
  filePath?: string,
  line?: number
): Promise<{ success: boolean; error?: string }> {
  const editor = KNOWN_EDITORS.find(e => e.command === editorCommand || e.name.toLowerCase() === editorCommand.toLowerCase())
  const cmd = editor ? (findEditorPath(editor) || editor.command) : editorCommand

  try {
    if (filePath && line && line > 0) {
      const gotoFlag = editor?.flag || '--goto'
      await execAsync('"' + cmd + '" "' + projectPath + '" ' + gotoFlag + ' "' + filePath + ':' + line + '"')
    } else if (filePath) {
      await execAsync('"' + cmd + '" "' + filePath + '"')
    } else {
      await execAsync('"' + cmd + '" "' + projectPath + '"')
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
