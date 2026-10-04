import type { StyleDef, StyleTable, ParagraphAttrs } from '../../model/types'
import { el, wrap, valEl, XML_DECL, parseXml, buildXml, tagOf, attr, childrenOf } from '../xml'
import { COMMON_ROOT_NS, rootAttrsOf, applyRootAttrs, ROOT_ATTR_PLACEHOLDER } from './rootAttrs'
import { writeParagraphProps } from './paragraph'
import { writeRunProps, emptyMarkSet } from './run'

/**
 * w:style をモデルから組み立てる。
 *
 * 使うのは Wowd が作った (または丸ごと置き換えた) スタイルだけで、
 * 読み込んだスタイルは rawXml をそのまま書き戻す。
 * モデルに載っていない項目 (太字など、rPr の一部) は組み立てでは出せないので、
 * 既存のスタイルを置き換えるときは必要な項目をすべて持たせること。
 *
 * 子要素の順序は CT_Style の規定どおり:
 * name, basedOn, next, link, uiPriority, semiHidden, qFormat, pPr, rPr
 */
export function writeStyle(style: StyleDef): string {
  let inner = valEl('w:name', style.name)
  if (style.basedOn) inner += valEl('w:basedOn', style.basedOn)
  if (style.next) inner += valEl('w:next', style.next)
  if (style.linkedStyle) inner += valEl('w:link', style.linkedStyle)
  inner += valEl('w:uiPriority', style.uiPriority)
  if (style.semiHidden) inner += el('w:semiHidden')
  if (style.quickFormat) inner += el('w:qFormat')
  if (style.pPr) {
    // スタイルの pPr は部分的なので、snapToGrid を既定 (true) で埋めておく。
    // 埋めないと「グリッドに合わせない」を書いてしまう
    const pPr = { snapToGrid: true, ...style.pPr } as ParagraphAttrs
    inner += writeParagraphProps(pPr, new Map())
  }
  if (style.rPr) {
    const set = emptyMarkSet()
    set.props = style.rPr
    inner += writeRunProps(set)
  }
  return wrap(
    'w:style',
    {
      'w:type': style.type,
      'w:default': style.isDefault ? '1' : undefined,
      'w:customStyle': style.custom ? '1' : undefined,
      'w:styleId': style.styleId
    },
    inner
  )
}

/**
 * styles.xml を書き出す。
 *
 * 原本の並び (docDefaults, latentStyles, 各スタイル) を保ち、
 * - モデルから消えたスタイルは落とし
 * - rawXml が空のスタイル (新規・置き換え) は組み立て直し
 * - 原本に無いスタイルは末尾に足す
 * それ以外はバイト単位で原本のまま通す。
 */
export function writeStyles(table: StyleTable, originalXml: string | null): string {
  const written = new Set<string>()
  const parts: string[] = []

  const root = originalXml ? parseXml(originalXml).find((n) => tagOf(n) === 'w:styles') : undefined
  for (const child of root ? childrenOf(root) : []) {
    if (tagOf(child) !== 'w:style') {
      parts.push(buildXml([child]))
      continue
    }
    const id = attr(child, 'w:styleId')
    const def = id ? table.byId.get(id) : undefined
    if (!id || !def) continue
    written.add(id)
    parts.push(def.rawXml || writeStyle(def))
  }
  for (const def of table.byId.values()) {
    if (written.has(def.styleId)) continue
    parts.push(def.rawXml || writeStyle(def))
  }

  return (
    XML_DECL +
    applyRootAttrs(
      wrap('w:styles', ROOT_ATTR_PLACEHOLDER, parts.join('')),
      rootAttrsOf(originalXml, 'w:styles', COMMON_ROOT_NS)
    )
  )
}
