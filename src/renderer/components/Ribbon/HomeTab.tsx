import { useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { RibbonGroup, RibbonRow, RibbonButton, RibbonSelect } from './parts'
import { t } from '../../i18n/ja'
import {
  currentRunProps,
  patchRunProps,
  currentParagraphAttrs,
  setAlignment,
  setLineSpacing,
  changeIndent,
  applyStyle,
  clearFormatting,
  toggleList
} from '../../editor/commands/format'
import { useDocumentStore } from '../../store/document'
import { useUiStore } from '../../store/ui'
import { halfPtToPt, ptToHalfPt } from '@shared/units'
import { ensureListDefinition, type ListKind } from '@core/numbering/create'

/** Word のフォントサイズ一覧 */
const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72]

/** 日本語環境でよく使うフォント */
const FONT_FAMILIES = [
  '游明朝',
  '游ゴシック',
  'ＭＳ 明朝',
  'ＭＳ ゴシック',
  'メイリオ',
  'Yu Mincho',
  'Yu Gothic',
  'Noto Serif JP',
  'Noto Sans JP',
  'Century',
  'Times New Roman',
  'Arial',
  'Calibri'
]

const COLORS: { value: string | null; label: string }[] = [
  { value: null, label: '自動' },
  { value: '000000', label: '黒' },
  { value: 'FF0000', label: '赤' },
  { value: '0070C0', label: '青' },
  { value: '00B050', label: '緑' },
  { value: 'FFC000', label: '橙' },
  { value: '7030A0', label: '紫' }
]

const HIGHLIGHTS: { value: string | null; label: string }[] = [
  { value: null, label: 'なし' },
  { value: 'yellow', label: '黄' },
  { value: 'green', label: '緑' },
  { value: 'cyan', label: '水' },
  { value: 'magenta', label: '桃' },
  { value: 'lightGray', label: '灰' }
]

const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3]

export function HomeTab({ editor }: { editor: Editor | null }): React.JSX.Element {
  const document = useDocumentStore((s) => s.document)
  const markNumberingChanged = useDocumentStore((s) => s.markNumberingChanged)
  const toggleFind = useUiStore((s) => s.toggleFind)

  const rPr = currentRunProps(editor)
  const pPr = currentParagraphAttrs(editor)
  const disabled = !editor

  const run = useCallback(
    (fn: (editor: Editor) => void) => () => {
      if (editor) fn(editor)
    },
    [editor]
  )

  const styleOptions = buildStyleOptions(document)
  const currentStyle = pPr.pStyle ?? 'Normal'

  const activeListKind = currentListKind(document, pPr.numPr?.numId ?? null)

  /**
   * リストの適用と解除。
   * 該当する種類の定義が文書に無ければその場で作る。
   * 定義を作った場合は numbering.xml も書き直す必要がある。
   */
  const applyList = (kind: ListKind) => (): void => {
    if (!editor || !document) return
    if (activeListKind === kind) {
      toggleList(editor, pPr.numPr?.numId ?? -1)
      return
    }
    const { numId, created } = ensureListDefinition(document.resources.numbering, kind)
    toggleList(editor, numId)
    if (created) {
      ;(editor.commands as unknown as { setNumberingTable: (t: unknown) => void }).setNumberingTable(
        document.resources.numbering
      )
    }
    markNumberingChanged()
  }

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label={t.ribbon.groups.font}>
        <RibbonRow>
          <RibbonSelect
            title={t.ribbon.fontFamily}
            width={140}
            value={rPr?.rFonts?.eastAsia ?? rPr?.rFonts?.ascii ?? ''}
            options={[{ value: '', label: '(既定)' }, ...FONT_FAMILIES.map((f) => ({ value: f, label: f }))]}
            onChange={(font) =>
              editor &&
              patchRunProps(editor, {
                // 和欧両方に同じ指定を入れる。片方だけだと混植で別フォントになる
                rFonts: font ? { ascii: font, eastAsia: font, hAnsi: font, hint: 'eastAsia' } : null
              })
            }
          />
          <RibbonSelect
            title={t.ribbon.fontSize}
            width={64}
            value={rPr?.sz != null ? halfPtToPt(rPr.sz) : 0}
            options={[{ value: 0, label: '(既定)' }, ...FONT_SIZES.map((s) => ({ value: s, label: String(s) }))]}
            onChange={(pt) => editor && patchRunProps(editor, { sz: pt ? ptToHalfPt(pt) : null })}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label={<b>B</b>}
            title={t.ribbon.bold}
            disabled={disabled}
            active={editor?.isActive('bold') ?? false}
            onClick={run((e) => e.chain().focus().toggleBold().run())}
          />
          <RibbonButton
            label={<i>I</i>}
            title={t.ribbon.italic}
            disabled={disabled}
            active={editor?.isActive('italic') ?? false}
            onClick={run((e) => e.chain().focus().toggleItalic().run())}
          />
          <RibbonButton
            label={<u>U</u>}
            title={t.ribbon.underline}
            disabled={disabled}
            active={editor?.isActive('underline') ?? false}
            onClick={run((e) => e.chain().focus().toggleUnderline().run())}
          />
          <RibbonButton
            label={<s>S</s>}
            title={t.ribbon.strike}
            disabled={disabled}
            active={editor?.isActive('strike') ?? false}
            onClick={run((e) => e.chain().focus().toggleStrike().run())}
          />
          <RibbonButton
            label={
              <span>
                x<sup>2</sup>
              </span>
            }
            title={t.ribbon.superscript}
            disabled={disabled}
            active={rPr?.vertAlign === 'superscript'}
            onClick={run((e) =>
              patchRunProps(e, {
                vertAlign: currentRunProps(e)?.vertAlign === 'superscript' ? null : 'superscript'
              })
            )}
          />
          <RibbonButton
            label={
              <span>
                x<sub>2</sub>
              </span>
            }
            title={t.ribbon.subscript}
            disabled={disabled}
            active={rPr?.vertAlign === 'subscript'}
            onClick={run((e) =>
              patchRunProps(e, {
                vertAlign: currentRunProps(e)?.vertAlign === 'subscript' ? null : 'subscript'
              })
            )}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonSelect
            title={t.ribbon.fontColor}
            width={78}
            value={rPr?.color ?? ''}
            options={COLORS.map((c) => ({ value: c.value ?? '', label: c.label }))}
            onChange={(color) => editor && patchRunProps(editor, { color: color || null })}
          />
          <RibbonSelect
            title={t.ribbon.highlight}
            width={78}
            value={rPr?.highlight ?? ''}
            options={HIGHLIGHTS.map((c) => ({ value: c.value ?? '', label: c.label }))}
            onChange={(hl) => editor && patchRunProps(editor, { highlight: hl || null })}
          />
          <RibbonButton
            label="Aa"
            title={t.ribbon.clearFormat}
            disabled={disabled}
            onClick={run(clearFormatting)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label={t.ribbon.groups.paragraph}>
        <RibbonRow>
          <RibbonButton
            label="≡"
            title={t.ribbon.alignLeft}
            disabled={disabled}
            active={pPr.jc === 'left' || pPr.jc == null}
            onClick={run((e) => setAlignment(e, 'left'))}
          />
          <RibbonButton
            label="≡"
            title={t.ribbon.alignCenter}
            disabled={disabled}
            active={pPr.jc === 'center'}
            onClick={run((e) => setAlignment(e, 'center'))}
          />
          <RibbonButton
            label="≡"
            title={t.ribbon.alignRight}
            disabled={disabled}
            active={pPr.jc === 'right'}
            onClick={run((e) => setAlignment(e, 'right'))}
          />
          <RibbonButton
            label="≣"
            title={t.ribbon.alignJustify}
            disabled={disabled}
            active={pPr.jc === 'both'}
            onClick={run((e) => setAlignment(e, 'both'))}
          />
          <RibbonButton
            label="⇹"
            title={t.ribbon.alignDistribute}
            disabled={disabled}
            active={pPr.jc === 'distribute'}
            onClick={run((e) => setAlignment(e, 'distribute'))}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="•≡"
            title={t.ribbon.bulletList}
            disabled={disabled || !document}
            active={activeListKind === 'bullet'}
            onClick={applyList('bullet')}
          />
          <RibbonButton
            label="1≡"
            title={t.ribbon.numberedList}
            disabled={disabled || !document}
            active={activeListKind === 'decimal'}
            onClick={applyList('decimal')}
          />
          <RibbonButton
            label="⇥"
            title={t.ribbon.indentIncrease}
            disabled={disabled}
            onClick={run((e) => changeIndent(e, 1))}
          />
          <RibbonButton
            label="⇤"
            title={t.ribbon.indentDecrease}
            disabled={disabled}
            onClick={run((e) => changeIndent(e, -1))}
          />
          <RibbonSelect
            title={t.ribbon.lineSpacing}
            width={64}
            value={currentLineSpacing(pPr)}
            options={LINE_SPACINGS.map((v) => ({ value: v, label: String(v) }))}
            onChange={(v) => editor && setLineSpacing(editor, v)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label={t.ribbon.groups.styles}>
        <RibbonRow>
          <RibbonSelect
            title={t.ribbon.groups.styles}
            width={160}
            value={currentStyle}
            options={styleOptions}
            onChange={(id) => editor && applyStyle(editor, id)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label={t.ribbon.groups.editing}>
        <RibbonRow>
          <RibbonButton
            label="🔍"
            title={t.ribbon.find}
            wide
            disabled={disabled}
            onClick={() => toggleFind(true)}
          />
        </RibbonRow>
      </RibbonGroup>
    </div>
  )
}

function currentLineSpacing(pPr: ReturnType<typeof currentParagraphAttrs>): number {
  const line = pPr.spacing?.line
  if (line == null || pPr.spacing?.lineRule === 'exact') return 1
  const value = line / 240
  return LINE_SPACINGS.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), 1)
}

/**
 * styles.xml から UI に出すスタイル一覧を作る。
 * qFormat が付いたものを優先し、無ければ主要な見出しだけ出す。
 */
function buildStyleOptions(
  document: ReturnType<typeof useDocumentStore.getState>['document']
): { value: string; label: string }[] {
  const fallback = [
    { value: 'Normal', label: t.styles.Normal },
    { value: 'Heading1', label: t.styles.Heading1 },
    { value: 'Heading2', label: t.styles.Heading2 },
    { value: 'Heading3', label: t.styles.Heading3 }
  ]
  if (!document) return fallback

  const quick = [...document.resources.styles.byId.values()]
    .filter((s) => s.type === 'paragraph' && s.quickFormat && !s.semiHidden)
    .sort((a, b) => a.uiPriority - b.uiPriority)
    .map((s) => ({ value: s.styleId, label: localizedStyleName(s.styleId, s.name) }))

  if (quick.length === 0) return fallback
  // 標準が含まれていない文書もあるので必ず先頭に置く
  return quick.some((q) => q.value === 'Normal')
    ? quick
    : [{ value: 'Normal', label: t.styles.Normal }, ...quick]
}

function localizedStyleName(styleId: string, name: string): string {
  const dict = t.styles as Record<string, string | undefined>
  return dict[styleId] ?? name
}

/** いま選択中の段落がどちらの種類のリストかを判定する */
function currentListKind(
  document: ReturnType<typeof useDocumentStore.getState>['document'],
  numId: number | null
): ListKind | null {
  if (!document || numId == null) return null
  const { numbering } = document.resources
  const instance = numbering.instances.get(numId)
  if (!instance) return null
  const level0 =
    instance.overrides.get(0)?.level ?? numbering.abstract.get(instance.abstractNumId)?.levels.get(0)
  if (!level0) return null
  return level0.numFmt === 'bullet' ? 'bullet' : 'decimal'
}
