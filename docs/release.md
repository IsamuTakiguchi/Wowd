# 配布の手順

## 作るもの

| 環境 | 成果物 | Linux から作れるか |
|---|---|---|
| Windows | `Wowd Setup 0.1.0.exe` (インストーラ) | **作れる** (wine 32bit が要る) |
| Windows | `Wowd-0.1.0-win.zip` (展開して動く持ち運び版) | **作れる** (wine 64bit だけでよい) |
| macOS | `Wowd-0.1.0.dmg` | 作れない |
| Linux | `Wowd-0.1.0.AppImage` / `wowd_0.1.0_amd64.deb` | 作れる |

### Windows の持ち運び版 (zip)

展開して `Wowd.exe` を実行するだけ。インストール不要・管理者権限不要。
**未署名でも SmartScreen の警告が出にくい**ので、試してもらうにはこちらが向く。

Linux から作るには 64bit の wine が要る。アイコンと製品情報を
実行ファイルに埋め込む rcedit が wine を使うため。

```bash
apt-get install -y --no-install-recommends wine64
ln -sf /usr/lib/wine/wine64 /usr/local/bin/wine   # wine の入口を作る
npx electron-builder --win zip
```

### Windows のインストーラ (NSIS)

**32bit の wine が要る。** NSIS はアンインストーラを作るために
生成したインストーラを一度実行するが、その実行ファイルが 32bit のため。
64bit の wine だけでは `failed to load ... syswow64\ntdll.dll` で止まる。

Ubuntu 24.04 では `apt-get install wine32` が通らない。
i386 の依存が壊れていて (`libgd3:i386` が取得できない)
`libc6:i386` すら入らない。

**依存解決を諦めて、必要な 3 つだけを直接入れれば動く。**
wine は必要なライブラリを実行時に遅延読み込みするので、
`libc6:i386` (32bit の ld.so) さえあれば起動する。

```bash
dpkg --add-architecture i386 && apt-get update
mkdir -p /tmp/w32 && cd /tmp/w32
apt-get download libc6:i386 libwine:i386 wine32:i386
dpkg -i --force-depends --force-overwrite *.deb   # 依存は無視してよい
ln -sf /usr/lib/wine/wine /usr/local/bin/wine     # 32bit の入口を使う
/usr/lib/wine/wine --version                      # 動けば成功
npx electron-builder --win nsis
```

`--force-depends` は `libc6:amd64` の処理エラーを出すが、
**64bit 側は壊れない** (展開済みのファイルはそのまま)。
入れたあとに `node --version` が通ることを確かめること。

電子署名だけは、どうやってもここでは付けられない (証明書が要る)。

```bash
npm run package                # いまの環境向け
npx electron-builder --linux
npx electron-builder --win zip # 持ち運び版。wine 64bit があれば作れる
npx electron-builder --win     # インストーラも。wine 32bit が要る
npx electron-builder --mac     # macOS で
```

## 配る

**タグを打つだけでよい。** `.github/workflows/release.yml` が
Windows・macOS・Linux のそれぞれでビルドし、GitHub のリリースに載せる。

```bash
git tag v0.1.0
git push origin v0.1.0
```

各環境でしか作れないもの (Windows の `.exe`、macOS の `.dmg`) も、
それぞれのランナーが作るので手元の環境に縛られない。

同じタグで作り直すときは、タグを消してから打ち直す
(ワークフローは同名のリリースがあれば消してから作る)。

```bash
git push --delete origin v0.1.0 && git tag -d v0.1.0
```

手動実行 (Actions の「Run workflow」) もできる。
**既定ブランチにこのファイルがある場合だけ**ボタンが出る (GitHub の仕様) で、
いまは入っているので出る。タグ名を入力すると、
ワークフローの中でそのタグごとリリースを作る。

タグを push できない環境 (権限の無い場所からの作業) では、
手動実行の方がむしろ確実。タグを打つのはランナー側の仕事になる。

### なぜ手で配らないか

成果物は 100MB 前後あり、メールにもチャットにも載らない。
リリースに置けば URL 1 本で渡せて、
更新の確認 (ヘルプ →「更新を確認...」) も同じ場所を見る。

### 大きさ

`electron-builder.yml` で 2 つ絞っている。

- `compression: maximum` … LZMA の圧縮率を上げる。ビルドは遅くなるが配布は 1 回きり
- `electronLanguages: [ja, en-US]` … Electron は既定で 50 以上の言語の翻訳を同梱する

この 2 つで Windows のインストーラは 107MB から 99MB になった。
**これ以上は大きく減らせない。**残りはほぼ Chromium の実体で、
Electron アプリである以上は避けられない。

## アイコン

`resources/icon.png` (1024x1024) の 1 枚だけを置く。
Windows の `.ico` と macOS の `.icns` は electron-builder が起こす。

原本は `resources/icon.svg`。直したら作り直す:

```bash
npm run icon
```

## テンプレートの置き場所に注意

新規文書のテンプレート (`resources/templates/*.docx`) は
**asar の外**に置く必要がある。`electron-builder.yml` の `extraResources` がそれ。

`files` に入れると asar の中 (`resources/app.asar/resources/templates`) に入るが、
本体は `process.resourcesPath/templates` を見るので見つからず、
**パッケージ版でだけ「新規作成」が失敗する。**
開発時は別の枝を通るので、単体テストにも E2E にも映らない。

この食い違いは `tests/unit/packaging.test.ts` が見ている。

## 電子署名

**署名しなくても動くが、利用者に警告が出る。**

| | 無いとどうなるか | 要るもの |
|---|---|---|
| Windows | SmartScreen が「発行元不明」と警告する。実行はできる | Authenticode 証明書 (OV または EV) |
| macOS | Gatekeeper が起動を止める。右クリック→開く で回避はできる | Apple Developer Program (年額) と Developer ID 証明書 |

どちらも**本人確認と支払いが要る**ので、取得は利用者本人の手続きになる。

取得できたら、証明書そのものはリポジトリに置かず環境変数で渡す:

```bash
# Windows
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD='...'

# macOS (公証まで行う場合)
export APPLE_ID='...'
export APPLE_APP_SPECIFIC_PASSWORD='...'
export APPLE_TEAM_ID='...'
```

`electron-builder.yml` の `mac.hardenedRuntime: true` は公証の前提なので入れてある。

## 更新の確認

ヘルプ →「更新を確認...」で GitHub のリリースを 1 つ引き、
新しい版があれば配布ページを開く。

**自動では確認しない。**起動のたびに黙って外部へ接続するかどうかは
利用者が選ぶことなので、メニューから選んだときだけ問い合わせる。

**落とし込みと入れ替えまではしない。**未署名の実行ファイルを自動で差し替えると、
Windows は毎回 SmartScreen が出て、macOS は Gatekeeper が起動を止める。
そこまで進めるのは署名証明書が用意できてから。

リポジトリが非公開のあいだ、またはリリースが 1 つも無いあいだは
「確認できませんでした」と出る。これは異常ではない。

## リリースする

1. `package.json` の `version` を上げる
2. `npm run lint && npm run typecheck && npm test && npm run build`
3. `xvfb-run -a npx playwright test`
4. 各環境で `npm run package`
5. GitHub のリリースを作り、成果物を添付する
6. **実機 Word での確認** (`docs/word-verification.md`)。
   `.docx` の読み書きに手を入れた版では必ず行う。
   規格検証を通ることと Word が開けることは別物で、
   実際にそれで 2 度つまずいている
