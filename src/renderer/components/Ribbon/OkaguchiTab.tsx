import type { Editor } from '@tiptap/react'
import { RibbonButton, RibbonGroup, RibbonRow } from './parts'
import { useUiStore, type DialogKind } from '../../store/ui'
import { applyRank, restartRank, setupRankStyles, fixRankHalfWidth } from '../../okaguchi/rank'

/** ランクごとの番号の形。ボタンの表示に使う */
export const RANK_GLYPHS = ['第１', '１', '⑴', 'ア', '(ア)', 'a', '(a)', '①']

/**
 * 岡口マクロのタブ。元のマクロのキー (Alt+…) と同じ操作をボタンでも行えるようにする。
 * キーはボタンの説明 (ツールチップ) に書く。
 */
export function OkaguchiTab({ editor }: { editor: Editor | null }): React.JSX.Element {
  const openDialog = useUiStore((s) => s.openDialog)
  const disabled = !editor
  const dialog = (kind: DialogKind) => (): void => openDialog(kind)

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="連番ランク">
        <RibbonRow>
          <RibbonButton
            label="設定"
            title="連番ランク設定 (Alt+R): スタイル「本文０〜８」「ランク１〜８」と番号を用意します"
            disabled={disabled}
            onClick={() => editor && setupRankStyles(editor)}
          />
          <RibbonButton
            label="10以上を半角"
            title="連番ランク修正 (Alt+Shift+R): ランク１・２で 10 以上になった番号を半角にします"
            wide
            disabled={disabled}
            onClick={() => editor && fixRankHalfWidth(editor)}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="事後設定"
            title="連番等事後設定 (Alt+J): 手で打った見出し符号を連番ランクに置き換えます"
            wide
            disabled={disabled}
            onClick={dialog('okaguchiPostSet')}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="見出し (ランク) / 打直">
        <RibbonRow>
          {RANK_GLYPHS.map((glyph, i) => (
            <RibbonButton
              key={glyph}
              label={glyph}
              title={`ランク${i + 1} (Alt+${i + 1}): 見出し ⇔ 本文 を切り替えます`}
              disabled={disabled}
              onClick={() => editor && applyRank(editor, i + 1)}
            />
          ))}
        </RibbonRow>
        <RibbonRow>
          {RANK_GLYPHS.map((glyph, i) => (
            <RibbonButton
              key={glyph}
              label={<span className="okaguchi-restart">{glyph}</span>}
              title={`ランク${i + 1} 打直 (Alt+Shift+${i + 1}): 番号を 1 から振り直します`}
              disabled={disabled}
              onClick={() => editor && restartRank(editor, i + 1)}
            />
          ))}
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="入力">
        <RibbonRow>
          <RibbonButton label="日付" title="日付入力 (Alt+T)" disabled={disabled} onClick={dialog('okaguchiDate')} />
          <RibbonButton label="(1)" title="全角1文字入力 (Alt+Z): (1) (a) (ｱ) を全角 1 字分に収めます" disabled={disabled} onClick={dialog('okaguchiWide')} />
          <RibbonButton label="利息" title="利息・日付計算 (Alt+C)" disabled={disabled} onClick={dialog('okaguchiInterest')} />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton label="当事者" title="当事者欄作成・自然人と代理人 (Alt+M)" wide disabled={disabled} onClick={dialog('okaguchiPerson')} />
          <RibbonButton label="法人" title="当事者欄作成・法人 (Alt+K)" disabled={disabled} onClick={dialog('okaguchiCorp')} />
          <RibbonButton label="物件" title="物件情報入力 (Alt+B): 物件目録を作ります" disabled={disabled} onClick={dialog('okaguchiProperty')} />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="書式">
        <RibbonRow>
          <RibbonButton
            label="裁判所書式"
            title="書式変更 (Alt+P): A4・37 字 × 26 行・12pt にします"
            wide
            disabled={disabled}
            onClick={dialog('okaguchiFormat')}
          />
        </RibbonRow>
      </RibbonGroup>
    </div>
  )
}
