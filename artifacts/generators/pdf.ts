import PDFDocument from 'pdfkit'

export interface PDFSection {
  heading: string
  content: string
}

export async function generatePDF(title: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, info: { Title: title } })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(24).text(title, { align: 'center' })
    doc.moveDown(2)
    doc.fontSize(11)
    for (const line of content.split('\n')) {
      doc.text(line)
      doc.moveDown(0.3)
    }
    doc.end()
  })
}

export async function generatePDFSections(title: string, sections: PDFSection[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, info: { Title: title } })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(24).text(title, { align: 'center' })
    doc.moveDown(2)

    for (const section of sections) {
      doc.fontSize(16).text(section.heading, { align: 'left' })
      doc.moveDown(0.5)
      doc.fontSize(11)
      for (const line of section.content.split('\n')) {
        if (line.startsWith('```')) continue
        doc.text(line)
        doc.moveDown(0.3)
      }
      doc.moveDown(1)
    }

    doc.end()
  })
}
