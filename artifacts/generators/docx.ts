import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

export interface DOCXSection {
  heading: string
  content: string
}

export async function generateDOCX(title: string, content: string): Promise<Buffer> {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ spacing: { after: 200 } }),
  ]

  for (const line of content.split('\n')) {
    if (line.trim()) {
      paragraphs.push(
        new Paragraph({ children: [new TextRun(line)], spacing: { after: 120 } })
      )
    }
  }

  const doc = new Document({ title, sections: [{ children: paragraphs }] })
  return Packer.toBuffer(doc) as Promise<Buffer>
}

export async function generateDOCXSections(title: string, sections: DOCXSection[]): Promise<Buffer> {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ spacing: { after: 300 } }),
  ]

  for (const section of sections) {
    paragraphs.push(
      new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      })
    )
    for (const line of section.content.split('\n')) {
      if (!line.trim() || line.startsWith('```')) continue
      paragraphs.push(
        new Paragraph({ children: [new TextRun({ text: line, size: 22 })], spacing: { after: 100 } })
      )
    }
    paragraphs.push(new Paragraph({ spacing: { after: 200 } }))
  }

  const doc = new Document({ title, sections: [{ children: paragraphs }] })
  return Packer.toBuffer(doc) as Promise<Buffer>
}
