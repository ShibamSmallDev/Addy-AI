import { spawn, execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface DelegationResult {
  agentId: string
  task: string
  success: boolean
  output: string
  filesChanged: string[]
  verificationPassed: boolean | null
  durationMs: number
}

export async function delegateToAgent(
  agentId: string,
  agentCommand: string,
  task: string,
  projectPath: string,
  timeoutMs: number = 300000
): Promise<DelegationResult> {
  const start = Date.now()
  const beforeStatus = safeGitStatus(projectPath)

  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawn(agentCommand, [task], {
      cwd: projectPath,
      shell: true,
      windowsHide: true,
    })
    let out = ''
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        proc.kill()
        reject(new Error('Agent timed out after ' + timeoutMs + 'ms'))
      }
    }, timeoutMs)

    proc.stdout?.on('data', d => { out += d.toString() })
    proc.stderr?.on('data', d => { out += d.toString() })
    proc.on('close', (code) => {
      done = true
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error('Agent exited with code ' + code + ': ' + out.slice(-500)))
    })
    proc.on('error', (err) => {
      done = true
      clearTimeout(timer)
      reject(err)
    })
  }).catch(err => 'ERROR: ' + err.message)

  const afterStatus = safeGitStatus(projectPath)
  const filesChanged = diffChangedFiles(beforeStatus, afterStatus)
  const verificationPassed = attemptVerification(projectPath)

  return {
    agentId,
    task,
    success: !output.startsWith('ERROR:'),
    output,
    filesChanged,
    verificationPassed,
    durationMs: Date.now() - start
  }
}

function safeGitStatus(projectPath: string): string {
  try {
    return execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8', windowsHide: true })
  } catch {
    return ''
  }
}

function diffChangedFiles(before: string, after: string): string[] {
  const beforeSet = new Set(before.split('\n').filter(Boolean))
  return after.split('\n').filter(Boolean).filter(f => !beforeSet.has(f)).map(f => f.slice(3).trim())
}

function attemptVerification(projectPath: string): boolean | null {
  try {
    const pkgPath = path.join(projectPath, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    if (!pkg.scripts?.build) return null
    execSync('npm run build', { cwd: projectPath, timeout: 120000, encoding: 'utf-8', windowsHide: true })
    return true
  } catch {
    return false
  }
}
