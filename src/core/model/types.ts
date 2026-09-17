/**
 * Wowd の文書モデル。全レイヤの契約であり、ここが唯一の真実。
 *
 * 設計の骨子:
 *  1. 編集対象のツリー (WowdDoc) は「型付きの ProseMirror JSON」そのもの。
 *     OOXML ⇄ WowdDoc と WowdDoc → PM Node の 2 段に抑え、3 段目を作らない。
 *     独自の中間表現をもう一段挟むと必ず乖離する。
 *  2. 単位は OOXML ネイティブ (twip / half-point / EMU) のまま保持する。
 *     CSS px への変換はレンダリング直前だけ。
 *  3. preserve by default, model by exception。
 *     理解できない要素は raw* フィールドに元の XML のまま退避し、書き戻す。
 *     これがラウンドトリップ忠実性の生命線。
 */

import type { Twip, HalfPt, Emu } from '../../shared/units'

export type { Twip, HalfPt, Emu }

// ───────────────────────────── 編集ツリー ─────────────────────────────

export interface WowdDoc {
  type: 'doc'
  content: BlockNode[]
}

export type BlockNode =
  | ParagraphNode
  | TableNode
  | PageBreakNode
  | SectionBreakNode
  | RawBlockNode

export type InlineNode =
  | TextNode
  | RubyNode
  | TabNode
  | BreakNode
  | FieldNode
  | BookmarkNode
  | ImageNode
  | RawRunNode

// ── 段落 ──

export type Justification = 'left' | 'center' | 'right' | 'both' | 'distribute'
export type LineRule = 'auto' | 'exact' | 'atLeast'

export interface ParagraphSpacing {
  before?: Twip
  after?: Twip
  line?: Twip
  lineRule?: LineRule
  /** w:beforeLines / w:afterLines — 1/100 行単位。日本語 Word が多用する */
  beforeLines?: number
  afterLines?: number
}

export interface ParagraphIndent {
  left?: Twip
  right?: Twip
  firstLine?: Twip
  hanging?: Twip
  /** w:leftChars / w:firstLineChars — 1/100 文字単位。日本語 Word 特有で、twip より優先される */
  leftChars?: number
  rightChars?: number
  firstLineChars?: number
  hangingChars?: number
}

export interface ParagraphAttrs {
  /** w:pStyle/@w:val — styles.xml のスタイル ID */
  pStyle: string | null
  /**
   * w:numPr。リストは入れ子ノードではなく段落属性として持つ。
   * Word にリストのコンテナは存在せず、numId + ilvl を持つ兄弟段落の並びがリストだから。
   */
  numPr: { numId: number; ilvl: number } | null
  jc: Justification | null
  spacing: ParagraphSpacing | null
  ind: ParagraphIndent | null
  /** w:outlineLvl 0..8。目次生成の元になる */
  outlineLvl: number | null
  keepNext: boolean
  keepLines: boolean
  pageBreakBefore: boolean
  /** w:snapToGrid — 文字数と行数グリッドに吸着させるか。既定は true */
  snapToGrid: boolean
  /** この段落が sectPr を持つ場合、WowdResources.sections のエントリ ID */
  sectionId: string | null
  /** w14:paraId — コメントのスレッド識別子。失うと Word 側で返信関係が壊れる */
  paraId: string | null
  /** 段落マークの書式 (w:pPr/w:rPr)。段落記号自体のフォントなど */
  markRunProps: RunProps | null
  /** 未対応の w:pPr 子要素を元の XML のまま退避する */
  rawPPr: string | null
  /** w:pPrChange (段落書式の変更履歴)。Phase 9 まで読み取り専用で往復させる */
  pPrChange: RevisionMeta | null
}

export interface ParagraphNode {
  type: 'paragraph'
  attrs: ParagraphAttrs
  content?: InlineNode[]
}

// ── インライン ──

export interface TextNode {
  type: 'text'
  text: string
  marks?: Mark[]
}

/** w:ruby — ふりがな。base は w:rubyBase、rt は w:rt */
export interface RubyNode {
  type: 'ruby'
  attrs: {
    /** ふりがな文字列 */
    rt: string
    rubyAlign: 'center' | 'distributeLetter' | 'distributeSpace' | 'left' | 'rightVertical'
    /** ルビ文字のサイズ (half-point) */
    hps: HalfPt | null
    /** ベースラインからの持ち上げ量 */
    hpsRaise: HalfPt | null
    /** ベース文字のサイズ */
    hpsBaseText: HalfPt | null
    /** 言語 ID。通常 "ja-JP" */
    lid: string
    /** ルビ文字側の書式 */
    rtProps: RunProps | null
  }
  content: TextNode[]
}

/** w:tab — Word のタブは空白ではなくコンテンツ。目次のリーダー線に必須 */
export interface TabNode {
  type: 'wTab'
  attrs: Record<string, never>
}

export interface BreakNode {
  type: 'wBreak'
  attrs: { breakType: 'textWrapping' | 'column'; clear: string | null }
}

/** 改ページ。w:br w:type="page" */
export interface PageBreakNode {
  type: 'pageBreak'
  attrs: Record<string, never>
}

export interface SectionBreakNode {
  type: 'sectionBreak'
  attrs: { sectionId: string }
}

/**
 * w:fldSimple / w:fldChar + w:instrText。
 * フィールドはキャッシュ済みの結果を持つ小さな言語。平テキストに潰すと不可逆になる。
 */
export interface FieldNode {
  type: 'field'
  attrs: {
    /** 例: 'PAGE \\* MERGEFORMAT', 'TOC \\o "1-3" \\h \\z \\u' */
    instr: string
    /** 最後に Word が計算した表示文字列 */
    cachedText: string
    /** true なら Word に再計算させる */
    dirty: boolean
  }
}

export interface BookmarkNode {
  type: 'bookmark'
  attrs: { id: string; name: string; isEnd: boolean }
}

export interface ImageNode {
  type: 'image'
  attrs: {
    /** WowdResources.media のキー。例: 'word/media/image1.png' */
    mediaKey: string
    relId: string | null
    cx: Emu
    cy: Emu
    wrap: 'inline' | 'square' | 'tight' | 'topAndBottom' | 'behind' | 'inFront'
    name: string
    descr: string
    inline: boolean
    /** モデル化しきれない w:drawing 全体を退避する */
    rawDrawing: string | null
  }
}

// ── 表 ──

export interface TableWidth {
  /** w:w。type が 'pct' の場合は 1/50 パーセント単位 */
  value: number
  type: 'auto' | 'dxa' | 'pct' | 'nil'
}

export interface BorderSide {
  val: string
  sz: number
  color: string
  space: number
}

export type Borders = Partial<
  Record<'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV', BorderSide>
>

export interface Margins {
  top?: Twip
  bottom?: Twip
  left?: Twip
  right?: Twip
}

export interface TableNode {
  type: 'table'
  attrs: {
    tblStyle: string | null
    tblW: TableWidth | null
    jc: Justification | null
    /** w:tblGrid — 各列の幅 */
    grid: Twip[]
    borders: Borders | null
    cellMar: Margins | null
    layout: 'fixed' | 'autofit'
    rawTblPr: string | null
  }
  content: TableRowNode[]
}

export interface TableRowNode {
  type: 'tableRow'
  attrs: {
    isHeader: boolean
    height: Twip | null
    heightRule: 'auto' | 'exact' | 'atLeast' | null
    cantSplit: boolean
    rawTrPr: string | null
  }
  content: TableCellNode[]
}

export interface TableCellNode {
  type: 'tableCell'
  attrs: {
    /** w:gridSpan */
    colspan: number
    /** w:vMerge から算出した行結合数 */
    rowspan: number
    tcW: TableWidth | null
    vAlign: 'top' | 'center' | 'bottom'
    borders: Borders | null
    shd: string | null
    rawTcPr: string | null
  }
  content: BlockNode[]
}

// ── 未対応要素の退避 ──

/**
 * モデル化していない要素を元の XML 断片のまま保持する。
 * 「対応するまで落とす」ではなく「対応するまで触らない」ための仕組みで、
 * これがあるから未知の Word 機能を含む文書でも壊さずに保存できる。
 */
export interface RawBlockNode {
  type: 'rawBlock'
  attrs: { xml: string; label: string }
}

export interface RawRunNode {
  type: 'rawRun'
  attrs: { xml: string; label: string }
}

// ───────────────────────────── マーク ─────────────────────────────

export interface RunFonts {
  ascii?: string
  eastAsia?: string
  hAnsi?: string
  cs?: string
  hint?: 'default' | 'eastAsia' | 'cs'
  asciiTheme?: string
  eastAsiaTheme?: string
  hAnsiTheme?: string
}

/**
 * w:rPr。和欧混植 (ascii / eastAsia / hAnsi) を単一の font-family に潰してはいけない。
 * 潰すと日本語文書が別物になる。
 */
export interface RunProps {
  rFonts: RunFonts | null
  sz: HalfPt | null
  szCs: HalfPt | null
  color: string | null
  highlight: string | null
  shd: string | null
  /** 文字間隔 */
  spacing: Twip | null
  /** 文字幅の拡大縮小 (%) */
  w: number | null
  /** カーニングを行う最小サイズ */
  kern: HalfPt | null
  vertAlign: 'superscript' | 'subscript' | null
  rStyle: string | null
  lang: { val?: string; eastAsia?: string } | null
  /** 未対応の w:rPr 子要素 */
  rawRPr: string | null
}

export interface RevisionMeta {
  id: number
  author: string
  date: string
}

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline'; attrs: { val: string; color: string | null } }
  | { type: 'strike' }
  | { type: 'doubleStrike' }
  | { type: 'textStyle'; attrs: RunProps }
  | { type: 'link'; attrs: { href: string | null; anchor: string | null; rId: string | null; tooltip: string | null } }
  | { type: 'comment'; attrs: { ids: string[] } }
  | { type: 'insertion'; attrs: RevisionMeta }
  | { type: 'deletion'; attrs: RevisionMeta }

// ───────────────────────── 文書レベルの資源 ─────────────────────────

export interface SectionProps {
  id: string
  pgSz: { w: Twip; h: Twip; orient: 'portrait' | 'landscape' }
  pgMar: {
    top: Twip
    right: Twip
    bottom: Twip
    left: Twip
    header: Twip
    footer: Twip
    gutter: Twip
  }
  cols: { num: number; space: Twip; equalWidth: boolean }
  /**
   * w:docGrid — 「文字数と行数」。
   * charPitch_pt = normalFontSize_pt + charSpace / 4096
   * linesPerPage = floor(textHeight_twip / linePitch)
   */
  docGrid: {
    type: 'default' | 'lines' | 'linesAndChars' | 'snapToChars'
    linePitch: Twip
    charSpace: number
  } | null
  headerRefs: { default?: string; first?: string; even?: string }
  footerRefs: { default?: string; first?: string; even?: string }
  titlePg: boolean
  pgNumType: { start?: number; fmt?: string } | null
  type: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage'
  /** 未対応の w:sectPr 子要素 */
  rawSectPr: string | null
}

export interface StyleDef {
  styleId: string
  type: 'paragraph' | 'character' | 'table' | 'numbering'
  name: string
  basedOn: string | null
  next: string | null
  linkedStyle: string | null
  isDefault: boolean
  /** UI のスタイルギャラリーに出すか (w:qFormat) */
  quickFormat: boolean
  uiPriority: number
  semiHidden: boolean
  pPr: Partial<ParagraphAttrs> | null
  rPr: RunProps | null
  /** スタイル定義まるごとの XML。書き戻しは基本これを使う */
  rawXml: string
}

export interface StyleTable {
  /** w:docDefaults */
  docDefaults: { pPr: Partial<ParagraphAttrs> | null; rPr: RunProps | null }
  byId: Map<string, StyleDef>
  /** type ごとの既定スタイル ID */
  defaults: { paragraph: string | null; character: string | null; table: string | null }
}

export interface NumberingLevel {
  ilvl: number
  start: number
  /** decimal | bullet | aiueoFullWidth | ideographDigital | japaneseCounting など */
  numFmt: string
  /** 例: '%1.' '%1.%2' '・' */
  lvlText: string
  lvlJc: Justification | null
  /** 番号のリセット基準レベル */
  lvlRestart: number | null
  suff: 'tab' | 'space' | 'nothing'
  pPr: Partial<ParagraphAttrs> | null
  rPr: RunProps | null
  /** 箇条書き記号を描くフォント */
  rFonts: RunFonts | null
  isLgl: boolean
}

export interface AbstractNum {
  abstractNumId: number
  nsid: string | null
  multiLevelType: string | null
  levels: Map<number, NumberingLevel>
  rawXml: string
}

export interface NumInstance {
  numId: number
  abstractNumId: number
  /** w:lvlOverride — インスタンス単位のレベル上書き */
  overrides: Map<number, { startOverride: number | null; level: NumberingLevel | null }>
  rawXml: string
}

export interface NumberingTable {
  abstract: Map<number, AbstractNum>
  instances: Map<number, NumInstance>
}

export interface ThemeFonts {
  majorFont: { latin: string; ea: string; cs: string }
  minorFont: { latin: string; ea: string; cs: string }
}

export interface ThemeColors {
  colors: Map<string, string>
}

export interface CommentRecord {
  id: string
  author: string
  initials: string
  date: string
  body: WowdDoc
  /** commentsExtended.xml の paraIdParent から解決したスレッド親 */
  parentId: string | null
  done: boolean
}

export interface RelationshipEntry {
  id: string
  type: string
  target: string
  targetMode: string | null
}

export interface RelationshipTable {
  byId: Map<string, RelationshipEntry>
  /** 新規追加時に衝突しない rId を発番するためのカウンタ */
  nextId: number
}

export interface MediaEntry {
  bytes: Uint8Array
  contentType: string
}

export interface WowdResources {
  sections: SectionProps[]
  styles: StyleTable
  numbering: NumberingTable
  theme: ThemeFonts & ThemeColors
  settings: { defaultTabStop: Twip; trackChanges: boolean; rawXml: string | null }
  comments: Map<string, CommentRecord>
  headers: Map<string, WowdDoc>
  footers: Map<string, WowdDoc>
  media: Map<string, MediaEntry>
  rels: RelationshipTable
  /**
   * 元パッケージの全パートをバイト列のまま保持する。ラウンドトリップの契約そのもの。
   * 保存時はこの Map から始め、実際に変更したパートだけを差し替える。
   */
  rawParts: Map<string, Uint8Array>
  contentTypes: string
  /** officeDocument パートの名前。通常 'word/document.xml' だが常にそうとは限らない */
  documentPartName: string
}

/** アプリが保持する 1 文書ぶんの状態 */
export interface WowdDocument {
  filePath: string | null
  doc: WowdDoc
  resources: WowdResources
  /**
   * 読み込み時に raw 退避へ回った要素のラベル一覧。
   * 空でなければ「完全には扱えない機能が含まれます」と画面に出す。黙って落とさない。
   */
  unsupported: string[]
}
