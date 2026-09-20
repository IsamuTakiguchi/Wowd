import { useMemo } from 'react'
import type { WowdDoc, WowdResources, BlockNode, InlineNode } from '@core/model/types'
import { pickHeaderFooterRef } from '@core/layout/pageGeometry'
import { resolveField } from '@core/fields'
import { paragraphAttrsToStyle } from '@core/css/paragraphCss'
import { runPropsToStyle, DEFAULT_RUN_PROPS } from '@core/css/runCss'
import type { PageLayout } from './types'

/**
 * 用紙の下地と、ヘッダー / フッターを描く層。
 *
 * 本文の編集領域とは完全に別のレイヤに置く。ここを本文に混ぜると、
 * 保存時に用紙の飾りが文書内容として書き出されてしまう。
 */
export function PageChrome({
  layout,
  resources
}: {
  layout: PageLayout
  resources: WowdResources | null
}): React.JSX.Element | null {
  if (layout.pages.length === 0) return null

  const pageCount = layout.pages.length
  const { geometry } = layout

  return (
    <div className="wowd-chrome" aria-hidden="true">
      {layout.pages.map((page) => {
        const section = page.section
        // 奇数偶数のヘッダーは settings.xml の evenAndOddHeaders で決まる。
        // 未解析なので、even の参照が定義されていれば有効とみなす
        const evenAndOdd = Boolean(section.headerRefs.even ?? section.footerRefs.even)

        const headerId = pickHeaderFooterRef(
          section.headerRefs,
          page.displayNumber,
          section.titlePg,
          evenAndOdd
        )
        const footerId = pickHeaderFooterRef(
          section.footerRefs,
          page.displayNumber,
          section.titlePg,
          evenAndOdd
        )

        return (
          <div
            key={page.index}
            className="wowd-page-backdrop"
            data-page={page.index + 1}
            style={{
              top: page.top,
              width: geometry.pageInline,
              height: geometry.pageBlock
            }}
          >
            <PartLayer
              className="wowd-header"
              doc={headerId ? (resources?.headers.get(headerId) ?? null) : null}
              style={{
                top: geometry.headerOffset,
                left: geometry.marginStart,
                width: geometry.textInline
              }}
              pageNumber={page.displayNumber}
              pageCount={pageCount}
              numberFormat={section.pgNumType?.fmt ?? 'decimal'}
            />
            <PartLayer
              className="wowd-footer"
              doc={footerId ? (resources?.footers.get(footerId) ?? null) : null}
              style={{
                bottom: geometry.footerOffset,
                left: geometry.marginStart,
                width: geometry.textInline
              }}
              pageNumber={page.displayNumber}
              pageCount={pageCount}
              numberFormat={section.pgNumType?.fmt ?? 'decimal'}
            />
          </div>
        )
      })}
    </div>
  )
}

/**
 * ヘッダー / フッターの中身を描く。
 *
 * v1 では読み取り専用。編集は Word の「ダブルクリックで入る」UX を含めて
 * 別途用意する必要があり、まずは正しく表示され、保存時に原文がそのまま
 * 書き戻されることを優先する。
 */
function PartLayer({
  className,
  doc,
  style,
  pageNumber,
  pageCount,
  numberFormat
}: {
  className: string
  doc: WowdDoc | null
  style: React.CSSProperties
  pageNumber: number
  pageCount: number
  numberFormat: string
}): React.JSX.Element | null {
  const blocks = useMemo(() => (doc ? doc.content : []), [doc])
  if (!doc || blocks.length === 0) return null

  return (
    <div className={className} style={{ position: 'absolute', ...style }}>
      {blocks.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          pageNumber={pageNumber}
          pageCount={pageCount}
          numberFormat={numberFormat}
        />
      ))}
    </div>
  )
}

function BlockView({
  block,
  pageNumber,
  pageCount,
  numberFormat
}: {
  block: BlockNode
  pageNumber: number
  pageCount: number
  numberFormat: string
}): React.JSX.Element | null {
  // 表を含むヘッダー (社名入りのレターヘッドなど) は珍しくない。
  // 段落しか描かないと、開いたときにヘッダーの中身が抜けて見える
  if (block.type === 'table') {
    return (
      <table className="wowd-chrome-table">
        <tbody>
          {block.content.map((row, r) => (
            <tr key={r}>
              {row.content.map((cell, c) => (
                <td key={c} colSpan={cell.attrs.colspan > 1 ? cell.attrs.colspan : undefined}>
                  {cell.content.map((inner, i) => (
                    <BlockView
                      key={i}
                      block={inner}
                      pageNumber={pageNumber}
                      pageCount={pageCount}
                      numberFormat={numberFormat}
                    />
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (block.type !== 'paragraph') return null
  const style = paragraphAttrsToStyle(block.attrs)

  return (
    <p style={parseInlineStyle(style)} data-style={block.attrs.pStyle ?? undefined}>
      {(block.content ?? []).map((node, i) => (
        <InlineView
          key={i}
          node={node}
          pageNumber={pageNumber}
          pageCount={pageCount}
          numberFormat={numberFormat}
        />
      ))}
    </p>
  )
}

function InlineView({
  node,
  pageNumber,
  pageCount,
  numberFormat
}: {
  node: InlineNode
  pageNumber: number
  pageCount: number
  numberFormat: string
}): React.JSX.Element | null {
  if (node.type === 'text') {
    const runProps = node.marks?.find((m) => m.type === 'textStyle')
    const css = runProps
      ? runPropsToStyle({ ...DEFAULT_RUN_PROPS, ...(runProps.attrs as object) })
      : ''
    const bold = node.marks?.some((m) => m.type === 'bold')
    const italic = node.marks?.some((m) => m.type === 'italic')
    const style = parseInlineStyle(css)
    if (bold) style.fontWeight = 'bold'
    if (italic) style.fontStyle = 'italic'
    return <span style={style}>{node.text}</span>
  }

  if (node.type === 'field') {
    // PAGE / NUMPAGES はページごとに値が変わるのでここで解決する。
    // 解決できないフィールドは Word が最後に計算した値をそのまま出す
    const resolved = resolveField(node.attrs.instr, {
      pageNumber,
      pageCount,
      pageNumberFormat: numberFormat
    })
    return <span className="wowd-field">{resolved ?? node.attrs.cachedText}</span>
  }

  if (node.type === 'wTab') return <span className="wowd-tab">{'	'}</span>
  if (node.type === 'ruby') {
    return (
      <ruby>
        {node.content.map((t) => t.text).join('')}
        <rt>{node.attrs.rt}</rt>
      </ruby>
    )
  }
  return null
}

/** `a:b;c:d` 形式の CSS 文字列を React のスタイルオブジェクトに直す */
function parseInlineStyle(css: string): React.CSSProperties {
  const style: Record<string, string> = {}
  for (const part of css.split(';')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!key || !value) continue
    style[toCamel(key)] = value
  }
  return style as React.CSSProperties
}

function toCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
}
