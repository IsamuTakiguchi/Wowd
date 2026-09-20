# 配布の手順

## 作るもの

| 環境 | 成果物 | 作る場所 |
|---|---|---|
| Windows | `Wowd Setup 0.1.0.exe` (NSIS) | Windows |
| macOS | `Wowd-0.1.0.dmg` | macOS |
| Linux | `Wowd-0.1.0.AppImage` / `wowd_0.1.0_amd64.deb` | Linux |

**電子署名も含め、その環境でしか作れないものがある。**
Windows の `.exe` は Windows で、macOS の `.dmg` は macOS で作る。
Linux 版だけは他の環境からでも作れる。

```bash
npm run package            # いまの環境向け
npx electron-builder --linux
npx electron-builder --win     # Windows で
npx electron-builder --mac     # macOS で
```

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
