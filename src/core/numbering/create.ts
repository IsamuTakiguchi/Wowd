import type { NumberingTable, NumberingLevel, AbstractNum, NumInstance } from '../model/types'
import { nextNumId, nextAbstractNumId } from './resolve'

export type ListKind = 'bullet' | 'decimal'

/** Word 既定の箇条書き記号。レベルごとに変わる */
const BULLET_GLYPHS = ['●', '○', '■', '□', '◆', '◇', '•', '◦', '⁃']

/** 番号書式。日本語文書でよく使う並びに合わせた */
const DECIMAL_FORMATS = [
  { numFmt: 'decimal', lvlText: '%1.' },
  { numFmt: 'decimalEnclosedCircle', lvlText: '%2' },
  { numFmt: 'aiueoFullWidth', lvlText: '%3' },
  { numFmt: 'decimal', lvlText: '(%4)' },
  { numFmt: 'lowerLetter', lvlText: '%5)' },
  { numFmt: 'lowerRoman', lvlText: '%6)' },
  { numFmt: 'decimal', lvlText: '%7.' },
  { numFmt: 'lowerLetter', lvlText: '%8)' },
  { numFmt: 'lowerRoman', lvlText: '%9)' }
]

/** 1 レベルぶんのインデント (twip)。Word の既定は 720 (0.5 インチ) */
const LEVEL_INDENT = 720
const HANGING = 360

function buildLevel(kind: ListKind, ilvl: number): NumberingLevel {
  const format =
    kind === 'bullet'
      ? { numFmt: 'bullet', lvlText: BULLET_GLYPHS[ilvl % BULLET_GLYPHS.length]! }
      : (DECIMAL_FORMATS[ilvl] ?? DECIMAL_FORMATS[0]!)

  return {
    ilvl,
    start: 1,
    numFmt: format.numFmt,
    lvlText: format.lvlText,
    lvlJc: 'left',
    lvlRestart: null,
    suff: 'tab',
    pPr: { ind: { left: LEVEL_INDENT * (ilvl + 1), hanging: HANGING } },
    rPr: null,
    rFonts: kind === 'bullet' ? { ascii: 'Wingdings', hAnsi: 'Wingdings', hint: 'default' } : null,
    isLgl: false
  }
}

/**
 * 指定した種類のリスト定義を探し、無ければ作って numId を返す。
 *
 * 新しく作った定義は rawXml を持たないので、保存時にモデルから
 * numbering.xml を組み立て直す必要がある (numberingChanged を立てること)。
 */
export function ensureListDefinition(
  table: NumberingTable,
  kind: ListKind
): { numId: number; created: boolean } {
  for (const instance of table.instances.values()) {
    const level0 = resolveLevel0(table, instance)
    if (!level0) continue
    const isBullet = level0.numFmt === 'bullet'
    if ((kind === 'bullet') === isBullet) return { numId: instance.numId, created: false }
  }

  const abstractNumId = nextAbstractNumId(table)
  const levels = new Map<number, NumberingLevel>()
  for (let ilvl = 0; ilvl < 9; ilvl++) levels.set(ilvl, buildLevel(kind, ilvl))

  const abstract: AbstractNum = {
    abstractNumId,
    nsid: null,
    multiLevelType: 'hybridMultilevel',
    levels,
    // rawXml が空なら書き出し時にモデルから生成される
    rawXml: ''
  }
  table.abstract.set(abstractNumId, abstract)

  const numId = nextNumId(table)
  const instance: NumInstance = { numId, abstractNumId, overrides: new Map(), rawXml: '' }
  table.instances.set(numId, instance)

  return { numId, created: true }
}

function resolveLevel0(table: NumberingTable, instance: NumInstance): NumberingLevel | null {
  const override = instance.overrides.get(0)
  if (override?.level) return override.level
  return table.abstract.get(instance.abstractNumId)?.levels.get(0) ?? null
}
