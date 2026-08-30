import ExcelJS from 'exceljs'

export async function generateXLSX(title: string, rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Addy AI'
  const sheet = workbook.addWorksheet(title.slice(0, 31))

  if (rows.length > 0) {
    const headerRow = sheet.addRow(rows[0])
    headerRow.font = { bold: true }
    for (let i = 1; i < rows.length; i++) {
      sheet.addRow(rows[i])
    }
    sheet.columns.forEach(col => {
      if (col) col.width = 20
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
