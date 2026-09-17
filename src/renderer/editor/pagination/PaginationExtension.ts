import { Extension } from '@tiptap/core'
import type { SectionProps } from '@core/model/types'
import { paginationPlugin } from './PaginationPlugin'
import type { PageLayout } from './types'

/**
 * ページ分割プラグインを TipTap に登録する。
 *
 * 設定は拡張の storage に置いて、コマンドで差し替える。
 * 拡張のオプションに値を渡すと、値が変わるたびに拡張を作り直すことになり、
 * エディタごと再生成されて Undo 履歴も選択位置も失われる。
 * Numbering 拡張と同じ作りにしてある。
 */
export interface PaginationStorage {
  section: SectionProps | null
  enabled: boolean
  onLayout: (layout: PageLayout) => void
}

export interface PaginationConfig {
  section: SectionProps | null
  enabled: boolean
  onLayout: (layout: PageLayout) => void
}

export const PaginationExtension = Extension.create<
  Record<string, never>,
  PaginationStorage
>({
  name: 'wowdPagination',

  addStorage() {
    return {
      section: null,
      enabled: false,
      onLayout: () => undefined
    }
  },

  addCommands() {
    return {
      setPaginationConfig:
        (config: PaginationConfig) =>
        ({ editor }: { editor: { storage: Record<string, PaginationStorage> } }) => {
          const storage = editor.storage['wowdPagination']
          if (!storage) return false
          storage.section = config.section
          storage.enabled = config.enabled
          storage.onLayout = config.onLayout
          return true
        }
    } as never
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      paginationPlugin({
        getSection: () => storage.section,
        isEnabled: () => storage.enabled,
        onLayout: (layout) => storage.onLayout(layout)
      })
    ]
  }
})
