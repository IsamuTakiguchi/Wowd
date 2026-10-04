import { charPitchTwip } from '@core/okaguchi/rank'
import { effectiveRunProps } from '@core/docx/read/styles'
import { useDocumentStore } from '../store/document'

/** いまの文書の 1 字の幅 (twip)。文字グリッドがあればその送り、無ければ標準の文字の大きさ */
export function documentPitchTwip(): number {
  const document = useDocumentStore.getState().document
  if (!document) return 240
  const { styles, sections } = document.resources
  const size = effectiveRunProps(styles, styles.defaults.paragraph).sz ?? styles.docDefaults.rPr?.sz ?? 21
  return charPitchTwip(sections[0], size)
}
