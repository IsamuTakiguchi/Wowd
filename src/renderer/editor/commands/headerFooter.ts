import type { WowdDocument, WowdDoc, SectionProps } from '@core/model/types'
import { REL_TYPE } from '@core/docx/package'

/**
 * ヘッダー / フッターの置き場所を用意する。
 *
 * まだ持たない文書に付ける場合は、パート名・関係・セクションの参照を
 * まとめて作る。実際のパートは保存時に書き出される。
 * どれか 1 つでも欠けると Word 側でヘッダーが現れない。
 */

export type HeaderFooterKind = 'header' | 'footer'
/** どのページに出すか。Word の「先頭ページのみ別」「奇数/偶数ページ別」に対応する */
export type HeaderFooterSlot = 'default' | 'first' | 'even'

/** w:headerReference の w:type。Word はこの名前で区別する */
const SLOT_TYPE: Record<HeaderFooterSlot, string> = {
  default: 'default',
  first: 'first',
  even: 'even'
}

function partNameFor(document_: WowdDocument, kind: HeaderFooterKind): string {
  const parts = document_.resources.rawParts
  for (let i = 1; i < 1000; i++) {
    const name = `word/${kind}${i}.xml`
    if (!parts.has(name)) return name
  }
  return `word/${kind}-${Date.now()}.xml`
}

export interface EnsureResult {
  relId: string
  /** 新しく作ったか。作った場合はセクションも書き換わっている */
  created: boolean
  section: SectionProps
}

/**
 * 指定した枠のヘッダー / フッターを用意し、その関係 ID を返す。
 *
 * すでにあればそれを返す。無ければ資源に登録して作る。
 * 資源 (media / rels / headers) はその場で書き換える。
 * 呼び出し側がセクションの差し替えと dirty の設定を行う。
 */
export function ensureHeaderFooter(
  document_: WowdDocument,
  section: SectionProps,
  kind: HeaderFooterKind,
  slot: HeaderFooterSlot
): EnsureResult {
  const refs = kind === 'header' ? section.headerRefs : section.footerRefs
  const existing = refs[slot]
  if (existing) return { relId: existing, created: false, section }

  const partName = partNameFor(document_, kind)
  const relId = `rId${document_.resources.rels.nextId}`
  document_.resources.rels.byId.set(relId, {
    id: relId,
    type: kind === 'header' ? REL_TYPE.header : REL_TYPE.footer,
    target: partName.replace(/^word\//, ''),
    targetMode: null
  })
  document_.resources.rels.nextId += 1

  const empty: WowdDoc = { type: 'doc', content: [] }
  const store = kind === 'header' ? document_.resources.headers : document_.resources.footers
  store.set(relId, empty)

  const nextRefs = { ...refs, [slot]: relId }
  const nextSection: SectionProps = {
    ...section,
    headerRefs: kind === 'header' ? nextRefs : section.headerRefs,
    footerRefs: kind === 'footer' ? nextRefs : section.footerRefs,
    // 先頭ページ別のヘッダーは titlePg が立っていないと使われない
    titlePg: slot === 'first' ? true : section.titlePg
  }

  return { relId, created: true, section: nextSection }
}

/** 参照の型名。E2E と保存側で同じ値を使う */
export function slotType(slot: HeaderFooterSlot): string {
  return SLOT_TYPE[slot]
}
