import type { NumberingTable, NumberingLevel } from '../../model/types'
import { el, wrap, valEl, XML_DECL } from '../xml'
import { LVL_ORDER, emitOrdered, type OrderedFragment } from './order'
import {
  COMMON_ROOT_NS,
  rootAttrsOf,
  applyRootAttrs,
  ROOT_ATTR_PLACEHOLDER
} from './rootAttrs'
import { writeParagraphProps } from './paragraph'
import { writeRunProps, emptyMarkSet } from './run'

/**
 * 原本が無いときの既定。原本があるなら、そのルート属性をそのまま引き継ぐ。
 * テンプレートの numbering.xml は w15:tentative を持っており、
 * 宣言を落とすと名前空間として不正な XML になる。
 */
const NUMBERING_NS = COMMON_ROOT_NS

export function writeLevel(level: NumberingLevel): string {
  const frags: OrderedFragment[] = []
  const add = (tag: string, xml: string): void => {
    if (xml) frags.push({ tag, xml })
  }

  add('w:start', valEl('w:start', level.start))
  add('w:numFmt', valEl('w:numFmt', level.numFmt))
  if (level.lvlRestart != null) add('w:lvlRestart', valEl('w:lvlRestart', level.lvlRestart))
  if (level.isLgl) add('w:isLgl', el('w:isLgl'))
  if (level.suff !== 'tab') add('w:suff', valEl('w:suff', level.suff))
  add('w:lvlText', valEl('w:lvlText', level.lvlText))
  if (level.lvlJc) add('w:lvlJc', valEl('w:lvlJc', level.lvlJc))

  if (level.pPr) {
    // レベル定義の pPr はインデントくらいしか持たないので、セクション参照は不要
    add('w:pPr', writeParagraphProps({ ...level.pPr } as never, new Map()))
  }
  if (level.rPr) {
    const set = emptyMarkSet()
    set.props = level.rPr
    add('w:rPr', writeRunProps(set))
  }

  return wrap('w:lvl', { 'w:ilvl': level.ilvl }, emitOrdered(LVL_ORDER, frags, 'w:lvl'))
}

/**
 * numbering.xml を書き出す。
 *
 * 読み込み時に保持した rawXml をそのまま使うのが基本。
 * Wowd が編集した定義だけをモデルから組み立て直す。
 */
export function writeNumbering(table: NumberingTable, originalXml: string | null = null): string {
  const abstracts = [...table.abstract.values()]
    .sort((a, b) => a.abstractNumId - b.abstractNumId)
    .map((a) => a.rawXml || writeAbstractNum(a.abstractNumId, [...a.levels.values()]))
    .join('')

  const nums = [...table.instances.values()]
    .sort((a, b) => a.numId - b.numId)
    .map(
      (n) =>
        n.rawXml ||
        wrap('w:num', { 'w:numId': n.numId }, valEl('w:abstractNumId', n.abstractNumId))
    )
    .join('')

  return (
    XML_DECL +
    applyRootAttrs(
      wrap('w:numbering', ROOT_ATTR_PLACEHOLDER, abstracts + nums),
      rootAttrsOf(originalXml, 'w:numbering', NUMBERING_NS)
    )
  )
}

export function writeAbstractNum(abstractNumId: number, levels: NumberingLevel[]): string {
  const body =
    valEl('w:multiLevelType', levels.length > 1 ? 'hybridMultilevel' : 'singleLevel') +
    levels
      .slice()
      .sort((a, b) => a.ilvl - b.ilvl)
      .map(writeLevel)
      .join('')
  return wrap('w:abstractNum', { 'w:abstractNumId': abstractNumId }, body)
}
