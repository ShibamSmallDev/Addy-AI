import { initArtifactDir, saveArtifact, getArtifact, listArtifacts, deleteArtifact } from './ArtifactManager'
import type { Artifact } from './ArtifactManager'
import type { ArtifactSpec, ArtifactSection } from './ArtifactPlanner'
export { initArtifactDir, saveArtifact, getArtifact, listArtifacts, deleteArtifact }
export type { Artifact, ArtifactSpec, ArtifactSection }

export async function generateArtifact(
  type: string,
  name: string,
  content: string,
  options?: { rows?: string[][]; files?: Array<{ filename: string; content: string }> }
): Promise<Artifact> {
  let buffer: Buffer

  switch (type) {
    case 'pdf': {
      const { generatePDF } = await import('./generators/pdf')
      buffer = await generatePDF(name, content)
      break
    }
    case 'docx': {
      const { generateDOCX } = await import('./generators/docx')
      buffer = await generateDOCX(name, content)
      break
    }
    case 'xlsx': {
      const { generateXLSX } = await import('./generators/xlsx')
      const rows = options?.rows?.length ? options.rows : [['Item', 'Value'], [name, content]]
      buffer = await generateXLSX(name, rows)
      break
    }
    case 'pptx': {
      const { generatePPTX } = await import('./generators/pptx')
      buffer = await generatePPTX(name, content)
      break
    }
    case 'zip': {
      const { generateZIP } = await import('./generators/zip')
      const files = options?.files?.length ? options.files : [{ filename: name + '.txt', content }]
      buffer = await generateZIP(name, files)
      break
    }
    default:
      throw new Error('Unsupported artifact type: ' + type)
  }

  return saveArtifact(name, type as any, buffer)
}

export async function generateArtifactFromSpec(spec: ArtifactSpec): Promise<Artifact> {
  const { type, filename, title, sections } = spec
  let buffer: Buffer

  if (sections.length > 0) {
    switch (type) {
      case 'pdf': {
        const { generatePDFSections } = await import('./generators/pdf')
        buffer = await generatePDFSections(title, sections)
        break
      }
      case 'docx': {
        const { generateDOCXSections } = await import('./generators/docx')
        buffer = await generateDOCXSections(title, sections)
        break
      }
      case 'pptx': {
        const { generatePPTXSections } = await import('./generators/pptx')
        buffer = await generatePPTXSections(title, sections)
        break
      }
      case 'xlsx': {
        const { generateXLSX } = await import('./generators/xlsx')
        const rows = [['Section', 'Content'], ...sections.map(s => [s.heading, s.content.slice(0, 100)])]
        buffer = await generateXLSX(filename, rows)
        break
      }
      case 'zip': {
        const { generateZIP } = await import('./generators/zip')
        const files = sections.map(s => ({ filename: s.heading.replace(/\s+/g, '_') + '.txt', content: s.content }))
        buffer = await generateZIP(filename, files)
        break
      }
      default:
        throw new Error('Unsupported artifact type: ' + type)
    }
  } else {
    return generateArtifact(type, filename, title)
  }

  return saveArtifact(filename, type as any, buffer)
}
