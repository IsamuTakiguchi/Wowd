# ブラウザ版 (スマホを含む)

同じ画面を、Electron ではなくブラウザで動かしたもの。
iPhone / Android のブラウザで開き、「ホーム画面に追加」で使う。
PC のブラウザでも動くので、署名の問題がある macOS の人に配る手段にもなる。

```bash
npm run web:build      # dist-web/ に静的ファイルを出す
npm run web:preview    # http://localhost:4173 で配る (LAN からも開ける)
npm run test:web       # ブラウザ版の E2E (PC と Pixel 7 の設定)
```

## 作り

画面のコード (`src/renderer`) と文書のコード (`src/core`) は Electron 版と**完全に同じ**。
違うのは 2 つだけ。

| | Electron 版 | ブラウザ版 |
|---|---|---|
| 入口の HTML | `src/renderer/index.html` | `web/index.html` (viewport と PWA の指定) |
| OS の機能 | `src/main` (Node) + `src/preload` | `src/renderer/platform/web.ts` (ブラウザの API だけで賄う) |

画面側は `src/renderer/platform` の `platform` だけを見る。
Electron の中なら preload が置いた `window.wowd` を、無ければブラウザ版の実装を使う。
画面側のコードは両者を区別しない。区別すると、ブラウザ版でしか出ない
不具合が Electron 版のテストに映らなくなる。

## ブラウザには無いもの、どう補うか

| 機能 | Electron 版 | ブラウザ版 |
|---|---|---|
| 開く | OS のダイアログ | `<input type=file>`。スマホでは「ファイル」アプリやクラウドから選べる |
| 保存 | 元の場所へ上書き | **共有シート** (スマホ) / 名前を付けて保存 (PC の Chrome) / ダウンロード (それ以外) |
| パス | ある | **無い**。代わりにファイル名で通す。開いた / 保存した中身は IndexedDB に控えるので、名前だけで開き直せる (最近使ったファイル) |
| 自動保存の控え | userData のファイル | IndexedDB |
| PDF | Electron の printToPDF | ブラウザの印刷。印刷画面から「PDF として保存」できる |
| メニュー | ネイティブ | 無い。リボンの左上に**開く / 保存 / 新規 / 印刷**を出す。PC ではショートカット (Ctrl+O / Ctrl+S / Ctrl+P / Ctrl+F) も効く |
| 未保存の確認 | 終了時にダイアログ | タブを閉じる前に `beforeunload` で確認 |

**保存が「上書き」でないことは伝えておく必要がある。**
スマホでは共有シートから「ファイルに保存」を選ぶ形になるので、
元のファイルと同じ場所に自動では戻らない。

## 確かめたこと、確かめていないこと

Chromium (PC の設定と Pixel 7 の設定) で、起動・開く・編集・保存・開き直し・
紙の外を押しても打てること・横にはみ出さないことを自動で確かめている。

**iPhone (WebKit) はこの環境に無い。** 日本語入力の変換 (contenteditable と IME) は
ブラウザごとに癖があり、iPhone の Safari では実機でしか分からない。
デスクトップ版と同じく「実機で出て当然」の壁がここにもある。

## 置き場所

静的なファイルだけなので、どこに置いても動く。`base: './'` にしてあるので、
`/` 直下でなくても (GitHub Pages の `/Wowd/` のような場所でも) 動く。

| 置き場所 | 向く場面 | 注意 |
|---|---|---|
| GitHub Pages | 手軽。URL 1 本で配れる | **非公開リポジトリでは有料プランが要る** |
| 事務所のサーバ | 外に出したくない | https でないと共有シートや PWA が効かない |
| 手元の PC (`web:preview`) | まず触ってみる | 同じ Wi-Fi のスマホから `http://<PC の IP>:4173` で開ける。https でないので共有シートは使えず、ダウンロードになる |
