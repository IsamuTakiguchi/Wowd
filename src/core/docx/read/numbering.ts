import type { NumberingTable, AbstractNum, NumInstance, NumberingLevel } from '../../model/types'
import {
  parseXml,
  type XNode,
  tagOf,
  childrenOf,
  attr,
  valOf,
  intAttr,
  intVal,
  findChild,
  findChildren,
  buildXml,
  boolVal
} from '../xml'
import { readParagraphProps } from './paragraph'
import { readRunProps } from './run'
import { emptyNumberingTable } from '../../numbering/resolve'

function readLevel(lvl: XNode): NumberingLevel {
  const ilvl = intAttr(lvl, 'w:ilvl') ?? 0
  const pPrNode = findChild(lvl, 'w:pPr')
  const rPrNode = findChild(lvl, 'w:rPr')
  const parsedPPr = pPrNode ? readParagraphProps(pPrNode).attrs : null
  const parsedRPr = rPrNode ? readRunProps(rPrNode) : null

  const suffVal = valOf(findChild(lvl, 'w:suff'))

  return {
    ilvl,
    start: intVal(findChild(lvl, 'w:start'), 1) ?? 1,
    numFmt: valOf(findChild(lvl, 'w:numFmt')) ?? 'decimal',
    lvlText: valOf(findChild(lvl, 'w:lvlText')) ?? '',
    lvlJc: (valOf(findChild(lvl, 'w:lvlJc')) as NumberingLevel['lvlJc']) ?? null,
    lvlRestart: intVal(findChild(lvl, 'w:lvlRestart')),
    suff: suffVal === 'space' || suffVal === 'nothing' ? suffVal : 'tab',
    pPr: parsedPPr,
    rPr: parsedRPr ? parsedRPr.props : null,
    rFonts: parsedRPr?.props.rFonts ?? null,
    isLgl: boolVal(findChild(lvl, 'w:isLgl'))
  }
}

export function readNumbering(xml: string | null): NumberingTable {
  const table = emptyNumberingTable()
  if (!xml) return table

  const root = parseXml(xml).find((n) => tagOf(n) === 'w:numbering')
  if (!root) return table

  for (const node of childrenOf(root)) {
    const tag = tagOf(node)

    if (tag === 'w:abstractNum') {
      const id = intAttr(node, 'w:abstractNumId')
      if (id == null) continue
      const levels = new Map<number, NumberingLevel>()
      for (const lvl of findChildren(node, 'w:lvl')) {
        const level = readLevel(lvl)
        levels.set(level.ilvl, level)
      }
      const abstract: AbstractNum = {
        abstractNumId: id,
        nsid: attr(findChild(node, 'w:nsid'), 'w:val') ?? null,
        multiLevelType: valOf(findChild(node, 'w:multiLevelType')) ?? null,
        levels,
        rawXml: buildXml([node])
      }
      table.abstract.set(id, abstract)
      continue
    }

    if (tag === 'w:num') {
      const numId = intAttr(node, 'w:numId')
      const abstractNumId = intVal(findChild(node, 'w:abstractNumId'))
      if (numId == null || abstractNumId == null) continue

      const overrides = new Map<number, { startOverride: number | null; level: NumberingLevel | null }>()
      for (const ov of findChildren(node, 'w:lvlOverride')) {
        const ilvl = intAttr(ov, 'w:ilvl') ?? 0
        const lvlNode = findChild(ov, 'w:lvl')
        overrides.set(ilvl, {
          startOverride: intVal(findChild(ov, 'w:startOverride')),
          level: lvlNode ? readLevel(lvlNode) : null
        })
      }

      const instance: NumInstance = {
        numId,
        abstractNumId,
        overrides,
        rawXml: buildXml([node])
      }
      table.instances.set(numId, instance)
    }
  }

  return table
}
