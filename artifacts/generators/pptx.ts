import PptxGenJS from 'pptxgenjs'

export interface PPTXSection {
  heading: string
  content: string
}

export async function generatePPTX(title: string, content: string): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.title = title
  pptx.author = 'Addy AI'

  const slide = pptx.addSlide()
  slide.background = { color: '0F0F1A' }

  slide.addText(title, {
    x: 1, y: 0.5, w: 8, h: 1.2,
    fontSize: 28, color: 'FFFFFF', bold: true, align: 'center',
  })

  const lines = content.split('\n').filter(l => l.trim())
  const bodyLines = lines.slice(0, 15)
  slide.addText(bodyLines.join('\n'), {
    x: 1, y: 2, w: 8, h: 4.5,
    fontSize: 14, color: 'CCCCCC', valign: 'top',
  })

  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  return buffer as Buffer
}

export async function generatePPTXSections(title: string, sections: PPTXSection[]): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.title = title
  pptx.author = 'Addy AI'

  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: '0F0F1A' }
  titleSlide.addText(title, {
    x: 0.5, y: 2, w: 9, h: 1.5,
    fontSize: 32, color: 'FFFFFF', bold: true, align: 'center',
  })
  titleSlide.addText(sections.length + ' sections', {
    x: 0.5, y: 3.8, w: 9, h: 0.8,
    fontSize: 16, color: '888888', align: 'center',
  })

  for (const section of sections) {
    const slide = pptx.addSlide()
    slide.background = { color: '0F0F1A' }
    slide.addText(section.heading, {
      x: 1, y: 0.3, w: 8, h: 0.8,
      fontSize: 22, color: 'FFFFFF', bold: true, align: 'left',
    })
    const lines = section.content.split('\n').filter(l => l.trim() && !l.startsWith('```'))
    const body = lines.slice(0, 12)
    slide.addText(body.join('\n'), {
      x: 1, y: 1.4, w: 8, h: 5,
      fontSize: 13, color: 'CCCCCC', valign: 'top', fontFace: 'Courier New',
    })
  }

  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  return buffer as Buffer
}
