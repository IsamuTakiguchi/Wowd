import type { Mark, RunProps, RunFonts, InlineNode, TextNode, RevisionMeta } from '../../model/types'
import { el, wrap, textEl, valEl, type AttrMap } from '../xml'
import { RPR_ORDER, emitOrdered, splitFragments, type OrderedFragment } from './order'
import { writeDrawing } from './drawing'

export interface MarkSet {
  bold: boolean
  italic: boolean
  strike: boolean
  doubleStrike: boolean
  underline: { val: string; color: string | null } | null
  props: RunProps | null
  link: { rId: string | null; anchor: string | null; tooltip: string | null } | null
  commentIds: string[]
  insertion: RevisionMeta | null
  deletion: RevisionMeta | null
}

export function emptyMarkSet(): MarkSet {
  return {
    bold: false,
    italic: false,
    strike: false,
    doubleStrike: false,
    underline: null,
    props: null,
    link: null,
    commentIds: [],
    insertion: null,
    deletion: null
  }
}

export function collectMarks(marks: Mark[] | undefined): MarkSet {
  const set = emptyMarkSet()
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        set.bold = true
        break
      case 'italic':
        set.italic = true
        break
      case 'strike':
        set.strike = true
        break
      case 'doubleStrike':
        set.doubleStrike = true
        break
      case 'underline':
        set.underline = mark.attrs
        break
      case 'textStyle':
        set.props = mark.attrs
        break
      case 'link':
        set.link = { rId: mark.attrs.rId, anchor: mark.attrs.anchor, tooltip: mark.attrs.tooltip }
        break
      case 'comment':
        set.commentIds = mark.attrs.ids
        break
      case 'insertion':
        set.insertion = mark.attrs
        break
      case 'deletion':
        set.deletion = mark.attrs
        break
    }
  }
  return set
}

function fontsAttrs(f: RunFonts): AttrMap {
  return {
    'w:ascii': f.ascii,
    'w:eastAsia': f.eastAsia,
    'w:hAnsi': f.hAnsi,
    'w:cs': f.cs,
    'w:hint': f.hint,
    'w:asciiTheme': f.asciiTheme,
    'w:eastAsiaTheme': f.eastAsiaTheme,
    'w:hAnsiTheme': f.hAnsiTheme
  }
}

/** w:rPr を規定順で組み立てる。未対応項目は rawRPr から復元して末尾に混ぜる */
export function writeRunProps(set: MarkSet): string {
  const p = set.props
  const frags: OrderedFragment[] = []
  const add = (tag: string, xml: string): void => {
    if (xml) frags.push({ tag, xml })
  }

  if (p?.rStyle) add('w:rStyle', valEl('w:rStyle', p.rStyle))
  if (p?.rFonts) add('w:rFonts', el('w:rFonts', fontsAttrs(p.rFonts)))
  if (set.bold) add('w:b', el('w:b'))
  if (set.italic) add('w:i', el('w:i'))
  if (set.strike) add('w:strike', el('w:strike'))
  if (set.doubleStrike) add('w:dstrike', el('w:dstrike'))
  if (p?.color) add('w:color', valEl('w:color', p.color))
  if (p?.spacing != null) add('w:spacing', valEl('w:spacing', p.spacing))
  if (p?.w != null) add('w:w', valEl('w:w', p.w))
  if (p?.kern != null) add('w:kern', valEl('w:kern', p.kern))
  if (p?.sz != null) add('w:sz', valEl('w:sz', p.sz))
  if (p?.szCs != null) add('w:szCs', valEl('w:szCs', p.szCs))
  if (p?.highlight) add('w:highlight', valEl('w:highlight', p.highlight))
  if (set.underline) {
    add(
      'w:u',
      el('w:u', { 'w:val': set.underline.val, 'w:color': set.underline.color ?? undefined })
    )
  }
  if (p?.shd) add('w:shd', el('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': p.shd }))
  if (p?.vertAlign) add('w:vertAlign', valEl('w:vertAlign', p.vertAlign))
  if (p?.lang) {
    add('w:lang', el('w:lang', { 'w:val': p.lang.val, 'w:eastAsia': p.lang.eastAsia }))
  }

  for (const frag of splitFragments(p?.rawRPr ?? null)) frags.push(frag)

  const body = emitOrdered(RPR_ORDER, frags, 'w:rPr')
  return body ? wrap('w:rPr', undefined, body) : ''
}

/**
 * 連続するインラインノードをできるだけ少ない w:r にまとめて出力する。
 * マークが同じ隣接ノードは 1 つのランに入れる (Word が吐く形に近く、差分も小さい)。
 */
export function writeInlineRuns(nodes: InlineNode[], inDeletion = false): string {
  let out = ''
  let i = 0
  /**
   * いま開いているコメント範囲。
   *
   * コメントはランを包むのではなく、範囲の前後に印を置く形で表される。
   * ここで開閉を追わないと、読み込めても保存で消えてしまう。
   */
  let openComments: string[] = []

  const syncComments = (next: string[]): string => {
    let marks = ''
    // 閉じるものを先に出す
    for (const id of openComments) {
      if (!next.includes(id)) marks += el('w:commentRangeEnd', { 'w:id': id })
    }
    // 参照は範囲を閉じた直後に置く
    for (const id of openComments) {
      if (!next.includes(id)) {
        marks += wrap('w:r', undefined, el('w:commentReference', { 'w:id': id }))
      }
    }
    for (const id of next) {
      if (!openComments.includes(id)) marks += el('w:commentRangeStart', { 'w:id': id })
    }
    openComments = next
    return marks
  }

  while (i < nodes.length) {
    const node = nodes[i]!

    if (node.type === 'text') {
      const set = collectMarks(node.marks)
      const group: TextNode[] = [node]
      let j = i + 1
      while (j < nodes.length) {
        const next = nodes[j]
        if (next?.type !== 'text' || !sameMarks(node.marks, next.marks)) break
        group.push(next)
        j++
      }
      out += syncComments(set.commentIds)
      out += wrapRevision(set, () => writeTextRun(group, set, inDeletion || set.deletion != null))
      i = j
      continue
    }

    out += syncComments([])
    out += writeInlineOther(node)
    i++
  }

  // 段落の終わりで開いたままのものを閉じる
  out += syncComments([])
  return out
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

function writeTextRun(nodes: TextNode[], set: MarkSet, asDeleted: boolean): string {
  const rPr = writeRunProps(set)
  const text = nodes.map((n) => n.text).join('')
  // 削除された文字は w:t ではなく w:delText で書く
  const body = rPr + textEl(asDeleted ? 'w:delText' : 'w:t', text)
  const run = wrap('w:r', undefined, body)
  return set.link ? wrapLink(run, set.link) : run
}

function wrapLink(
  inner: string,
  link: { rId: string | null; anchor: string | null; tooltip: string | null }
): string {
  return wrap(
    'w:hyperlink',
    {
      'r:id': link.rId ?? undefined,
      'w:anchor': link.anchor ?? undefined,
      'w:tooltip': link.tooltip ?? undefined
    },
    inner
  )
}

/** 改訂マークが付いていれば w:ins / w:del で包む */
function wrapRevision(set: MarkSet, render: () => string): string {
  const inner = render()
  if (set.deletion) {
    return wrap(
      'w:del',
      { 'w:id': set.deletion.id, 'w:author': set.deletion.author, 'w:date': set.deletion.date },
      inner
    )
  }
  if (set.insertion) {
    return wrap(
      'w:ins',
      { 'w:id': set.insertion.id, 'w:author': set.insertion.author, 'w:date': set.insertion.date },
      inner
    )
  }
  return inner
}

function writeInlineOther(node: InlineNode): string {
  switch (node.type) {
    case 'wTab':
      return wrap('w:r', undefined, el('w:tab'))
    case 'wBreak':
      return wrap(
        'w:r',
        undefined,
        el('w:br', {
          'w:type': node.attrs.breakType === 'column' ? 'column' : undefined,
          'w:clear': node.attrs.clear ?? undefined
        })
      )
    case 'bookmark':
      return node.attrs.isEnd
        ? el('w:bookmarkEnd', { 'w:id': node.attrs.id })
        : el('w:bookmarkStart', { 'w:id': node.attrs.id, 'w:name': node.attrs.name })
    case 'field':
      return wrap(
        'w:fldSimple',
        { 'w:instr': node.attrs.instr, 'w:dirty': node.attrs.dirty ? 'true' : undefined },
        wrap('w:r', undefined, textEl('w:t', node.attrs.cachedText))
      )
    case 'ruby':
      return writeRuby(node)
    case 'image':
      // 原文を保持しているならそれを書き戻す。
      // 回り込みや効果まで含めて完全に再現でき、情報が落ちない。
      // 持たない (このアプリで挿入した) 画像は最小限の骨格を組み立てる
      return node.attrs.rawDrawing
        ? wrap('w:r', undefined, node.attrs.rawDrawing)
        : writeDrawing(node)
    case 'rawRun':
      // w:r の中身として退避したものは包み直す。
      // 包まないと w:fldChar などが w:p の直下に出て規格違反になる
      return node.attrs.inRun && node.attrs.xml
        ? wrap('w:r', undefined, node.attrs.xml)
        : node.attrs.xml
    case 'text':
      return wrap('w:r', undefined, textEl('w:t', node.text))
    default:
      return ''
  }
}

function writeRuby(node: Extract<InlineNode, { type: 'ruby' }>): string {
  const a = node.attrs
  const rubyPr = wrap(
    'w:rubyPr',
    undefined,
    valEl('w:rubyAlign', a.rubyAlign) +
      (a.hps != null ? valEl('w:hps', a.hps) : '') +
      (a.hpsRaise != null ? valEl('w:hpsRaise', a.hpsRaise) : '') +
      (a.hpsBaseText != null ? valEl('w:hpsBaseText', a.hpsBaseText) : '') +
      valEl('w:lid', a.lid)
  )

  const rtSet = emptyMarkSet()
  rtSet.props = a.rtProps
  const rt = wrap(
    'w:rt',
    undefined,
    wrap('w:r', undefined, writeRunProps(rtSet) + textEl('w:t', a.rt))
  )

  const base = wrap('w:rubyBase', undefined, writeInlineRuns(node.content))
  // w:ruby はラン内容 (EG_RunInnerContent) なので w:r で包む。
  // 段落直下に置くと Word が読めないファイルになる
  return wrap('w:r', undefined, wrap('w:ruby', undefined, rubyPr + rt + base))
}

