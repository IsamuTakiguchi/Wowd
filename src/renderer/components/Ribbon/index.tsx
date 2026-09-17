import type { Editor } from '@tiptap/react'
import { HomeTab } from './HomeTab'
import { InsertTab, LayoutTab, ViewTab, ReferencesTab, ReviewTab } from './OtherTabs'
import { useUiStore, type RibbonTab } from '../../store/ui'
import { useDocumentStore } from '../../store/document'
import { t } from '../../i18n/ja'

const TABS: { id: RibbonTab; label: string }[] = [
  { id: 'home', label: t.ribbon.tabs.home },
  { id: 'insert', label: t.ribbon.tabs.insert },
  { id: 'layout', label: t.ribbon.tabs.layout },
  { id: 'references', label: t.ribbon.tabs.references },
  { id: 'review', label: t.ribbon.tabs.review },
  { id: 'view', label: t.ribbon.tabs.view }
]

export function Ribbon({ editor }: { editor: Editor | null }): React.JSX.Element {
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)
  const fileName = useDocumentStore((s) => s.fileName())
  const dirty = useDocumentStore((s) => s.dirty)

  return (
    <header className="ribbon">
      <div className="ribbon-titlebar">
        <span className="ribbon-appname">Wowd</span>
        <span className="ribbon-filename">
          {fileName}
          {dirty ? t.app.dirtyMark : ''}
        </span>
      </div>
      <nav className="ribbon-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            className={`ribbon-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="ribbon-panel" role="tabpanel">
        {tab === 'home' && <HomeTab editor={editor} />}
        {tab === 'insert' && <InsertTab editor={editor} />}
        {tab === 'layout' && <LayoutTab />}
        {tab === 'references' && <ReferencesTab editor={editor} />}
        {tab === 'review' && <ReviewTab />}
        {tab === 'view' && <ViewTab />}
      </div>
    </header>
  )
}
