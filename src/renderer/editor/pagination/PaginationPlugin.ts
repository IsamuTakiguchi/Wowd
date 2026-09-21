import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { SectionProps } from '@core/model/types'
import { pageGeometry, toPx } from '@core/layout/pageGeometry'
import {
  computeBreaks,
  overflowingBlocks,
  spacerHeight,
  type BlockInput
} from '@core/layout/pageBreaks'
import { measureBlocks, SPACER_ATTRIBUTE, type BlockMetrics } from './measure'
import { type PageLayout, type PageInfo, EMPTY_LAYOUT } from './types'

export const paginationKey = new PluginKey<PaginationState>('wowd-pagination')

export interface PaginationState {
  decorations: DecorationSet
  layout: PageLayout
}

export interface PaginationOptions {
  /** 現在のセクション設定。文書を読み込むたびに差し替える */
  getSection: () => SectionProps | null
  /** ページ分割が終わるたびに呼ばれる。ページの下地や余白の描画に使う */
  onLayout: (layout: PageLayout) => void
  /** ページ表示が無効なら分割しない (下書き表示) */
  isEnabled: () => boolean
  /** ページ間の隙間 (px)。裁ちトンボを出すときは広がる */
  getPageGap: () => number
}

/** 再計算を束ねる待ち時間 (ms)。打鍵のたびに測ると重すぎる */
const DEBOUNCE_MS = 120

/**
 * 本文を実測してページに分割するプラグイン。
 *
 * 本文は単一の連続フローのまま置き、改ページは
 * 「下余白 + 隙間 + 上余白」ぶんの高さを持つスペーサーを
 * widget Decoration として差し込むことで作る。
 * 文書本体には一切手を入れないので、保存される内容は変わらない。
 *
 * 用紙の下地とヘッダー / フッターは、同じ計算結果から位置決めした別レイヤに描く。
 */
export function paginationPlugin(options: PaginationOptions): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,

    state: {
      init: () => ({ decorations: DecorationSet.empty, layout: EMPTY_LAYOUT }),
      apply(tr, value) {
        const incoming = tr.getMeta(paginationKey) as PaginationState | undefined
        if (incoming) return incoming
        if (!tr.docChanged) return value
        // 文書が変わったら、次の実測までは位置だけ追従させる
        return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) }
      }
    },

    props: {
      decorations(state) {
        return paginationKey.getState(state)?.decorations ?? DecorationSet.empty
      }
    },

    view(view) {
      const runner = new PaginationRunner(view, options)
      runner.schedule()
      return {
        update: () => runner.schedule(),
        destroy: () => runner.destroy()
      }
    }
  })
}

class PaginationRunner {
  private timer: number | null = null
  private frame: number | null = null
  private observer: ResizeObserver | null = null
  private destroyed = false
  /** 直前に適用したスペーサーの署名。同じなら再適用しない */
  private signature = ''

  constructor(
    private view: EditorView,
    private options: PaginationOptions
  ) {
    // フォントの読み込みやウィンドウ幅の変化でも行送りが変わる
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.schedule())
      this.observer.observe(view.dom)
    }
  }

  schedule(): void {
    if (this.destroyed) return
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      // 実測はレイアウトが確定したあとに行う
      this.frame = window.requestAnimationFrame(() => {
        this.frame = null
        this.run()
      })
    }, DEBOUNCE_MS)
  }

  destroy(): void {
    this.destroyed = true
    if (this.timer !== null) window.clearTimeout(this.timer)
    if (this.frame !== null) window.cancelAnimationFrame(this.frame)
    this.observer?.disconnect()
  }

  private run(): void {
    if (this.destroyed) return

    const section = this.options.getSection()
    if (!section || !this.options.isEnabled()) {
      this.applyEmpty()
      return
    }

    const flow = this.view.dom as HTMLElement
    const geometry = toPx(pageGeometry(section))
    if (geometry.textBlock <= 0) {
      this.applyEmpty()
      return
    }

    const metrics = measureBlocks(flow, (el) => this.posOf(el))
    if (metrics.length === 0) {
      this.applyEmpty()
      return
    }

    const inputs = metrics.map((m) => this.toBlockInput(m))
    const computed = computeBreaks(inputs, { pageContentHeight: geometry.textBlock })

    const decorations: Decoration[] = []
    for (const brk of computed) {
      const block = metrics[brk.index]
      if (!block) continue
      const height = spacerHeight(
        brk.remaining,
        geometry.marginAfter,
        geometry.marginBefore,
        this.options.getPageGap()
      )
      decorations.push(
        Decoration.widget(block.pos, () => createSpacer(height), {
          side: -1,
          // スペーサーは飾りなので選択にもクリップボードにも入れない
          ignoreSelection: true,
          key: `wowd-spacer-${brk.index}-${Math.round(height)}`
        })
      )
    }

    // 紙からはみ出したブロックを数える。表はページ間で分割しないので、
    // 長い表でここに出る。黙って溢れさせず画面で知らせる
    const overflow = { tables: 0, others: 0 }
    for (const index of overflowingBlocks(inputs, { pageContentHeight: geometry.textBlock })) {
      const block = metrics[index]
      if (!block) continue
      if (this.nodeAt(block.pos)?.type.name === 'table') overflow.tables++
      else overflow.others++
    }

    const layout = this.buildLayout(section, geometry, computed.length + 1, overflow)
    const signature = computed.map((b) => `${b.index}:${Math.round(b.remaining)}`).join('|')

    // いま実際に適用されているスペーサーの数。
    // 署名だけで判断すると、setContent で文書を差し替えたときに
    // 「同じ署名だが Decoration は失われている」状態を見逃す
    const applied = paginationKey.getState(this.view.state)?.decorations.find().length ?? 0

    if (signature === this.signature && applied === decorations.length) {
      // 位置が変わっていないならトランザクションを起こさない。
      // ここで毎回 dispatch すると update → schedule → dispatch の無限ループになる
      this.options.onLayout(layout)
      return
    }
    this.signature = signature

    const state: PaginationState = {
      decorations: DecorationSet.create(this.view.state.doc, decorations),
      layout
    }
    this.view.dispatch(this.view.state.tr.setMeta(paginationKey, state).setMeta('addToHistory', false))
    this.options.onLayout(layout)
  }

  private applyEmpty(): void {
    if (this.signature === '') {
      this.options.onLayout(EMPTY_LAYOUT)
      return
    }
    this.signature = ''
    this.view.dispatch(
      this.view.state.tr
        .setMeta(paginationKey, { decorations: DecorationSet.empty, layout: EMPTY_LAYOUT })
        .setMeta('addToHistory', false)
    )
    this.options.onLayout(EMPTY_LAYOUT)
  }

  /**
   * DOM 要素に対応する、そのブロックの「直前」の ProseMirror 位置。
   *
   * posAtDOM(el, 0) はノードの内側の位置を返す。そこにスペーサーを挿すと
   * 段落の中に入ってしまい、段落自身が背を伸ばして改ページにならない。
   * resolve(...).before(1) で最上位ブロックの手前に直す。
   */
  private posOf(el: HTMLElement): number | null {
    try {
      const inside = this.view.posAtDOM(el, 0)
      if (inside < 0) return null
      const resolved = this.view.state.doc.resolve(inside)
      return resolved.depth > 0 ? resolved.before(1) : inside
    } catch {
      return null
    }
  }

  private toBlockInput(metrics: BlockMetrics): BlockInput {
    const node = this.nodeAt(metrics.pos)
    const attrs = (node?.attrs ?? {}) as Record<string, unknown>
    return {
      height: metrics.height,
      breakBefore: node?.type.name === 'pageBreak' || attrs['pageBreakBefore'] === true,
      keepNext: attrs['keepNext'] === true
    }
  }

  private nodeAt(pos: number): PMNode | null {
    try {
      const resolved = this.view.state.doc.resolve(Math.min(pos, this.view.state.doc.content.size))
      return resolved.parent.type.name === 'doc' ? resolved.nodeAfter : resolved.parent
    } catch {
      return null
    }
  }

  private buildLayout(
    section: SectionProps,
    geometry: ReturnType<typeof toPx>,
    pageCount: number,
    overflow: PageLayout['overflow'] = { tables: 0, others: 0 }
  ): PageLayout {
    const gap = this.options.getPageGap()
    const stride = geometry.pageBlock + gap
    const start = section.pgNumType?.start ?? 1
    const pages: PageInfo[] = []
    for (let i = 0; i < Math.max(1, pageCount); i++) {
      pages.push({ index: i, displayNumber: start + i, top: i * stride, section })
    }
    return { pages, breaks: [], geometry, stride, gap, overflow }
  }
}

function createSpacer(height: number): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute(SPACER_ATTRIBUTE, '')
  el.className = 'wowd-spacer'
  el.setAttribute('contenteditable', 'false')
  el.style.height = `${height}px`
  return el
}
