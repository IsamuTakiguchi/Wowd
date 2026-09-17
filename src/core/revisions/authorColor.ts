/**
 * 変更履歴の著者ごとの色。
 *
 * 誰の赤入りかが一目で分かる必要がある。Word も同じように
 * 著者ごとに色を割り当てる。名前から決めるので、同じ文書を
 * 別の機械で開いても同じ色になる。
 */

/**
 * 著者の色。Word の既定に近い並びで、白地の上で読める濃さに揃えてある。
 * 隣り合う色が紛らわしくならないよう、色相を散らしてある。
 */
export const AUTHOR_COLORS = [
  '#c0392b', // 赤
  '#1f6fb2', // 青
  '#1e8449', // 緑
  '#8e44ad', // 紫
  '#b9770e', // 橙
  '#117a8b', // 藍
  '#a93226', // 臙脂
  '#5b2c6f' // 菫
] as const

/** 著者名から色を決める。空なら先頭の色 */
export function authorColor(author: string): string {
  const fallback = AUTHOR_COLORS[0]
  if (!author) return fallback
  // FNV-1a。短い名前でも散らばりが良く、実装が数行で済む
  let hash = 0x811c9dc5
  for (let i = 0; i < author.length; i++) {
    hash ^= author.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length] ?? fallback
}
