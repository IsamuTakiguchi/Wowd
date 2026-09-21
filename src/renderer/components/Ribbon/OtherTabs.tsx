import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { RibbonGroup, RibbonRow, RibbonButton, RibbonSelect } from './parts'
import { useDocumentStore } from '../../store/document'
import { useUiStore, MIN_ZOOM, MAX_ZOOM } from '../../store/ui'
import { gridFromSection, normalSizeOf } from '@core/layout/grid'
import { insertTable, tableCommands, textWidthOf } from '../../editor/commands/table'
import { registerImage, insertImage, textWidthEmu } from '../../editor/commands/image'
import { insertOrUpdateToc } from '../../editor/commands/toc'
import { twipToMm, mmToTwip } from '@shared/units'
import type { SectionProps } from '@core/model/types'
import { platform } from '../../platform'

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
  const openDialog = useUiStore((s) => s.openDialog)
  const document_ = useDocumentStore((s) => s.document)
  const section = document_?.resources.sections[0] ?? null
  const inTable = editor?.isActive('table') ?? false
  const commands = editor ? tableCommands(editor) : null

  /**
   * 画像を選んで挿入する。
   *
   * バイト列・関係・本文のノードを一度に足す。どれか 1 つでも欠けると
   * Word 側で画像が見つからず、開いたときに空欄になる。
   */
  const addImage = async (): Promise<void> => {
    if (!editor || !document_ || !section) return
    try {
      const picked = await platform.pickImage()
      if (!picked) return
      const image = registerImage(
        document_,
        picked,
        textWidthEmu(section.pgSz.w, section.pgMar.left + section.pgMar.gutter, section.pgMar.right)
      )
      insertImage(editor, image, picked.name)
      // 資源を直接書き換えたので、保存が必要なことを知らせる
      useDocumentStore.getState().markDirty()
    } catch (err) {
      useDocumentStore
        .getState()
        .setError(
          `画像を挿入できませんでした: ${err instanceof Error ? err.message : String(err)}`
        )
    }
  }

  const addTable = (rows: number, cols: number) => (): void => {
    if (!editor || !section) return
    insertTable(
      editor,
      rows,
      cols,
      textWidthOf(section.pgSz.w, section.pgMar.left + section.pgMar.gutter, section.pgMar.right)
    )
  }

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="日本語">
        <RibbonRow>
          <RibbonButton
            label="ルビ"
            title="選択した文字列にふりがなを付ける"
            wide
            disabled={!editor}
            onClick={() => openDialog('ruby')}
          />
        </RibbonRow>
      </RibbonGroup>
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
      <RibbonGroup label="表">
        <RibbonRow>
          <RibbonButton
            label="2 × 2"
            title="2 行 2 列の表を挿入する"
            disabled={!editor || !section}
            onClick={addTable(2, 2)}
          />
          <RibbonButton
            label="3 × 3"
            title="3 行 3 列の表を挿入する"
            disabled={!editor || !section}
            onClick={addTable(3, 3)}
          />
          <RibbonButton
            label="5 × 3"
            title="5 行 3 列の表を挿入する"
            disabled={!editor || !section}
            onClick={addTable(5, 3)}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="行+"
            title="下に行を追加する"
            disabled={!inTable}
            onClick={() => commands?.addRowAfter()}
          />
          <RibbonButton
            label="行−"
            title="行を削除する"
            disabled={!inTable}
            onClick={() => commands?.deleteRow()}
          />
          <RibbonButton
            label="列+"
            title="右に列を追加する"
            disabled={!inTable}
            onClick={() => commands?.addColumnAfter()}
          />
          <RibbonButton
            label="列−"
            title="列を削除する"
            disabled={!inTable}
            onClick={() => commands?.deleteColumn()}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="結合"
            title="選択したセルを結合する"
            disabled={!inTable}
            onClick={() => commands?.mergeCells()}
          />
          <RibbonButton
            label="分割"
            title="結合したセルを分割する"
            disabled={!inTable}
            onClick={() => commands?.splitCell()}
          />
          <RibbonButton
            label="表を削除"
            title="表を削除する"
            wide
            disabled={!inTable}
            onClick={() => commands?.deleteTable()}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="画像">
        <RibbonRow>
          <RibbonButton
            label="画像を挿入"
            title="画像ファイルを選んで本文に挿入する"
            wide
            disabled={!editor || !document_ || !section}
            onClick={() => void addImage()}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="ヘッダーとフッター">
        <RibbonRow>
          <RibbonButton
            label="ヘッダーとフッター"
            title="ヘッダーとフッターを編集する"
            wide
            disabled={!document_ || !section}
            onClick={() => openDialog('headerFooter')}
          />
        </RibbonRow>
      </RibbonGroup>
    </div>
  )
}

export function LayoutTab(): React.JSX.Element {
  const document = useDocumentStore((s) => s.document)
  const updateSection = useDocumentStore((s) => s.updateSection)
  const openDialog = useUiStore((s) => s.openDialog)
  const section = document?.resources.sections[0] ?? null

  const update = (patch: (s: SectionProps) => SectionProps): void => {
    updateSection(0, patch)
  }

  const grid = section
    ? gridFromSection(section, normalSizeOf(document?.resources.styles.docDefaults.rPr?.sz))
    : null

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
              update((s) => ({
                ...s,
                pgSz: { ...s.pgSz, w: mmToTwip(paper.w), h: mmToTwip(paper.h) }
              }))
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
              update((s) =>
                orient === s.pgSz.orient
                  ? s
                  : // 向きを変えたら縦横を入れ替える
                    { ...s, pgSz: { w: s.pgSz.h, h: s.pgSz.w, orient } }
              )
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
      <RibbonGroup label="日本語の体裁">
        <RibbonRow>
          <RibbonButton
            label="ページ設定..."
            title="用紙・余白と文字数と行数をまとめて設定する"
            wide
            disabled={!section}
            onClick={() => openDialog('pageSetup')}
          />
        </RibbonRow>
        <RibbonRow>
          <span className="ribbon-readout" data-testid="grid-readout">
            {grid
              ? grid.charGridEnabled
                ? `${grid.charsPerLine} 字 × ${grid.linesPerPage} 行`
                : `${grid.linesPerPage} 行 (文字数は標準)`
              : '文字数と行数の指定なし'}
          </span>
        </RibbonRow>
      </RibbonGroup>
    </div>
  )
}

export function ViewTab(): React.JSX.Element {
  const zoom = useUiStore((s) => s.zoom)
  const setZoom = useUiStore((s) => s.setZoom)
  const nudgeZoom = useUiStore((s) => s.nudgeZoom)
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  const showGrid = useUiStore((s) => s.showGrid)
  const toggleGrid = useUiStore((s) => s.toggleGrid)
  const showRuler = useUiStore((s) => s.showRuler)
  const toggleRuler = useUiStore((s) => s.toggleRuler)
  const showTrimMarks = useUiStore((s) => s.showTrimMarks)
  const toggleTrimMarks = useUiStore((s) => s.toggleTrimMarks)

  const document_ = useDocumentStore((s) => s.document)
  const section = document_?.resources.sections[0] ?? null
  const hasGrid = section
    ? gridFromSection(section, normalSizeOf(document_?.resources.styles.docDefaults.rPr?.sz))
        ?.charGridEnabled === true
    : false

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="表示モード">
        <RibbonRow>
          <RibbonButton
            label="印刷レイアウト"
            title="ページに分割して用紙として表示する"
            wide
            active={viewMode === 'print'}
            onClick={() => setViewMode('print')}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="下書き"
            title="ページ分割せず連続して表示する"
            wide
            active={viewMode === 'draft'}
            onClick={() => setViewMode('draft')}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="原稿用紙のマス目"
            title={
              hasGrid
                ? '文字数と行数の指定に合わせてマス目を表示する'
                : 'この文書には文字数と行数の指定がありません'
            }
            wide
            active={showGrid}
            disabled={!hasGrid}
            onClick={() => toggleGrid()}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="定規と印刷用の印">
        <RibbonRow>
          <RibbonButton
            label="ルーラ"
            title="余白と字下げの目盛りを表示する。三角をつかむと字下げを変えられる"
            wide
            active={showRuler}
            disabled={viewMode !== 'print'}
            onClick={() => toggleRuler()}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="裁ちトンボ"
            title="断裁位置の印を付ける。用紙は四辺 13mm ずつ大きくなり、PDF にも同じ印が入る"
            wide
            active={showTrimMarks}
            disabled={viewMode !== 'print'}
            onClick={() => toggleTrimMarks()}
          />
        </RibbonRow>
      </RibbonGroup>

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
    </div>
  )
}

export function ReferencesTab({ editor }: { editor: Editor | null }): React.JSX.Element {
  const [status, setStatus] = useState<string | null>(null)

  const markTocChanged = useDocumentStore((s) => s.markTocChanged)

  const build = (): void => {
    if (!editor) return
    const count = insertOrUpdateToc(editor)
    // settings.xml に w:updateFields を立てる印。
    // 立てないと Word で開いてもページ番号が空欄のままになる
    if (count > 0) markTocChanged()
    setStatus(count > 0 ? `${count} 件の見出しから作成しました` : '見出しが見つかりません')
  }

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="目次">
        <RibbonRow>
          <RibbonButton
            label="目次の挿入 / 更新"
            title="見出しから目次を作る。すでにあれば作り直す"
            wide
            disabled={!editor}
            onClick={build}
          />
        </RibbonRow>
        <RibbonRow>
          <span className="ribbon-readout" data-testid="toc-status">
            {status ?? '見出し 1〜3 から作成します'}
          </span>
        </RibbonRow>
      </RibbonGroup>
      <PendingGroup label="参照" items={['図表番号', '相互参照', '脚注']} />
    </div>
  )
}

export function ReviewTab({ editor }: { editor: Editor | null }): React.JSX.Element {
  const commentsOpen = useUiStore((s) => s.commentsOpen)
  const toggleComments = useUiStore((s) => s.toggleComments)
  const document_ = useDocumentStore((s) => s.document)
  const count = document_?.resources.comments.size ?? 0

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="コメント">
        <RibbonRow>
          <RibbonButton
            label="コメントの表示"
            title="コメントの一覧を開閉する"
            wide
            active={commentsOpen}
            disabled={!editor}
            onClick={() => toggleComments()}
          />
        </RibbonRow>
        <RibbonRow>
          <span className="ribbon-readout" data-testid="comment-count">
            {count > 0 ? `${count} 件` : 'コメントなし'}
          </span>
        </RibbonRow>
      </RibbonGroup>
      <RevisionGroups editor={editor} />
    </div>
  )
}

/** 変更履歴のリボン。記録・承諾/取り消し・移動・表示モード */
function RevisionGroups({ editor }: { editor: Editor | null }): React.JSX.Element {
  const tracking = useUiStore((s) => s.tracking)
  const setTracking = useUiStore((s) => s.setTracking)
  const author = useUiStore((s) => s.author)
  const setAuthor = useUiStore((s) => s.setAuthor)
  const display = useUiStore((s) => s.revisionDisplay)
  const setDisplay = useUiStore((s) => s.setRevisionDisplay)

  /**
   * コマンドは型が緩いので、使う分だけ形を付けて呼ぶ。
   *
   * chain().focus() は挟まない。focus() は呼ばれた時点の選択を復元するので、
   * 変更箇所へ移動しても元の位置に引き戻されてしまう。
   * ボタンは押下時に既定動作を止めており、本文のフォーカスは奪われない。
   */
  const run = (name: string, arg: unknown) => (): void => {
    if (!editor) return
    const commands = editor.commands as unknown as Record<string, (a: unknown) => boolean>
    commands[name]?.(arg)
  }

  return (
    <>
      <RibbonGroup label="変更履歴">
        <RibbonRow>
          <RibbonButton
            label="変更履歴の記録"
            title="変更履歴の記録を開始または終了する"
            wide
            active={tracking}
            disabled={!editor}
            onClick={() => setTracking()}
          />
        </RibbonRow>
        <RibbonRow>
          <input
            className="ribbon-input"
            type="text"
            title="変更履歴に残す名前"
            aria-label="変更履歴に残す名前"
            data-testid="revision-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="変更箇所">
        <RibbonRow>
          <RibbonButton
            label="承諾"
            title="カーソル位置または選択範囲の変更を反映する"
            disabled={!editor}
            onClick={run('applyRevisionAt', 'accept')}
          />
          <RibbonButton
            label="元に戻す"
            title="カーソル位置または選択範囲の変更を取り消す"
            disabled={!editor}
            onClick={run('applyRevisionAt', 'reject')}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="すべて承諾"
            title="文書中のすべての変更を反映する"
            disabled={!editor}
            onClick={run('applyAllRevisions', 'accept')}
          />
          <RibbonButton
            label="すべて元に戻す"
            title="文書中のすべての変更を取り消す"
            disabled={!editor}
            onClick={run('applyAllRevisions', 'reject')}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="◀ 前の変更"
            title="前の変更箇所へ移動する"
            disabled={!editor}
            onClick={run('gotoRevision', -1)}
          />
          <RibbonButton
            label="次の変更 ▶"
            title="次の変更箇所へ移動する"
            disabled={!editor}
            onClick={run('gotoRevision', 1)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="表示">
        <RibbonRow>
          <RibbonSelect
            value={display}
            title="変更履歴の表示方法"
            width={150}
            options={[
              { value: 'all' as const, label: 'すべての変更' },
              { value: 'final' as const, label: '変更なし (最終版)' },
              { value: 'original' as const, label: '初版' }
            ]}
            onChange={setDisplay}
          />
        </RibbonRow>
        <RibbonRow>
          <span className="ribbon-note">表示だけの切り替えです。保存される内容は変わりません。</span>
        </RibbonRow>
      </RibbonGroup>
    </>
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
