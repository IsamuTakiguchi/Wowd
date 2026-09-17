import { useState } from 'react'
import { Dialog, Field } from './Dialog'
import { useDocumentStore } from '../../store/document'
import type { SectionProps } from '@core/model/types'
import { twipToMm, mmToTwip } from '@shared/units'
import {
  gridFromSection,
  docGridFor,
  docGridForLinesOnly,
  gridLimits,
  normalSizeOf
} from '@core/layout/grid'

/** Word の「文字数と行数」タブと同じ 4 択 */
type GridMode = 'standard' | 'linesOnly' | 'charsAndLines' | 'manuscript'

const PAPERS = [
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  { id: 'b5', label: 'B5 (182 × 257 mm)', w: 182, h: 257 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', w: 148, h: 210 },
  { id: 'b4', label: 'B4 (257 × 364 mm)', w: 257, h: 364 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 297, h: 420 },
  { id: 'letter', label: 'レター (216 × 279 mm)', w: 215.9, h: 279.4 },
  { id: 'legal', label: 'リーガル (216 × 356 mm)', w: 215.9, h: 355.6 }
]

/**
 * ページ設定。用紙・余白と「文字数と行数」をまとめて扱う。
 *
 * 原稿用紙の設定は日本語文書でよく使われるので、
 * Word と同じ 4 択をそのまま用意している。
 */
export function PageSetupDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const section = useDocumentStore((s) => s.document?.resources.sections[0] ?? null)
  if (!open || !section) return null
  // 開くたびに作り直して、現在値を初期値として読み込む。
  // effect で初期化すると余分な再描画が挟まる
  return <PageSetupForm key={`${open}`} onClose={onClose} />
}

function PageSetupForm({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const document_ = useDocumentStore((s) => s.document)
  const updateSection = useDocumentStore((s) => s.updateSection)

  const section = document_?.resources.sections[0] ?? null
  const normalSize = normalSizeOf(document_?.resources.styles.docDefaults.rPr?.sz)

  const [tab, setTab] = useState<'paper' | 'grid'>('paper')
  const initial = useState(() => initialValues(section, normalSize))[0]
  const [paper, setPaper] = useState(initial.paper)
  const [landscape, setLandscape] = useState(initial.landscape)
  const [margins, setMargins] = useState(initial.margins)
  const [mode, setMode] = useState<GridMode>(initial.mode)
  const [chars, setChars] = useState(initial.chars)
  const [lines, setLines] = useState(initial.lines)

  if (!section || !document_) return null

  const limits = gridLimits(section, normalSize)

  const submit = (): void => {
    updateSection(0, (current) => {
      const spec = PAPERS.find((p) => p.id === paper)
      const pgSz = spec
        ? {
            w: mmToTwip(landscape ? spec.h : spec.w),
            h: mmToTwip(landscape ? spec.w : spec.h),
            orient: (landscape ? 'landscape' : 'portrait') as SectionProps['pgSz']['orient']
          }
        : current.pgSz
      const next: SectionProps = {
        ...current,
        pgSz,
        pgMar: {
          ...current.pgMar,
          top: mmToTwip(margins.top),
          bottom: mmToTwip(margins.bottom),
          left: mmToTwip(margins.left),
          right: mmToTwip(margins.right)
        }
      }
      // グリッドは新しい用紙サイズを前提に計算する
      return { ...next, docGrid: gridFor(mode, next, normalSize, chars, lines) }
    })
    onClose()
  }

  return (
    <Dialog title="ページ設定" open onClose={onClose} onSubmit={submit} width={480}>
      <div className="wowd-dialog-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'paper'}
          className={tab === 'paper' ? 'is-active' : ''}
          onClick={() => setTab('paper')}
        >
          用紙と余白
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'grid'}
          className={tab === 'grid' ? 'is-active' : ''}
          onClick={() => setTab('grid')}
        >
          文字数と行数
        </button>
      </div>

      {tab === 'paper' && (
        <>
          <Field label="用紙サイズ">
            <select value={paper} onChange={(e) => setPaper(e.target.value)} title="用紙サイズ">
              {PAPERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="印刷の向き">
            <select
              value={landscape ? 'landscape' : 'portrait'}
              onChange={(e) => setLandscape(e.target.value === 'landscape')}
            >
              <option value="portrait">縦</option>
              <option value="landscape">横</option>
            </select>
          </Field>
          <div className="wowd-dialog-row">
            {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
              <Field
                key={side}
                label={{ top: '上', bottom: '下', left: '左', right: '右' }[side] + ' (mm)'}
              >
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={margins[side]}
                  onChange={(e) =>
                    setMargins((m) => ({ ...m, [side]: Number(e.target.value) }))
                  }
                />
              </Field>
            ))}
          </div>
        </>
      )}

      {tab === 'grid' && (
        <>
          <div className="wowd-dialog-radios">
            {(
              [
                ['standard', '標準の文字数を使う'],
                ['linesOnly', '行数だけを指定する'],
                ['charsAndLines', '文字数と行数を指定する'],
                ['manuscript', '原稿用紙の設定にする']
              ] as [GridMode, string][]
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="grid-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="wowd-dialog-row">
            <Field label={`文字数 (1〜${limits.maxCharsPerLine})`}>
              <input
                type="number"
                min={1}
                max={limits.maxCharsPerLine}
                value={chars}
                disabled={mode === 'standard' || mode === 'linesOnly'}
                onChange={(e) => setChars(clamp(Number(e.target.value), 1, limits.maxCharsPerLine))}
                data-testid="grid-chars"
              />
            </Field>
            <Field label={`行数 (1〜${limits.maxLinesPerPage})`}>
              <input
                type="number"
                min={1}
                max={limits.maxLinesPerPage}
                value={lines}
                disabled={mode === 'standard'}
                onChange={(e) => setLines(clamp(Number(e.target.value), 1, limits.maxLinesPerPage))}
                data-testid="grid-lines"
              />
            </Field>
          </div>

          <p className="wowd-dialog-note">
            純粋な日本語の文章では指定した文字数どおりに折り返します。
            英数字が混ざる行はグリッドからずれて、次の段落で揃い直します。
            CSS のテキストレイアウトでは Word の snapToChars を完全には再現できません。
          </p>
        </>
      )}
    </Dialog>
  )
}

/** 現在のセクションからダイアログの初期値を作る */
function initialValues(
  section: SectionProps | null,
  normalSize: number
): {
  paper: string
  landscape: boolean
  margins: { top: number; bottom: number; left: number; right: number }
  mode: GridMode
  chars: number
  lines: number
} {
  const fallback = {
    paper: 'a4',
    landscape: false,
    margins: { top: 25.4, bottom: 25.4, left: 25.4, right: 25.4 },
    mode: 'standard' as GridMode,
    chars: 40,
    lines: 36
  }
  if (!section) return fallback

  const w = twipToMm(section.pgSz.w)
  const h = twipToMm(section.pgSz.h)
  const found = PAPERS.find(
    (p) =>
      (Math.abs(p.w - w) < 2 && Math.abs(p.h - h) < 2) ||
      (Math.abs(p.h - w) < 2 && Math.abs(p.w - h) < 2)
  )

  const metrics = gridFromSection(section, normalSize)
  const mode: GridMode = !metrics
    ? 'standard'
    : metrics.charGridEnabled
      ? section.docGrid?.type === 'snapToChars'
        ? 'manuscript'
        : 'charsAndLines'
      : 'linesOnly'

  return {
    paper: found?.id ?? 'a4',
    landscape: w > h,
    margins: {
      top: round(twipToMm(section.pgMar.top)),
      bottom: round(twipToMm(section.pgMar.bottom)),
      left: round(twipToMm(section.pgMar.left)),
      right: round(twipToMm(section.pgMar.right))
    },
    mode,
    chars: metrics?.charsPerLine || fallback.chars,
    lines: metrics?.linesPerPage || fallback.lines
  }
}

/** 選んだ方式に応じた docGrid を作る */
function gridFor(
  mode: GridMode,
  section: SectionProps,
  normalSize: number,
  chars: number,
  lines: number
): SectionProps['docGrid'] {
  switch (mode) {
    case 'standard':
      return null
    case 'linesOnly':
      return docGridForLinesOnly(section, lines)
    case 'charsAndLines':
      return docGridFor(section, normalSize, chars, lines)
    case 'manuscript': {
      // 原稿用紙は文字を升目に吸着させる
      const grid = docGridFor(section, normalSize, chars, lines)
      return { ...grid, type: 'snapToChars' }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function round(v: number): number {
  return Math.round(v * 10) / 10
}
