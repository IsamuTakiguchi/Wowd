/**
 * テスト用 .docx フィクスチャを生成する。
 *
 * この環境には Microsoft Word が無いため、Phase 0〜4 の範囲は docx@9.7.1 が生成する
 * 既知良品の OOXML をフィクスチャとして使う。
 *
 * ただしこれは「自分で書いたものを自分で読む」テストにしかならない点に注意。
 * Word が実際に吐くパート構成 (theme1.xml / fontTable.xml / rsid 付き settings.xml など) の
 * 検証には実物の .docx が要る。tests/fixtures/docx/ に real-*.docx を置けば
 * ラウンドトリップテストが自動的に拾う。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  convertMillimetersToTwip
} from 'docx'

const OUT_DIR = join(process.cwd(), 'tests', 'fixtures', 'docx')

const JA_FONT = { ascii: 'Century', eastAsia: 'ＭＳ 明朝', hAnsi: 'Century' }

async function emit(name: string, doc: Document): Promise<void> {
  const buf = await Packer.toBuffer(doc)
  await writeFile(join(OUT_DIR, name), buf)
  console.log(`  ${name}  (${buf.length} bytes)`)
}

/** 01: 段落とごく基本的な文字装飾だけ */
function plain(): Document {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun('これは最初の段落です。')] }),
          new Paragraph({
            children: [
              new TextRun({ text: '太字', bold: true }),
              new TextRun({ text: 'と' }),
              new TextRun({ text: '斜体', italics: true }),
              new TextRun({ text: 'と' }),
              new TextRun({ text: '下線', underline: {} }),
              new TextRun({ text: 'と' }),
              new TextRun({ text: '取り消し線', strike: true }),
              new TextRun({ text: 'の混在。' })
            ]
          }),
          new Paragraph({ children: [new TextRun('The quick brown fox jumps over the lazy dog.')] })
        ]
      }
    ]
  })
}

/** 02: フォント・サイズ・色・蛍光ペン・上付き下付き */
function formatting(): Document {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: '12pt 明朝 ', font: JA_FONT, size: 24 }),
              new TextRun({ text: '9pt ゴシック ', font: { ...JA_FONT, eastAsia: 'ＭＳ ゴシック' }, size: 18 }),
              new TextRun({ text: '赤字 ', color: 'FF0000' }),
              new TextRun({ text: '蛍光ペン ', highlight: 'yellow' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'x' }),
              new TextRun({ text: '2', superScript: true }),
              new TextRun({ text: ' と H' }),
              new TextRun({ text: '2', subScript: true }),
              new TextRun({ text: 'O' })
            ]
          })
        ]
      }
    ]
  })
}

/** 03: 見出しスタイル・配置・行間・インデント */
function styles(): Document {
  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
            margin: {
              top: convertMillimetersToTwip(25),
              bottom: convertMillimetersToTwip(25),
              left: convertMillimetersToTwip(30),
              right: convertMillimetersToTwip(30)
            }
          }
        },
        children: [
          new Paragraph({ text: '第1章 総則', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: '第1節 目的', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            children: [new TextRun('中央揃えの段落。')],
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({
            children: [new TextRun('右揃えの段落。')],
            alignment: AlignmentType.RIGHT
          }),
          new Paragraph({
            children: [new TextRun('両端揃えでインデントと行間を指定した段落。')],
            alignment: AlignmentType.JUSTIFIED,
            indent: { left: 720, firstLine: 240 },
            spacing: { before: 120, after: 120, line: 360 }
          })
        ]
      }
    ]
  })
}

/** 04: 箇条書きと段落番号 (日本語書式を含む) */
function lists(): Document {
  return new Document({
    numbering: {
      config: [
        {
          reference: 'wowd-numbered',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL_ENCLOSED_CIRCLE,
              text: '%2',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } }
            },
            {
              level: 2,
              format: LevelFormat.AIUEO_FULL_WIDTH,
              text: '%3',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 2160, hanging: 360 } } }
            }
          ]
        },
        {
          reference: 'wowd-bullet',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '●',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }
          ]
        }
      ]
    },
    sections: [
      {
        children: [
          new Paragraph({ text: '番号付きリスト', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: '第一項', numbering: { reference: 'wowd-numbered', level: 0 } }),
          new Paragraph({ text: '第二項', numbering: { reference: 'wowd-numbered', level: 0 } }),
          new Paragraph({ text: '入れ子の項', numbering: { reference: 'wowd-numbered', level: 1 } }),
          new Paragraph({ text: 'さらに深い項', numbering: { reference: 'wowd-numbered', level: 2 } }),
          // レベルを飛ばして戻る並び。実際の Word 文書に頻出し、入れ子ノード方式だと壊れる
          new Paragraph({ text: '第三項', numbering: { reference: 'wowd-numbered', level: 0 } }),
          new Paragraph({ text: '箇条書き', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: '項目 A', numbering: { reference: 'wowd-bullet', level: 0 } }),
          new Paragraph({ text: '項目 B', numbering: { reference: 'wowd-bullet', level: 0 } })
        ]
      }
    ]
  })
}

/** 05: Phase 0〜4 の全要素を 1 ファイルに */
function kitchenSink(): Document {
  return new Document({
    numbering: {
      config: [
        {
          reference: 'ks-num',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '(%1)',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }
          ]
        }
      ]
    },
    sections: [
      {
        children: [
          new Paragraph({ text: '総合テスト文書', heading: HeadingLevel.TITLE }),
          new Paragraph({ text: '見出し 1', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun({ text: '和文', font: JA_FONT, size: 21 }),
              new TextRun({ text: ' English ', font: { ascii: 'Times New Roman' } }),
              new TextRun({ text: '混植', font: JA_FONT, bold: true })
            ],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: 320, lineRule: 'auto' },
            indent: { left: 240 }
          }),
          new Paragraph({ text: '番号項目', numbering: { reference: 'ks-num', level: 0 } }),
          new Paragraph({ text: '番号項目その 2', numbering: { reference: 'ks-num', level: 0 } }),
          new Paragraph({ text: '見出し 2', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun('末尾の段落。')] })
        ]
      }
    ]
  })
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  console.log('フィクスチャを生成します:')
  await emit('01-plain.docx', plain())
  await emit('02-formatting.docx', formatting())
  await emit('03-styles.docx', styles())
  await emit('04-lists.docx', lists())
  await emit('05-kitchen-sink.docx', kitchenSink())
  console.log('完了')
}

void main()
