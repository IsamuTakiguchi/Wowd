# Wowd

Microsoft Word ライクな日本語文書エディタ (Electron デスクトップアプリ)。

実在の `.docx` を開いて編集し、保存しても**元の文書を壊さない**ことを最優先に作っている。

## いまできること

| | 状態 |
|---|---|
| `.docx` を開く / 保存する | ✅ |
| 文字書式 (太字・斜体・下線・取り消し線・サイズ・色・蛍光ペン・上付き下付き・和欧混植フォント) | ✅ |
| 段落書式 (配置・行間・インデント・見出しスタイル) | ✅ |
| 箇条書き / 段落番号 (日本語書式を含む複数レベル) | ✅ |
| 元に戻す / やり直し | ✅ |
| 検索と置換 (正規表現・全角半角・ひらがなカタカナの正規化) | ✅ |
| 用紙サイズと向きの変更 | ✅ |
| ページ表示・印刷 / PDF 出力 | 未実装 |
| ルビ・文字数と行数 (原稿用紙) | 読み書きは対応済み、UI は未実装 |
| 表・画像・ヘッダー/フッター・目次 | 読み書きは対応済み、UI は未実装 |
| コメント・変更履歴 | 読み書きは対応済み、UI は未実装 |

**未実装の機能を含む文書も安全に扱える。** 該当部分は編集こそできないが、
保存時に元の内容がそのまま書き戻される。

## 開発

```bash
npm install
npm run fixtures                    # テスト用 .docx を生成
npx tsx scripts/make-templates.ts   # 新規作成用テンプレートを生成
npm run dev                         # アプリを起動

npm test                            # 単体テスト
npm run e2e                         # E2E (Linux では xvfb-run が必要)
npm run lint
npm run typecheck
npm run verify:roundtrip -- <file.docx>   # 実ファイルのラウンドトリップを目視確認
```

## 設計上の要点

読む前に知っておくと全体が理解しやすい判断が 4 つある。

### 1. パッケージ保存型ラウンドトリップ

`.docx` を開いたら**全パートをバイト列のまま保持し続け**、保存時は
実際に変更したパートだけを差し替える。

生成型のライブラリは自分のモデルからパッケージを組み立て直すので、
知らないパート (`theme1.xml`、rsid 付きの `settings.xml`、`customXml/`、
`fontTable.xml` など) を全部落としてしまう。顧客のファイルを開いて保存したら
壊れる、は製品として成り立たない。

本文の中でも、モデル化していない要素は `rawBlock` / `rawRun` /
`rawPPr` / `rawRPr` に原文のまま退避して書き戻す。
**preserve by default, model by exception.**

### 2. リストは入れ子ノードではなく段落属性

Word にリストのコンテナは存在しない。リストとは `w:numPr`
(`numId` + `ilvl`) を持つ**兄弟段落の並び**で、見た目は全部
`numbering.xml` にある。

`bulletList > listItem > paragraph` で持つと、実際の Word 文書に頻出する
非単調な `ilvl` の並びが import → export で壊れる。
そのため行頭記号は文書本体に入れず、ProseMirror の Decoration として重ねている。

### 3. 単位は OOXML ネイティブのまま

twip (1/20pt)、half-point、EMU のまま保持し、CSS px への変換は
描画の直前だけで行う。途中で px に落とすと丸め誤差がそのまま
ラウンドトリップの差分になる。

### 4. 解析はレンダラ側のワーカー

main プロセスではなくレンダラの Web Worker で動かす。
main が固まるとメニューバーもウィンドウ操作も全部固まるが、
ワーカーなら何も固まらない。最高権限の main に XML パーサを置かないのは
単純に衛生的でもある。

## ディレクトリ

```
src/core/      DOM 非依存・Electron 非依存。モデルと .docx の読み書き。単体テストはここが中心
src/main/      ウィンドウ、ネイティブメニュー、ファイル IO (アトミック書き込み)
src/preload/   contextBridge。ipcRenderer を書いてよい唯一の場所
src/renderer/  React + TipTap の UI
```

## 検証について

`.docx` の忠実性は 3 つの自動テストで担保している。

1. 書き出したパッケージのパート一覧が元の上位集合であること
2. 書き換えていないパートがバイト一致すること
3. `read(write(read(f))) === read(f)` (冪等ラウンドトリップ)

**ただし実機の Microsoft Word での確認は未実施。** 開発環境に Word が無く、
`soffice` も生成元ライブラリが吐いた無編集の `.docx` すら読めないため、
現状は zip の整合性・XML の整形式・全パートの保存までしか確認できていない。

実際の Word で作った `.docx` を `tests/fixtures/docx/real-*.docx` として置けば、
上記のテストが自動的に拾う。許容済みの差分は `docs/round-trip-report.md` にある。

## ライセンス

MIT
