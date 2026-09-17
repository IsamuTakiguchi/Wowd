/**
 * Word に「見出しノード」は存在せず、見出しは pStyle="Heading1" を持つただの段落。
 * 一方 ProseMirror 側は heading を独立ノードにした方が扱いやすいので、
 * この 1 箇所だけで両者を写像する。
 */

const HEADING_STYLE_RE = /^Heading([1-9])$/

/** 'Heading2' → 2。見出しスタイルでなければ null */
export function headingLevelOf(pStyle: string | null): number | null {
  if (!pStyle) return null
  const m = HEADING_STYLE_RE.exec(pStyle)
  return m ? Number(m[1]) : null
}

export function headingStyleId(level: number): string {
  return `Heading${Math.min(9, Math.max(1, level))}`
}
