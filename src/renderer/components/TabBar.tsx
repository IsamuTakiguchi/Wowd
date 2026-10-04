import { useEffect, useMemo, useRef, useState } from 'react'
import { useTabsStore, TAB_COLORS, type TabSummary } from '../store/tabs'
import { useDocumentStore, EMPTY_DOCUMENT_DATA } from '../store/document'

/**
 * 文書のタブ。Excel のシート見出しと同じく、窓の下に並べる。
 *
 * Excel と同じ操作:
 *   クリック            … そのタブへ移る
 *   ダブルクリック      … 名前を変える (未保存の文書だけ。保存済みはファイル名そのもの)
 *   右クリック          … 挿入・名前の変更・色・閉じる などのメニュー
 *   ドラッグ            … 並べ替え
 *   ＋                  … 新しいタブ
 *   Ctrl+PageUp/Down    … 前後のタブへ (App で受ける)
 *
 * Excel に無いもの: 各タブの × (閉じる) と、未保存の印 (●)。
 * Excel のシートはファイルの一部なので閉じる概念が無いが、こちらは 1 枚が 1 ファイルなので要る。
 */
export function TabBar({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const parked = useTabsStore((s) => s.parked)
  const activeTitle = useDocumentStore((s) => s.fileName())
  const activeDirty = useDocumentStore((s) => s.dirty)
  const activePath = useDocumentStore((s) => s.filePath)

  // 見出しの要約。表のタブは画面の文書から、裏のタブは預かり物から作る
  const summaries = useMemo<TabSummary[]>(
    () =>
      tabs.map((tab) => {
        if (tab.id === activeId) {
          return { ...tab, title: activeTitle, dirty: activeDirty, filePath: activePath, active: true }
        }
        const data = parked.get(tab.id)?.data ?? EMPTY_DOCUMENT_DATA
        const title = data.filePath
          ? (data.filePath.split(/[\\/]/).pop() ?? data.filePath)
          : (data.untitledName ?? '無題')
        return { ...tab, title, dirty: data.dirty, filePath: data.filePath, active: false }
      }),
    [tabs, activeId, parked, activeTitle, activeDirty, activePath]
  )

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 表のタブが見える位置まで送る。タブが多いと端に隠れる
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  // スマホでは画面が狭いので、2 枚以上のときだけ出す
  if (compact && tabs.length < 2) return null

  const store = useTabsStore.getState

  return (
    <div className="tabbar" data-testid="tabbar">
      <div
        className="tabbar-list"
        role="tablist"
        aria-label="開いている文書"
        ref={listRef}
        onDragOver={(e) => e.preventDefault()}
      >
        {summaries.map((tab, index) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.active}
            tabIndex={tab.active ? 0 : -1}
            className={[
              'tabbar-tab',
              tab.active ? 'is-active' : '',
              dropAt === index && dragFrom !== null && dragFrom !== index ? 'is-drop-target' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={tab.color ? ({ '--tab-color': tab.color } as React.CSSProperties) : undefined}
            title={tab.filePath ?? `${tab.title} (未保存)`}
            data-testid={`tab-${index}`}
            draggable={editing !== tab.id}
            onClick={() => store().switchTo(tab.id)}
            onDoubleClick={() => {
              if (!tab.filePath) setEditing(tab.id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ id: tab.id, x: e.clientX, y: e.clientY })
            }}
            onAuxClick={(e) => {
              // 中ボタンで閉じる。ブラウザのタブと同じ
              if (e.button === 1) void store().closeTab(tab.id)
            }}
            onDragStart={(e) => {
              setDragFrom(index)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(index))
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDropAt(index)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null) store().moveTab(dragFrom, index)
              setDragFrom(null)
              setDropAt(null)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDropAt(null)
            }}
          >
            {editing === tab.id ? (
              <RenameField
                initial={tab.title}
                onDone={(name) => {
                  if (name !== null) store().rename(tab.id, name)
                  setEditing(null)
                }}
              />
            ) : (
              <span className="tabbar-title">{tab.title}</span>
            )}
            {tab.dirty && (
              <span className="tabbar-dirty" aria-label="未保存">
                ●
              </span>
            )}
            <button
              type="button"
              className="tabbar-close"
              aria-label={`${tab.title} を閉じる`}
              title="閉じる"
              data-testid={`tab-close-${index}`}
              onClick={(e) => {
                e.stopPropagation()
                void store().closeTab(tab.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="tabbar-add"
        title="新しいタブ (白紙の文書)"
        aria-label="新しいタブ"
        data-testid="tab-add"
        onClick={() => void store().newTab('blank-a4')}
      >
        ＋
      </button>

      {menu && (
        <TabMenu
          tab={summaries.find((t) => t.id === menu.id) ?? null}
          x={menu.x}
          y={menu.y}
          canCloseOthers={tabs.length > 1}
          onRename={() => setEditing(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/** 名前を変える欄。Enter で決め、Esc で取り消す。外を押しても決める (Excel と同じ) */
function RenameField({
  initial,
  onDone
}: {
  initial: string
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="tabbar-rename"
      value={value}
      aria-label="タブの名前"
      data-testid="tab-rename"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        if (e.key === 'Escape') onDone(null)
      }}
      onBlur={() => onDone(value)}
    />
  )
}

/** 右クリックのメニュー。Excel のシート見出しのメニューに合わせる */
function TabMenu({
  tab,
  x,
  y,
  canCloseOthers,
  onRename,
  onClose
}: {
  tab: TabSummary | null
  x: number
  y: number
  canCloseOthers: boolean
  onRename: () => void
  onClose: () => void
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  if (!tab) return null
  const store = useTabsStore.getState
  const run = (fn: () => void | Promise<unknown>) => (): void => {
    onClose()
    void fn()
  }

  // 窓の下端で開くので、メニューは上へ伸ばす
  return (
    <div
      ref={ref}
      className="tabbar-menu"
      role="menu"
      style={{ left: x, bottom: window.innerHeight - y }}
      data-testid="tab-menu"
    >
      <button type="button" role="menuitem" onClick={run(() => store().newTab('blank-a4'))}>
        新しいタブ
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={tab.filePath !== null}
        title={tab.filePath ? '保存済みの文書の名前はファイル名です。「名前を付けて保存」で変えます' : undefined}
        onClick={run(() => {
          store().switchTo(tab.id)
          onRename()
        })}
      >
        名前の変更
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={run(async () => {
          store().switchTo(tab.id)
          await useDocumentStore.getState().saveAs()
        })}
      >
        名前を付けて保存…
      </button>
      <div className="tabbar-menu-label">タブの色</div>
      <div className="tabbar-menu-colors">
        {TAB_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="menuitemradio"
            aria-checked={tab.color === c.value}
            aria-label={c.label}
            title={c.label}
            className="tabbar-swatch"
            style={{ background: c.value }}
            onClick={run(() => store().setColor(tab.id, c.value))}
          />
        ))}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={tab.color === null}
          className="tabbar-swatch is-none"
          title="色なし"
          aria-label="色なし"
          onClick={run(() => store().setColor(tab.id, null))}
        />
      </div>
      <hr />
      <button type="button" role="menuitem" onClick={run(() => store().closeTab(tab.id))}>
        閉じる
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canCloseOthers}
        onClick={run(() => store().closeOthers(tab.id))}
      >
        ほかのタブを閉じる
      </button>
    </div>
  )
}
