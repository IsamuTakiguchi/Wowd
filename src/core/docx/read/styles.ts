import type { StyleTable, StyleDef, ParagraphAttrs } from '../../model/types'
import {
  parseXml,
  type XNode,
  tagOf,
  attr,
  valOf,
  intVal,
  findChild,
  findChildren,
  buildXml,
  boolVal
} from '../xml'
import { readParagraphProps } from './paragraph'
import { readRunProps } from './run'

export function emptyStyleTable(): StyleTable {
  return {
    docDefaults: { pPr: null, rPr: null },
    byId: new Map(),
    defaults: { paragraph: null, character: null, table: null }
  }
}

function readStyle(node: XNode): StyleDef | null {
  const styleId = attr(node, 'w:styleId')
  if (!styleId) return null
  const typeAttr = attr(node, 'w:type') ?? 'paragraph'
  const type: StyleDef['type'] =
    typeAttr === 'character' || typeAttr === 'table' || typeAttr === 'numbering'
      ? typeAttr
      : 'paragraph'

  const pPrNode = findChild(node, 'w:pPr')
  const rPrNode = findChild(node, 'w:rPr')

  return {
    styleId,
    type,
    name: valOf(findChild(node, 'w:name')) ?? styleId,
    basedOn: valOf(findChild(node, 'w:basedOn')) ?? null,
    next: valOf(findChild(node, 'w:next')) ?? null,
    linkedStyle: valOf(findChild(node, 'w:link')) ?? null,
    isDefault: attr(node, 'w:default') === '1' || attr(node, 'w:default') === 'true',
    quickFormat: findChild(node, 'w:qFormat') !== undefined,
    uiPriority: intVal(findChild(node, 'w:uiPriority'), 99) ?? 99,
    semiHidden: boolVal(findChild(node, 'w:semiHidden')),
    pPr: pPrNode ? readParagraphProps(pPrNode).attrs : null,
    rPr: rPrNode ? readRunProps(rPrNode).props : null,
    rawXml: buildXml([node])
  }
}

export function readStyles(xml: string | null): StyleTable {
  const table = emptyStyleTable()
  if (!xml) return table

  const root = parseXml(xml).find((n) => tagOf(n) === 'w:styles')
  if (!root) return table

  const docDefaults = findChild(root, 'w:docDefaults')
  if (docDefaults) {
    const pDefault = findChild(findChild(docDefaults, 'w:pPrDefault'), 'w:pPr')
    const rDefault = findChild(findChild(docDefaults, 'w:rPrDefault'), 'w:rPr')
    table.docDefaults = {
      pPr: pDefault ? readParagraphProps(pDefault).attrs : null,
      rPr: rDefault ? readRunProps(rDefault).props : null
    }
  }

  for (const node of findChildren(root, 'w:style')) {
    const style = readStyle(node)
    if (!style) continue
    table.byId.set(style.styleId, style)
    if (
      style.isDefault &&
      (style.type === 'paragraph' || style.type === 'character' || style.type === 'table')
    ) {
      table.defaults[style.type] = style.styleId
    }
  }

  return table
}

/**
 * basedOn を辿ってスタイルの実効値を求める。
 * 循環参照する壊れた文書があるので、訪問済み集合で必ず打ち切る。
 */
export function resolveStyleChain(table: StyleTable, styleId: string | null): StyleDef[] {
  const chain: StyleDef[] = []
  const seen = new Set<string>()
  let current = styleId
  while (current && !seen.has(current)) {
    seen.add(current)
    const style = table.byId.get(current)
    if (!style) break
    chain.unshift(style)
    current = style.basedOn
  }
  return chain
}

/** 段落スタイルの実効 pPr。docDefaults → basedOn 連鎖 → 自身 の順に重ねる */
export function effectiveParagraphProps(
  table: StyleTable,
  styleId: string | null
): Partial<ParagraphAttrs> {
  let out: Partial<ParagraphAttrs> = { ...(table.docDefaults.pPr ?? {}) }
  for (const style of resolveStyleChain(table, styleId)) {
    if (style.pPr) out = { ...out, ...stripNulls(style.pPr) }
  }
  return out
}

/** 未設定 (null / false / 既定値) の項目で上位の値を潰さないようにする */
function stripNulls<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === false) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  return out
}
