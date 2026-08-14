import { zipSync } from 'fflate'

export function makeMinimalPdf(pages: string[]): Uint8Array {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ]
  for (let index = 0; index < pages.length; index++) {
    const pageObject = 3 + index * 2
    const contentObject = pageObject + 1
    const escaped = pages[index]!.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> /Contents ${contentObject} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  let output = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(output.length)
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = output.length
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index++) output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

export function encryptedPdfFixture(): Uint8Array {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Encrypt 5 0 R >>\nendobj\n%%EOF\n')
}

export function makeDocx(input: { paragraphs: string[]; table: string[][] }): Uint8Array {
  const paragraphs = input.paragraphs.map(text => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`).join('')
  const table = input.table.length === 0 ? '' : `<w:tbl>${input.table.map(row => `<w:tr>${row.map(cell => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
  return zipSync({
    '[Content_Types].xml': Buffer.from('<Types/>'),
    'word/document.xml': Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}${table}</w:body></w:document>`),
  })
}

export function makeXlsx(sheets: Record<string, unknown[][]>): Uint8Array {
  const names = Object.keys(sheets)
  const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': Buffer.from('<Types/>'),
    'xl/workbook.xml': Buffer.from(workbook),
    'xl/_rels/workbook.xml.rels': Buffer.from(`<Relationships>${names.map((_, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`),
  }
  names.forEach((name, index) => {
    const rows = sheets[name]!.map(row => `<row>${row.map(value => `<c t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`).join('')}</row>`).join('')
    entries[`xl/worksheets/sheet${index + 1}.xml`] = Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`)
  })
  return zipSync(entries)
}

export function makePptx(slides: { title: string; body: string; notes: string }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': Buffer.from('<Types/>'),
    'ppt/presentation.xml': Buffer.from(`<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`),
  }
  slides.forEach((slide, index) => {
    entries[`ppt/slides/slide${index + 1}.xml`] = Buffer.from(`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><a:t xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${escapeXml(slide.title)} ${escapeXml(slide.body)}</a:t></p:spTree></p:cSld></p:sld>`)
    entries[`ppt/notesSlides/notesSlide${index + 1}.xml`] = Buffer.from(`<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:t xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${escapeXml(slide.notes)}</a:t></p:notes>`)
  })
  return zipSync(entries)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
