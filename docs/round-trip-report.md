# ラウンドトリップ差分の記録

`.docx` を開いて無編集で保存したとき、元ファイルと出力に生じる差分のうち
**意図的で問題のないもの**をここに列挙する。

**ここに書かれていない差分はバグとして扱う。**

## 検証手順

```bash
npm run fixtures                      # フィクスチャ生成
npm test                              # 自動ラウンドトリップテスト
npm run verify:roundtrip <file.docx>  # パッケージとXMLの差分を目視確認
```

最終ゲートは実機の Microsoft Word で開き、「問題を修復しますか」が出ないこと。
これは人手でしか確認できない。

## 許容済みの差分

### 1. zip コンテナのバイト列

deflate の実装が異なるため、圧縮後のバイト列は元ファイルと一致しない。
保証しているのは **各パートの中身が 1 バイトも変わらないこと**。
自動テストはパートを展開してから比較している。

タイムスタンプは再現可能性のため 1980-01-02 に固定している。

### 2. `xml:space="preserve"` の有無

Wowd は **空白を含むテキストにだけ** `xml:space="preserve"` を付ける。
一部の生成ライブラリ (テストフィクスチャを作っている `docx` パッケージなど) は
空白を含まないテキストにも無条件で付けるため、そこが差分になる。

`xml:space` は前後の空白の扱いだけを左右する属性なので、
空白を含まないテキストでは付いていても付いていなくても意味は同じ。

### 3. 属性の並び順

`<w:spacing w:after="120" w:before="120"/>` と
`<w:spacing w:before="120" w:after="120"/>` のように、属性の出力順が変わることがある。
XML では属性の順序に意味が無いため問題ない。
(子要素の順序は意味を持つので、そちらは `src/core/docx/write/order.ts` の
順序テーブルで厳密に制御している。)

### 4. `document.xml` の整形

Wowd は要素間に改行やインデントを入れない。
元ファイルが整形されていた場合は差分になるが、WML の意味は変わらない。

### 5. 段落記号の書式 (`w:pPr/w:rPr`) の子要素順

段落記号自体の書式は解釈せず、原文のまま退避して書き戻す。
画面にも保存内容にも効かない飾りなので、モデル化する意味が無いため。

ただし `w:ins` / `w:del` (段落記号そのものの挿入・削除) だけは取り分けて
モデル化する。承諾や取り消しの対象にできる必要があるため。
書き戻すときは `CT_ParaRPr` の規定どおり `w:rPr` の先頭に置く。

### 6. 書き換えるパートの範囲

保存時に書き直すのは次のパートだけで、ほかはバイト列のまま通す。

| パート | 書き直す条件 |
|---|---|
| `word/document.xml` | 常に |
| `word/numbering.xml` | リストやスタイルを編集したとき |
| `word/comments.xml` | コメントを編集したとき |
| `word/commentsExtended.xml` | 同上。無ければパート・リレーション・Content_Types の項目ごと作る |

| `word/header*.xml` / `word/footer*.xml` | ヘッダー / フッターを編集したとき |
| `word/media/*` | 画像を挿入したとき (関係と Content_Types も足す) |

ヘッダー / フッターは、編集していなければ**書き直さない**。
読み込んだ内容がバイト列のまま書き戻される。

## 未検証の項目

この開発環境には Microsoft Word が無い。

LibreOffice 24.2 は入っているが**壊れている**。`.docx` どころか
プレーンな `.txt` の変換すら `source file could not be loaded` で失敗する
(`soffice --headless --convert-to pdf t.txt`)。Wowd の出力とは無関係の
環境側の問題なので、独立した第 2 実装としては使えない。
再調査の手間を省くためここに記録しておく。

したがって現時点で確認できているのは以下まで:

- zip の整合性 (`unzip -t`)
- 全 XML パートが整形式であること
- 全パートが保存されていること (footnotes / endnotes / comments / fontTable /
  docProps / settings を含む 18 パートすべて)
- 冪等ラウンドトリップ (`read(write(read(f))) === read(f)`)
- エディタ経由の往復 (開く → ProseMirror → 保存 → 開き直す)
- 変更履歴の不変条件 (すべて承諾 = 記録しない場合 / すべて取り消し = 編集前)
- 画面のページ数と PDF のページ数の一致
- WML の子要素順序が順序テーブルどおりであること (`tests/unit/order.test.ts`)
- ECMA-376 の公式 XSD に当てて規格違反が無いこと (`tests/unit/schemaValidation.test.ts`)
- パッケージ全体の参照グラフが閉じていること (`tests/unit/packageIntegrity.test.ts`)
- 壊れた / 悪意のある .docx で落ちないこと (`tests/unit/hostileInput.test.ts`)

**実機 Word での確認は未実施。** 手順とチェックリストは
`docs/word-verification.md` にある。確認用ファイルは `npm run word-check` で生成する。

特に確かめたいのは次の 3 点。いずれもこの環境では原理的に検証できない。

1. Word が「問題を修復しますか」を出さずに開けること
2. 変更履歴の赤入りが Word の校閲画面に正しく出ること
   (段落記号の `w:ins` / `w:del` を含む)
3. コメントのスレッドと解決状態が Word 側でも保たれること
   (`w14:paraId` による結び付け)

### スキーマ検証について

`npm run schema:fetch` で ECMA-376 5th edition **Part 4** の
`OfficeOpenXML-XMLSchema-Transitional.zip` を取得する。
Wowd が書くのは Transitional (`.../wordprocessingml/2006/main`) で、
Part 1 に入っているのは Strict (`purl.oclc.org` 系) なので使えない。

検証の前に MCE (Markup Compatibility) の前処理をする。
`mc:Ignorable` に挙がった接頭辞の要素と属性を落としてから当てる。
`w14:paraId` のような Microsoft 拡張は ECMA-376 の XSD が知らないので、
落とさずに当てると**正しいファイルが不合格になる**。

契約は「違反ゼロ」ではなく **「保存して違反が増えないこと」**。
Wowd は未対応の要素を原文のまま書き戻すので、元が規格外なら出力も規格外になる。
それは忠実さであって不具合ではない。罰すると
「規格に合わせるために中身を捨てる」方向に歪む。

### 順序違反という壊れ方について

ECMA-376 の `CT_PPr` / `CT_SectPr` / `CT_Settings` などは xsd:sequence なので、
子要素の順序は「推奨」ではなく必須。**順序違反は往復テストでは検出できない。**
読み直したモデルは順序が違っても同じになるため。

実際に `SECTPR_ORDER` から `w:headerReference` が漏れており、ヘッダーを持つ
全文書が規定違反の順序で書き出されていた。`emitOrdered` は現在、
順序テーブルに無いタグをモデルが出そうとしたら例外を投げる
(原文のまま退避した断片だけは従来どおり末尾に流す)。
