/**
 * 段落属性 (w:pPr) の TipTap 属性定義と CSS への写像。
 *
 * paragraph と heading は Word では同じ w:p なので、属性定義を共有する。
 * 値は twip などの OOXML ネイティブ単位のまま保持し、px 化はここ (描画直前) だけで行う。
 */
import type { ParagraphAttrs, ParagraphIndent, ParagraphSpacing } from '@core/model/types'

export { indentToCss, spacingToCss, paragraphAttrsToStyle } from '@core/css/paragraphCss'

export const DEFAULT_PARAGRAPH_ATTRS: ParagraphAttrs = {
  pStyle: null,
  numPr: null,
  jc: null,
  spacing: null,
  ind: null,
  outlineLvl: null,
  keepNext: false,
  keepLines: false,
  pageBreakBefore: false,
  snapToGrid: true,
  sectionId: null,
  paraId: null,
  markRunProps: null,
  paraMarkRevision: null,
  rawPPr: null,
}

/** JSON 由来の値をそのまま持ち回すだけの属性 (HTML には出さない) */
function passthrough<T>(def: T) {
  return {
    default: def,
    parseHTML: () => def,
    renderHTML: () => ({}),
    keepOnSplit: true
  }
}

/** TipTap の addAttributes() に流し込む定義 */
export function paragraphAttributeSpec() {
  return {
    pStyle: passthrough<string | null>(null),
    numPr: passthrough<ParagraphAttrs['numPr']>(null),
    jc: passthrough<ParagraphAttrs['jc']>(null),
    spacing: passthrough<ParagraphSpacing | null>(null),
    ind: passthrough<ParagraphIndent | null>(null),
    outlineLvl: passthrough<number | null>(null),
    keepNext: passthrough(false),
    keepLines: passthrough(false),
    pageBreakBefore: passthrough(false),
    snapToGrid: passthrough(true),
    sectionId: passthrough<string | null>(null),
    // paraId は分割時に引き継ぐと Word 側で重複するので、新しい段落には引き継がない
    paraId: { default: null, parseHTML: () => null, renderHTML: () => ({}), keepOnSplit: false },
    markRunProps: passthrough<ParagraphAttrs['markRunProps']>(null),
    // 段落記号の挿入・削除。分割で生まれた段落に引き継ぐと、
    // 記録していない段落まで「挿入された」ことになるので引き継がない
    paraMarkRevision: {
      default: null,
      parseHTML: () => null,
      renderHTML: () => ({}),
      keepOnSplit: false
    },
    rawPPr: passthrough<string | null>(null),
  }
}

/** ノード属性から ParagraphAttrs を組み立てる (欠けた項目は既定値で補う) */
export function toParagraphAttrs(attrs: Record<string, unknown>): ParagraphAttrs {
  const out = { ...DEFAULT_PARAGRAPH_ATTRS }
  for (const key of Object.keys(DEFAULT_PARAGRAPH_ATTRS) as (keyof ParagraphAttrs)[]) {
    if (attrs[key] !== undefined) {
      // 属性は WowdDoc からそのまま来る。型は schema.ts 側で保証する
      ;(out as unknown as Record<string, unknown>)[key] = attrs[key]
    }
  }
  return out
}
