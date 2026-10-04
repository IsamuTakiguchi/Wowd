import { courtStyles, courtSection, type LatinFont } from '@core/okaguchi/pageFormat'
import { fromEditableText, PAGE_TOKEN } from '@core/headerFooter'
import { ensureHeaderFooter } from '../editor/commands/headerFooter'
import { useDocumentStore } from '../store/document'

/**
 * 文書を裁判所書式にする (書式変更 Alt+P と、連番等事後設定の「裁判所書式へ変更する」)。
 *
 * フッターはページ番号 (中央) だけにする。元のマクロも中身を置き換える。
 */
export function applyCourtFormat(latin: LatinFont, lineNumbers: boolean): boolean {
  const store = useDocumentStore.getState()
  const document = store.document
  const section = document?.resources.sections[0]
  if (!document || !section) return false

  store.updateStyles(courtStyles(document.resources.styles, latin))
  let next = courtSection(section, lineNumbers)
  const latest = useDocumentStore.getState().document!
  const footer = ensureHeaderFooter(latest, next, 'footer', 'default')
  next = footer.section
  store.updateSection(0, () => next)
  store.updateHeaderFooter('footer', footer.relId, fromEditableText(PAGE_TOKEN, 'center'))
  return true
}
