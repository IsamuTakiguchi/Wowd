/**
 * 新規作成用の空テンプレート .docx を生成する。
 *
 * 「新規作成」を「テンプレートを開いて本文を空にする」として実装するため、
 * 新規文書でも Word が納得するパッケージ骨格 (theme / styles / settings / fontTable) を
 * 最初から備えられる。ゼロから XML を組み立てるより遥かに安全。
 *
 * 本来は実物の Word で作った雛形を置くのが望ましい。ここでは docx@9.7.1 で代用する。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document, Packer, Paragraph, convertMillimetersToTwip } from 'docx'

const OUT_DIR = join(process.cwd(), 'resources', 'templates')

interface TemplateSpec {
  file: string
  widthMm: number
  heightMm: number
  marginMm: { top: number; bottom: number; left: number; right: number }
  /** 日本語既定フォント */
  eastAsia: string
  ascii: string
  /** 既定フォントサイズ (half-point)。21 = 10.5pt が日本語 Word の既定 */
  sizeHalfPt: number
  /** 文字数と行数グリッド。linePitch は twip */
  docGrid?: { linePitch: number; charSpace: number }
}

const SPECS: TemplateSpec[] = [
  {
    file: 'blank-a4.docx',
    widthMm: 210,
    heightMm: 297,
    marginMm: { top: 25.4, bottom: 25.4, left: 25.4, right: 25.4 },
    eastAsia: '游明朝',
    ascii: 'Century',
    sizeHalfPt: 21
  },
  {
    file: 'blank-ja-b5.docx',
    widthMm: 182,
    heightMm: 257,
    marginMm: { top: 25.4, bottom: 25.4, left: 30, right: 30 },
    eastAsia: 'ＭＳ 明朝',
    ascii: 'Century',
    sizeHalfPt: 21,
    // 40 字 × 36 行相当。linePitch は 1 行あたりの送り (twip)
    docGrid: { linePitch: 360, charSpace: 0 }
  }
]

function build(spec: TemplateSpec): Document {
  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: spec.ascii, eastAsia: spec.eastAsia, hAnsi: spec.ascii },
            size: spec.sizeHalfPt
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(spec.widthMm),
              height: convertMillimetersToTwip(spec.heightMm)
            },
            margin: {
              top: convertMillimetersToTwip(spec.marginMm.top),
              bottom: convertMillimetersToTwip(spec.marginMm.bottom),
              left: convertMillimetersToTwip(spec.marginMm.left),
              right: convertMillimetersToTwip(spec.marginMm.right)
            },
            ...(spec.docGrid
              ? { textDirection: undefined, grid: { linePitch: spec.docGrid.linePitch } }
              : {})
          }
        },
        children: [new Paragraph({ children: [] })]
      }
    ]
  })
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  for (const spec of SPECS) {
    const buf = await Packer.toBuffer(build(spec))
    await writeFile(join(OUT_DIR, spec.file), buf)
    console.log(`  ${spec.file}  (${buf.length} bytes)`)
  }
}

void main()
