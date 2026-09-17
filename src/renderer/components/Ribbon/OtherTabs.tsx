import type { Editor } from '@tiptap/react'
import { RibbonGroup, RibbonRow, RibbonButton, RibbonSelect } from './parts'
import { useDocumentStore } from '../../store/document'
import { useUiStore, MIN_ZOOM, MAX_ZOOM } from '../../store/ui'
import { twipToMm, mmToTwip } from '@shared/units'
import type { SectionProps } from '@core/model/types'

/** 用紙サイズのプリセット (mm) */
const PAPER_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  { id: 'b5', label: 'B5 (182 × 257 mm)', w: 182, h: 257 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', w: 148, h: 210 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 297, h: 420 },
  { id: 'letter', label: 'レター (216 × 279 mm)', w: 215.9, h: 279.4 }
]

function matchPaper(section: SectionProps): string {
  const w = twipToMm(section.pgSz.w)
  const h = twipToMm(section.pgSz.h)
  const found = PAPER_SIZES.find((p) => Math.abs(p.w - w) < 2 && Math.abs(p.h - h) < 2)
  return found?.id ?? 'custom'
}

export function InsertTab({ editor }: { editor: Editor | null }): React.JSX.Element {
  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="ページ">
        <RibbonRow>
          <RibbonButton
            label="改ページ"
            title="改ページを挿入する (Ctrl+Enter)"
            wide
            disabled={!editor}
            onClick={() => editor?.commands.insertContent({ type: 'pageBreak' })}
          />
        </RibbonRow>
      </RibbonGroup>
      <PendingGroup label="表・画像・ヘッダー" items={['表の挿入', '画像の挿入', 'ヘッダーとフッター', 'ページ番号']} />
    </div>
  )
}

export function LayoutTab(): React.JSX.Element {
  const document = useDocumentStore((s) => s.document)
  const markDirty = useDocumentStore((s) => s.markDirty)
  const section = document?.resources.sections[0] ?? null

  const update = (patch: (s: SectionProps) => void): void => {
    if (!document || !section) return
    patch(section)
    markDirty()
  }

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="ページ設定">
        <RibbonRow>
          <RibbonSelect
            title="用紙サイズ"
            width={180}
            value={section ? matchPaper(section) : 'a4'}
            options={[...PAPER_SIZES.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'ユーザー設定' }]}
            onChange={(id) => {
              const paper = PAPER_SIZES.find((p) => p.id === id)
              if (!paper) return
              update((s) => {
                s.pgSz.w = mmToTwip(paper.w)
                s.pgSz.h = mmToTwip(paper.h)
              })
            }}
          />
          <RibbonSelect
            title="印刷の向き"
            width={80}
            value={section?.pgSz.orient ?? 'portrait'}
            options={[
              { value: 'portrait', label: '縦' },
              { value: 'landscape', label: '横' }
            ]}
            onChange={(orient) =>
              update((s) => {
                if (orient === s.pgSz.orient) return
                const { w, h } = s.pgSz
                s.pgSz.w = h
                s.pgSz.h = w
                s.pgSz.orient = orient
              })
            }
          />
        </RibbonRow>
        <RibbonRow>
          <span className="ribbon-readout">
            {section
              ? `余白 上${round(twipToMm(section.pgMar.top))} 下${round(twipToMm(section.pgMar.bottom))} 左${round(twipToMm(section.pgMar.left))} 右${round(twipToMm(section.pgMar.right))} mm`
              : '—'}
          </span>
        </RibbonRow>
      </RibbonGroup>
      <PendingGroup label="日本語の体裁" items={['文字数と行数', '原稿用紙の設定', 'ルビ']} />
    </div>
  )
}

export function ViewTab(): React.JSX.Element {
  const zoom = useUiStore((s) => s.zoom)
  const setZoom = useUiStore((s) => s.setZoom)
  const nudgeZoom = useUiStore((s) => s.nudgeZoom)

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="ズーム">
        <RibbonRow>
          <RibbonButton label="−" title="縮小" onClick={() => nudgeZoom(-10)} />
          <RibbonSelect
            title="表示倍率"
            width={80}
            value={zoom}
            options={[50, 75, 100, 125, 150, 200, 300]
              .filter((z) => z >= MIN_ZOOM && z <= MAX_ZOOM)
              .map((z) => ({ value: z, label: `${z}%` }))}
            onChange={setZoom}
          />
          <RibbonButton label="＋" title="拡大" onClick={() => nudgeZoom(10)} />
          <RibbonButton label="100%" title="等倍に戻す" onClick={() => nudgeZoom(0)} />
        </RibbonRow>
      </RibbonGroup>
      <PendingGroup label="表示モード" items={['印刷レイアウト (ページ表示)', 'ページ罫線', '原稿用紙マス目']} />
    </div>
  )
}

export function ReferencesTab(): React.JSX.Element {
  return (
    <div className="ribbon-tab-body">
      <PendingGroup label="目次" items={['目次の挿入', '目次の更新', '見出しへの移動']} />
    </div>
  )
}

export function ReviewTab(): React.JSX.Element {
  return (
    <div className="ribbon-tab-body">
      <PendingGroup
        label="コメントと変更履歴"
        items={['新しいコメント', '変更履歴の記録', '承諾 / 元に戻す', '変更箇所の表示']}
      />
    </div>
  )
}

/**
 * 未実装の機能は、それらしいボタンを並べて押しても何も起きないより、
 * 何が未実装かを明示する。読み込んだ文書の該当データは保持され続ける。
 */
function PendingGroup({ label, items }: { label: string; items: string[] }): React.JSX.Element {
  return (
    <RibbonGroup label={label}>
      <div className="ribbon-pending">
        <div className="ribbon-pending-title">未実装</div>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="ribbon-pending-note">
          文書に含まれるこれらのデータは保持され、保存時にそのまま書き戻されます。
        </div>
      </div>
    </RibbonGroup>
  )
}

function round(v: number): number {
  return Math.round(v * 10) / 10
}
