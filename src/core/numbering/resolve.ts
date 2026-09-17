import type { NumberingTable, NumberingLevel } from '../model/types'

/**
 * numId + ilvl から実効レベル定義を解決する。
 *
 * 解決順は Word と同じ:
 *   w:num/w:lvlOverride/w:lvl があればそれ
 *   → w:lvlOverride/w:startOverride があれば start だけ差し替え
 *   → なければ abstractNum の該当レベル
 */
export function resolveLevel(
  table: NumberingTable,
  numId: number,
  ilvl: number
): NumberingLevel | null {
  const instance = table.instances.get(numId)
  if (!instance) return null

  const override = instance.overrides.get(ilvl)
  if (override?.level) return override.level

  const abstract = table.abstract.get(instance.abstractNumId)
  const base = abstract?.levels.get(ilvl)
  if (!base) return null

  if (override?.startOverride != null) {
    return { ...base, start: override.startOverride }
  }
  return base
}

/** 既存と衝突しない numId を発番する */
export function nextNumId(table: NumberingTable): number {
  let max = 0
  for (const id of table.instances.keys()) max = Math.max(max, id)
  return max + 1
}

/** 既存と衝突しない abstractNumId を発番する */
export function nextAbstractNumId(table: NumberingTable): number {
  let max = -1
  for (const id of table.abstract.keys()) max = Math.max(max, id)
  return max + 1
}

export function emptyNumberingTable(): NumberingTable {
  return { abstract: new Map(), instances: new Map() }
}
