import { useCallback, useMemo, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import type { PageGeometryPx } from '@core/layout/pageGeometry'
import {
  rulerTicks,
  indentMarkers,
  indentFromPosition,
  snapToRuler,
  formatMm,
  type IndentMarkers
} from '@core/layout/ruler'
import { twipToPx, pxToTwip } from '@shared/units'
import { currentIndent, setIndent } from '../editor/commands/format'

/**
 * ルーラ (目盛り)。
 *
 * 紙と同じ座標系で描く。倍率は transform ではなく座標に掛ける。
 * transform で拡大すると数字や線まで太るので、目盛りとして読めなくなる。
 *
 * 位置の計算は src/core/layout/ruler.ts にある純粋関数で行う。
 * ここは描き方と、つかんで動かす操作だけを持つ。
 */

/** ルーラの太さ (px)。倍率を変えても太さは変えない */
export const RULER_SIZE = 22

/** つかむ三角の当たり判定の幅 (px) */
const HANDLE_HIT = 14

export interface RulerProps {
  geometry: PageGeometryPx
  /** 表示倍率 */
  scale: number
  /** 裁ちトンボのぶん、紙が左と上へ広がっている量 (px) */
  offsetPx: number
  /** 紙全体の幅 (px、トンボ込み)。ルーラの長さに使う */
  stageWidth: number
}

/**
 * 水平ルーラ。余白と本文領域を示し、段落の字下げをつかんで動かせる。
 */
export function HorizontalRuler({
  editor,
  geometry,
  scale,
  offsetPx,
  stageWidth
}: RulerProps & { editor: Editor | null }): React.JSX.Element {
  const barRef = useRef<HTMLDivElement>(null)

  // 目盛りは紙の座標で作り、描くときに倍率を掛ける
  const model = useMemo(
    () =>
      rulerTicks({
        length: pxToTwip(geometry.pageInline),
        textStart: pxToTwip(geometry.marginStart),
        textEnd: pxToTwip(geometry.marginStart + geometry.textInline)
      }),
    [geometry]
  )

  // つかんで動かす処理が依存するので、毎回作り直さない
  const area = useMemo(
    () => ({ textStart: model.textStart, textEnd: model.textEnd }),
    [model.textStart, model.textEnd]
  )
  const ind = currentIndent(editor)
  // 文字単位の指定を読むために 1 文字ぶんの幅が要る。
  // 既定の級数が分からない場面でも破綻しないよう 10.5pt を既定にする
  const emWidth = 210
  const markers = indentMarkers(ind, area, emWidth)

  /** 紙の座標 (twip) を、ルーラ上の px に直す */
  const toBar = useCallback(
    (twip: number): number => offsetPx * scale + twipToPx(twip) * scale,
    [offsetPx, scale]
  )

  /** ルーラ上の px を紙の座標 (twip) に戻す */
  const fromBar = useCallback(
    (clientX: number): number => {
      const rect = barRef.current?.getBoundingClientRect()
      if (!rect) return 0
      return snapToRuler(pxToTwip((clientX - rect.left) / scale - offsetPx))
    },
    [offsetPx, scale]
  )

  const drag = useCallback(
    (handle: Handle) =>
      (event: React.PointerEvent<HTMLButtonElement>): void => {
        if (!editor) return
        event.preventDefault()
        const target = event.currentTarget
        target.setPointerCapture(event.pointerId)

        // つかんだ時点の位置を覚える。動かしている間ずっと基準になる
        const start = indentMarkers(currentIndent(editor), area, emWidth)

        const move = (e: PointerEvent): void => {
          applyDrag(editor, handle, fromBar(e.clientX), area, start)
        }
        const up = (): void => {
          target.releasePointerCapture(event.pointerId)
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
      },
    [editor, area, fromBar]
  )

  return (
    <div
      className="wowd-ruler wowd-ruler-h"
      ref={barRef}
      style={{ width: stageWidth * scale, height: RULER_SIZE }}
      data-testid="wowd-ruler-h"
      role="presentation"
    >
      {/* 本文領域。余白との境が見えるように色を変える */}
      <div
        className="wowd-ruler-text-area"
        style={{ left: toBar(model.textStart), width: toBar(model.textEnd) - toBar(model.textStart) }}
      />
      {model.ticks.map((tick) => (
        <div
          key={tick.at}
          className={tick.major ? 'wowd-ruler-tick is-major' : 'wowd-ruler-tick'}
          style={{ left: toBar(tick.at) }}
        >
          {tick.label != null && tick.label > 0 && (
            <span className="wowd-ruler-label">{tick.label}</span>
          )}
        </div>
      ))}

      {editor && (
        <>
          <IndentHandle
            kind="firstLine"
            label="1 行目の字下げ"
            at={toBar(markers.firstLine)}
            value={markers.firstLine - area.textStart}
            onPointerDown={drag('firstLine')}
          />
          <IndentHandle
            kind="hanging"
            label="2 行目以降の字下げ"
            at={toBar(markers.left)}
            value={markers.left - area.textStart}
            onPointerDown={drag('hanging')}
          />
          <IndentHandle
            kind="left"
            label="左の字下げ"
            at={toBar(markers.left)}
            value={markers.left - area.textStart}
            onPointerDown={drag('left')}
          />
          <IndentHandle
            kind="right"
            label="右の字下げ"
            at={toBar(markers.right)}
            value={area.textEnd - markers.right}
            onPointerDown={drag('right')}
          />
        </>
      )}
    </div>
  )
}

/**
 * 垂直ルーラ。上下の余白を示す。**紙 1 枚につき 1 本**出す。
 *
 * 文書全体で 1 本にすると、2 ページ目以降は目盛りが紙と合わなくなる
 * (2 ページ目の上端が 297mm から始まってしまう)。Word も紙ごとに振り直す。
 *
 * こちらはつかんで動かせない。上下の余白はページ設定で変えるもので、
 * 段落ごとに変わる字下げとは性質が違う。
 */
export function VerticalRuler({
  geometry,
  scale,
  offsetPx,
  top
}: Omit<RulerProps, 'stageWidth'> & {
  /** この紙の上端 (拡大後の px、紙の列の先頭から) */
  top: number
}): React.JSX.Element {
  const model = useMemo(
    () =>
      rulerTicks({
        length: pxToTwip(geometry.pageBlock),
        textStart: pxToTwip(geometry.marginBefore),
        textEnd: pxToTwip(geometry.marginBefore + geometry.textBlock)
      }),
    [geometry]
  )

  const toBar = (twip: number): number => offsetPx * scale + twipToPx(twip) * scale
  // 紙 1 枚ぶん。トンボを出しているときはその広がりも含める
  const height = (geometry.pageBlock + offsetPx * 2) * scale

  return (
    <div
      className="wowd-ruler wowd-ruler-v"
      style={{ width: RULER_SIZE, height, top }}
      data-testid="wowd-ruler-v"
      role="presentation"
    >
      <div
        className="wowd-ruler-text-area"
        style={{ top: toBar(model.textStart), height: toBar(model.textEnd) - toBar(model.textStart) }}
      />
      {model.ticks.map((tick) => (
        <div
          key={tick.at}
          className={tick.major ? 'wowd-ruler-tick is-major' : 'wowd-ruler-tick'}
          style={{ top: toBar(tick.at) }}
        >
          {tick.label != null && tick.label > 0 && (
            <span className="wowd-ruler-label">{tick.label}</span>
          )}
        </div>
      ))}
    </div>
  )
}

type Handle = 'firstLine' | 'hanging' | 'left' | 'right'

function IndentHandle({
  kind,
  label,
  at,
  value,
  onPointerDown
}: {
  kind: Handle
  label: string
  at: number
  value: number
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`wowd-ruler-handle is-${kind}`}
      style={{ left: at - HANDLE_HIT / 2, width: HANDLE_HIT }}
      title={`${label} (${formatMm(value)})`}
      aria-label={label}
      data-testid={`ruler-handle-${kind}`}
      onPointerDown={onPointerDown}
    >
      <span className="wowd-ruler-handle-mark" />
    </button>
  )
}

/**
 * つかんだ三角を動かした結果を段落に書き戻す。
 *
 * Word と同じ振る舞いにする:
 *   1 行目の三角  … 1 行目だけが動く
 *   2 行目の三角  … 2 行目以降だけが動く (1 行目はその場に残る)
 *   左の四角      … 段落全体が動く
 *   右の三角      … 右端が動く
 */
function applyDrag(
  editor: Editor,
  handle: Handle,
  at: number,
  area: { textStart: number; textEnd: number },
  start: IndentMarkers
): void {
  if (handle === 'right') {
    setIndent(editor, { right: Math.max(0, indentFromPosition('right', at, area, start)) })
    return
  }

  if (handle === 'firstLine') {
    // 1 行目の位置から、2 行目以降との差を求め直す
    const first = area.textStart + indentFromPosition('firstLine', at, area, start)
    const delta = first - start.left
    setIndent(editor, delta >= 0 ? { firstLine: delta } : { hanging: -delta })
    return
  }

  const left = indentFromPosition('left', at, area, start)
  if (handle === 'left') {
    // 段落全体を動かす。1 行目との差はそのまま保つ
    setIndent(editor, { left: Math.max(0, left) })
    return
  }

  // 2 行目以降だけを動かす。1 行目が元の位置に残るよう差を付け替える
  const newLeft = Math.max(0, left)
  const delta = start.firstLine - (area.textStart + newLeft)
  setIndent(
    editor,
    delta >= 0 ? { left: newLeft, firstLine: delta } : { left: newLeft, hanging: -delta }
  )
}
