import { join } from 'path'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { v4 as uuid } from 'uuid'

export interface Artifact {
  id: string
  name: string
  type: string
  path: string
  size: number
  createdAt: number
}

let artifactsDir = ''
const artifacts = new Map<string, Artifact>()

export function initArtifactDir(dir: string) {
  artifactsDir = dir
}

async function ensureDir(sub: string) {
  if (!artifactsDir) artifactsDir = join(process.cwd(), 'artifacts_output')
  const dir = join(artifactsDir, sub)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  return dir
}

export async function saveArtifact(
  name: string,
  type: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'zip',
  buffer: Buffer
): Promise<Artifact> {
  const id = uuid()
  const subdir = await ensureDir(type)
  const filename = name.endsWith('.' + type) ? name : name + '.' + type
  const filePath = join(subdir, filename)

  await writeFile(filePath, buffer)

  const artifact: Artifact = {
    id,
    name: filename,
    type,
    path: filePath,
    size: buffer.length,
    createdAt: Date.now(),
  }
  artifacts.set(id, artifact)
  return artifact
}

export function getArtifact(id: string): Artifact | undefined {
  return artifacts.get(id)
}

export function listArtifacts(type?: string): Artifact[] {
  const all = Array.from(artifacts.values())
  if (type) return all.filter(a => a.type === type)
  return all
}

export async function deleteArtifact(id: string): Promise<boolean> {
  const artifact = artifacts.get(id)
  if (!artifact) return false
  try {
    await unlink(artifact.path)
  } catch {}
  artifacts.delete(id)
  return true
}
