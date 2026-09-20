/**
 * 未対応要素を、利用者に分かる名前に直す。
 *
 * 生のタグ名 (w:footnoteReference) を並べても、何が起きているのか伝わらない。
 * 「脚注」と出して初めて、確認すべき箇所が分かる。
 *
 * **ここに無いものはタグ名のまま出す。**黙って隠すより、
 * 見慣れない名前でも出ているほうがよい。名前が分からないのは
 * こちらの手落ちであって、利用者に知らせない理由にはならない。
 */
const LABELS: Record<string, string> = {
  'w:footnoteReference': '脚注',
  'w:endnoteReference': '文末脚注',
  'w:annotationRef': '注釈の参照',
  'w:sdt': 'コンテンツ コントロール',
  'w:object': '埋め込みオブジェクト',
  'w:pict': '図形 (VML)',
  'w:fldSimple': 'フィールド',
  'w:smartTag': 'スマート タグ',
  'w:customXml': 'カスタム XML',
  'w:subDoc': 'サブ文書',
  'w:contentPart': '外部コンテンツ',
  'm:oMath': '数式',
  'm:oMathPara': '数式',
  'w:drawing': '図',
  'w:moveFrom': '移動元 (変更履歴)',
  'w:moveTo': '移動先 (変更履歴)'
}

/**
 * レイアウトに反映できない指定。
 *
 * 要素としては読めていて保存でも戻るが、**画面に描けない**もの。
 * 読み取り側の未対応一覧とは性質が違うので、説明も分けて持つ。
 */
export const LAYOUT_LIMITS = {
  columns: '段組み (1 段で表示します)',
  footnotePlacement: '脚注の配置 (本文の流れの中に置きます)'
} as const

export function unsupportedLabel(tag: string): string {
  return LABELS[tag] ?? tag
}

/** 同じ名前に落ちるものをまとめる。「脚注」が 2 つ並ばないように */
export function unsupportedLabels(tags: readonly string[]): string[] {
  return [...new Set(tags.map(unsupportedLabel))].sort()
}
