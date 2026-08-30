export async function generateZIP(
  name: string,
  files: Array<{ filename: string; content: string | Buffer }>
): Promise<Buffer> {
  const archiverModule = await import('archiver')
  const archiver = archiverModule.default || archiverModule

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks: Buffer[] = []

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)

    for (const file of files) {
      archive.append(file.content, { name: file.filename })
    }

    archive.finalize()
  })
}
