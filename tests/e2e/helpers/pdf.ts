/**
 * PDF のページ数を数える。
 *
 * 依存を増やさないよう最小限の実装にしてある。
 * まずページツリーの /Count を読み、無ければ /Type /Page の数を数える。
 */
export function countPdfPages(bytes: Buffer): number {
  const text = bytes.toString('latin1')

  // /Type /Pages を持つオブジェクトの /Count が総ページ数
  const counts: number[] = []
  const re = /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) counts.push(Number(m[1]))
  if (counts.length > 0) return Math.max(...counts)

  // 予備: ページオブジェクトを直接数える (/Pages と誤認しないよう境界を見る)
  const pageObjects = text.match(/\/Type\s*\/Page(?![s\w])/g)
  return pageObjects ? pageObjects.length : 0
}

/** PDF として最低限成立しているか */
export function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-'
}
