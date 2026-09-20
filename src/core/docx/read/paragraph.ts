import type {
  ParagraphAttrs,
  ParagraphNode,
  ParagraphIndent,
  ParagraphSpacing,
  InlineNode,
  Justification,
  LineRule
} from '../../model/types'
import {
  type XNode,
  tagOf,
  childrenOf,
  attr,
  valOf,
  boolVal,
  intVal,
  intAttr,
  findChild,
  serializeChildren,
  otherAttrs
} from '../xml'
import {
  readRun,
  readRevisionMeta,
  readRuby,
  EMPTY_RUN_PROPS,
  type RunContext
} from './run'

export const EMPTY_PARAGRAPH_ATTRS: ParagraphAttrs = {
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
  textId: null,
  rawAttrs: null,
  markRunProps: null,
  paraMarkRevision: null,
  rawPPr: null
}

const KNOWN_PPR = new Set([
  'w:pStyle',
  'w:numPr',
  'w:jc',
  'w:spacing',
  'w:ind',
  'w:outlineLvl',
  'w:keepNext',
  'w:keepLines',
  'w:pageBreakBefore',
  'w:snapToGrid',
  'w:sectPr',
  'w:rPr'
])

const JUSTIFICATIONS = new Set<string>(['left', 'center', 'right', 'both', 'distribute'])

function readIndent(node: XNode): ParagraphIndent {
  const out: ParagraphIndent = {}
  const num = (name: string): number | null => intAttr(node, name)
  const left = num('w:left') ?? num('w:start')
  const right = num('w:right') ?? num('w:end')
  const firstLine = num('w:firstLine')
  const hanging = num('w:hanging')
  const leftChars = num('w:leftChars') ?? num('w:startChars')
  const rightChars = num('w:rightChars') ?? num('w:endChars')
  const firstLineChars = num('w:firstLineChars')
  const hangingChars = num('w:hangingChars')
  if (left != null) out.left = left
  if (right != null) out.right = right
  if (firstLine != null) out.firstLine = firstLine
  if (hanging != null) out.hanging = hanging
  if (leftChars != null) out.leftChars = leftChars
  if (rightChars != null) out.rightChars = rightChars
  if (firstLineChars != null) out.firstLineChars = firstLineChars
  if (hangingChars != null) out.hangingChars = hangingChars
  return out
}

function readSpacing(node: XNode): ParagraphSpacing {
  const out: ParagraphSpacing = {}
  const before = intAttr(node, 'w:before')
  const after = intAttr(node, 'w:after')
  const line = intAttr(node, 'w:line')
  const beforeLines = intAttr(node, 'w:beforeLines')
  const afterLines = intAttr(node, 'w:afterLines')
  const rule = attr(node, 'w:lineRule')
  if (before != null) out.before = before
  if (after != null) out.after = after
  if (line != null) out.line = line
  if (beforeLines != null) out.beforeLines = beforeLines
  if (afterLines != null) out.afterLines = afterLines
  if (rule === 'auto' || rule === 'exact' || rule === 'atLeast') out.lineRule = rule as LineRule
  return out
}

export interface ReadParagraphResult {
  attrs: ParagraphAttrs
  /** この段落が w:sectPr を持っていた場合の生 XML */
  sectPr: XNode | null
}

export function readParagraphProps(pPr: XNode | undefined): ReadParagraphResult {
  const attrs: ParagraphAttrs = { ...EMPTY_PARAGRAPH_ATTRS }
  let sectPr: XNode | null = null
  if (!pPr) return { attrs, sectPr }

  const leftovers: XNode[] = []
  for (const child of childrenOf(pPr)) {
    const tag = tagOf(child)
    if (!KNOWN_PPR.has(tag)) {
      leftovers.push(child)
      continue
    }
    switch (tag) {
      case 'w:pStyle':
        attrs.pStyle = valOf(child) ?? null
        break
      case 'w:numPr': {
        const numId = intVal(findChild(child, 'w:numId'))
        const ilvl = intVal(findChild(child, 'w:ilvl'), 0) ?? 0
        /**
         * numId=0 は「この段落だけリストを外す」という**明示の指定**。
         *
         * 箇条書きを持つスタイル (リスト段落など) を当てた段落から
         * Word で箇条書きを外すと、この形が書かれる。
         * リストとしては扱わないが、**要素ごと捨ててはいけない。**
         * 捨てるとスタイル側の箇条書きが復活して、記号が戻ってしまう。
         *
         * 記号を出すかどうかは numId から番号定義を引けるかで決まるので
         * (numId=0 は引けない)、モデルに残しても表示には影響しない。
         */
        if (numId != null) attrs.numPr = { numId, ilvl }
        break
      }
      case 'w:jc': {
        const v = valOf(child)
        if (v && JUSTIFICATIONS.has(v)) attrs.jc = v as Justification
        // Word は left/right を start/end と書くことがある
        else if (v === 'start') attrs.jc = 'left'
        else if (v === 'end') attrs.jc = 'right'
        break
      }
      case 'w:spacing':
        attrs.spacing = readSpacing(child)
        break
      case 'w:ind':
        attrs.ind = readIndent(child)
        break
      case 'w:outlineLvl':
        attrs.outlineLvl = intVal(child)
        break
      case 'w:keepNext':
        attrs.keepNext = boolVal(child)
        break
      case 'w:keepLines':
        attrs.keepLines = boolVal(child)
        break
      case 'w:pageBreakBefore':
        attrs.pageBreakBefore = boolVal(child)
        break
      case 'w:snapToGrid':
        attrs.snapToGrid = boolVal(child)
        break
      case 'w:sectPr':
        sectPr = child
        break
      case 'w:rPr': {
        // 段落記号そのものの挿入・削除。rawRPr に紛れ込ませると
        // 承諾や取り消しの対象にできないので、先に取り分ける
        const rest: XNode[] = []
        for (const node of childrenOf(child)) {
          const name = tagOf(node)
          if (name === 'w:ins' || name === 'w:del') {
            attrs.paraMarkRevision = {
              kind: name === 'w:ins' ? 'ins' : 'del',
              meta: readRevisionMeta(node)
            }
            continue
          }
          rest.push(node)
        }
        // 段落記号自体の書式は解釈せず、そのまま退避する。
        // 画面にも保存内容にも効かない飾りなので、モデル化する意味が無い。
        // (モデル化した項目と raw の両方に入れると二重に書き出されてしまう)
        attrs.markRunProps = { ...EMPTY_RUN_PROPS, rawRPr: serializeChildren(rest) }
        break
      }
    }
  }
  attrs.rawPPr = serializeChildren(leftovers)
  return { attrs, sectPr }
}

/** モデル化済みの w:p 子要素 */
const KNOWN_P_CHILD = new Set([
  'w:pPr',
  'w:r',
  'w:hyperlink',
  'w:ins',
  'w:del',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:fldSimple',
  'w:proofErr',
  'w:smartTag',
  'w:sdt'
])

export interface ReadParagraphOutput {
  node: ParagraphNode
  sectPr: XNode | null
}

export function readParagraph(p: XNode, ctx: RunContext): ReadParagraphOutput {
  const { attrs, sectPr } = readParagraphProps(findChild(p, 'w:pPr'))
  const paraId = attr(p, 'w14:paraId')
  if (paraId) attrs.paraId = paraId
  const textId = attr(p, 'w14:textId')
  if (textId) attrs.textId = textId
  // 残りの属性 (w:rsid* など) はそのまま抱えて書き戻す
  const rest = otherAttrs(p, ['w14:paraId', 'w14:textId'])
  if (Object.keys(rest).length > 0) attrs.rawAttrs = rest

  const content: InlineNode[] = []
  readInlineChildren(childrenOf(p), content, ctx)

  const node: ParagraphNode = { type: 'paragraph', attrs }
  if (content.length) node.content = content
  return { node, sectPr }
}

/**
 * w:p / w:hyperlink / w:ins / w:del の子を再帰的にインラインノードへ展開する。
 * 改訂とコメントは「範囲」なので、ctx を退避・復元しながら潜る。
 */
export function readInlineChildren(nodes: XNode[], out: InlineNode[], ctx: RunContext): void {
  for (const child of nodes) {
    const tag = tagOf(child)
    switch (tag) {
      case 'w:pPr':
      case 'w:proofErr':
        break

      case 'w:r':
        out.push(...readRun(child, ctx))
        break

      case 'w:ruby': {
        const ruby = readRuby(child, ctx)
        if (ruby) out.push(ruby)
        break
      }

      case 'w:hyperlink': {
        // リンクはマークなので、子のランに link マークを載せて展開する
        const before = out.length
        readInlineChildren(childrenOf(child), out, ctx)
        const href = attr(child, 'r:id') ?? null
        const anchor = attr(child, 'w:anchor') ?? null
        const tooltip = attr(child, 'w:tooltip') ?? null
        for (let i = before; i < out.length; i++) {
          const n = out[i]
          if (n?.type !== 'text') continue
          n.marks = [
            ...(n.marks ?? []),
            { type: 'link', attrs: { href: null, anchor, rId: href, tooltip } }
          ]
        }
        break
      }

      case 'w:ins':
      case 'w:del': {
        const saved = ctx.revision
        ctx.revision = { kind: tag === 'w:ins' ? 'ins' : 'del', meta: readRevisionMeta(child) }
        readInlineChildren(childrenOf(child), out, ctx)
        ctx.revision = saved
        break
      }

      case 'w:commentRangeStart': {
        const id = attr(child, 'w:id')
        if (id) ctx.commentIds.push(id)
        break
      }
      case 'w:commentRangeEnd': {
        const id = attr(child, 'w:id')
        if (id) {
          const idx = ctx.commentIds.lastIndexOf(id)
          if (idx >= 0) ctx.commentIds.splice(idx, 1)
        }
        break
      }

      case 'w:bookmarkStart':
        out.push({
          type: 'bookmark',
          attrs: {
            id: attr(child, 'w:id') ?? '',
            name: attr(child, 'w:name') ?? '',
            isEnd: false
          }
        })
        break
      case 'w:bookmarkEnd':
        out.push({
          type: 'bookmark',
          attrs: { id: attr(child, 'w:id') ?? '', name: '', isEnd: true }
        })
        break

      case 'w:fldSimple': {
        const instr = attr(child, 'w:instr') ?? ''
        const cached: InlineNode[] = []
        readInlineChildren(childrenOf(child), cached, ctx)
        const cachedText = cached
          .map((n) => (n.type === 'text' ? n.text : ''))
          .join('')
        out.push({
          type: 'field',
          attrs: { instr, cachedText, dirty: attr(child, 'w:dirty') === 'true' }
        })
        break
      }

      case 'w:smartTag':
      case 'w:sdt':
        // 中身は普通のランなので展開し、器だけ落とす。
        // 器そのものの往復は Phase 7 以降で扱う。
        readInlineChildren(childrenOf(child), out, ctx)
        break

      default:
        if (!KNOWN_P_CHILD.has(tag)) {
          ctx.unsupported.add(tag)
          // w:p の直下から退避したものは既に完結しているので、書き戻しで包まない
          out.push({
            type: 'rawRun',
            attrs: { xml: serializeChildren([child]) ?? '', label: tag, inRun: false }
          })
        }
    }
  }
}
