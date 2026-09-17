/**
 * 日本語 UI 文字列。
 * v1 は日本語優先だが、後から en を足せるように参照は必ずこの辞書経由にする。
 */
export const ja = {
  app: { untitled: '無題', dirtyMark: '*' },
  ribbon: {
    tabs: {
      home: 'ホーム',
      insert: '挿入',
      layout: 'レイアウト',
      references: '参考資料',
      review: '校閲',
      view: '表示'
    },
    groups: {
      clipboard: 'クリップボード',
      font: 'フォント',
      paragraph: '段落',
      styles: 'スタイル',
      editing: '編集'
    },
    bold: '太字',
    italic: '斜体',
    underline: '下線',
    strike: '取り消し線',
    superscript: '上付き',
    subscript: '下付き',
    fontFamily: 'フォント',
    fontSize: 'サイズ',
    fontColor: 'フォントの色',
    highlight: '蛍光ペン',
    clearFormat: '書式のクリア',
    formatPainter: '書式のコピー',
    alignLeft: '左揃え',
    alignCenter: '中央揃え',
    alignRight: '右揃え',
    alignJustify: '両端揃え',
    alignDistribute: '均等割り付け',
    lineSpacing: '行間',
    indentIncrease: 'インデントを増やす',
    indentDecrease: 'インデントを減らす',
    bulletList: '箇条書き',
    numberedList: '段落番号',
    multilevelList: 'アウトライン',
    find: '検索と置換',
    undo: '元に戻す',
    redo: 'やり直し'
  },
  styles: {
    Normal: '標準',
    Title: '表題',
    Heading1: '見出し 1',
    Heading2: '見出し 2',
    Heading3: '見出し 3',
    Heading4: '見出し 4',
    Heading5: '見出し 5',
    Heading6: '見出し 6'
  },
  status: {
    chars: '文字数',
    charsNoSpace: '文字数 (スペースを除く)',
    words: '単語数',
    paragraphs: '段落数',
    ready: '準備完了'
  },
  dialog: {
    ok: 'OK',
    cancel: 'キャンセル',
    close: '閉じる',
    apply: '適用'
  },
  find: {
    title: '検索と置換',
    findLabel: '検索する文字列',
    replaceLabel: '置換後の文字列',
    matchCase: '大文字と小文字を区別する',
    wholeWord: '完全に一致する単語だけ',
    regex: '正規表現',
    normalizeWidth: '全角と半角を区別しない',
    normalizeKana: 'ひらがなとカタカナを区別しない',
    next: '次を検索',
    prev: '前を検索',
    replace: '置換',
    replaceAll: 'すべて置換',
    noMatch: '見つかりませんでした',
    matchCount: (i: number, n: number) => `${n} 件中 ${i} 件目`,
    replacedCount: (n: number) => `${n} 件を置換しました`
  },
  file: {
    openError: 'ファイルを開けませんでした',
    saveError: 'ファイルを保存できませんでした',
    saved: '保存しました',
    unsupportedTitle: 'この文書には Wowd が完全には扱えない機能が含まれます',
    unsupportedBody:
      '該当部分は編集できませんが、保存時には元の内容のまま書き戻されるため失われません。'
  }
} as const

export type Dict = typeof ja
export const t = ja
