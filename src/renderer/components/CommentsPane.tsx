import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { CommentRecord, WowdDoc } from '@core/model/types'
import { threadComments, nextCommentId, newParaId } from '@core/docx/read/comments'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'
import { useDocumentStore } from '../store/document'
import { useUiStore } from '../store/ui'
import { t } from '../i18n/ja'

/**
 * コメントのスレッド表示。
 *
 * 範囲そのものは本文の comment マークで表されているので、
 * ここでは comments.xml 側の本文と返信関係を扱う。
 */
export function CommentsPane({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const open = useUiStore((s) => s.commentsOpen)
  const toggle = useUiStore((s) => s.toggleComments)
  const document_ = useDocumentStore((s) => s.document)
  const updateComments = useDocumentStore((s) => s.updateComments)

  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  /**
   * 選択されている文字列。
   *
   * 描画のたびに editor から読むと、選択が変わっても再描画されないので
   * ボタンの有効無効が実際の選択とずれる。選択の変化を購読して状態に持つ。
   */
  const [selectionText, setSelectionText] = useState('')

  useEffect(() => {
    if (!editor) return
    const update = (): void => {
      const { from, to } = editor.state.selection
      setSelectionText(editor.state.doc.textBetween(from, to, ''))
    }
    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  // 文書が差し替わったら書きかけと返信先を捨てる。
  // 前の文書のコメントに返信することになってしまうため。
  // 目印は loadToken を使う。filePath は未保存の文書だと常に null で、
  // 別のファイルを開いても変化せず、差し替えを取りこぼす
  const loadToken = useDocumentStore((s) => s.loadToken)
  const [lastDocument, setLastDocument] = useState(loadToken)
  if (loadToken !== lastDocument) {
    setLastDocument(loadToken)
    setReplyTo(null)
    setDraft('')
  }

  const threads = useMemo(
    () => (document_ ? threadComments(document_.resources.comments) : []),
    [document_]
  )

  if (!open) return null

  /** 新しいコメント、または返信を足す */
  const addComment = (): void => {
    if (!editor || !document_ || draft.trim().length === 0) return
    const id = nextCommentId(document_.resources.comments)
    const record: CommentRecord = {
      id,
      author: 'Wowd',
      initials: 'W',
      date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      body: bodyOf(draft),
      parentId: replyTo,
      done: false
    }

    updateComments((comments) => new Map(comments).set(id, record))

    // 返信でなければ、選択範囲にコメントの印を付ける
    if (!replyTo && selectionText.length > 0) {
      const existing = (editor.getAttributes('comment')['ids'] as string[] | undefined) ?? []
      editor
        .chain()
        .focus()
        .setMark('comment', { ids: [...existing, id] })
        .run()
    }

    setDraft('')
    setReplyTo(null)
  }

  const setDone = (id: string, done: boolean): void => {
    updateComments((comments) => {
      const next = new Map(comments)
      const record = next.get(id)
      if (record) next.set(id, { ...record, done })
      return next
    })
  }

  const remove = (id: string): void => {
    updateComments((comments) => {
      const next = new Map(comments)
      next.delete(id)
      // 返信も一緒に消す。親が消えた返信は行き場が無い
      for (const [key, record] of next) {
        if (record.parentId === id) next.delete(key)
      }
      return next
    })
  }

  const canAdd = draft.trim().length > 0 && (replyTo !== null || selectionText.length > 0)

  return (
    <aside className="comments-pane" aria-label="コメント">
      <div className="comments-header">
        <strong>コメント</strong>
        <button type="button" onClick={() => toggle(false)} aria-label={t.dialog.close}>
          ×
        </button>
      </div>

      <div className="comments-list">
        {threads.length === 0 && <p className="comments-empty">コメントはありません。</p>}
        {threads.map((thread) => {
          const root = thread[0]
          if (!root) return null
          return (
            <div
              key={root.id}
              className={`comment-thread${root.done ? ' is-done' : ''}`}
              data-comment-id={root.id}
            >
              {thread.map((comment) => (
                <div key={comment.id} className="comment-item">
                  <div className="comment-meta">
                    <span className="comment-author">{comment.author || '(不明)'}</span>
                    <span className="comment-date">{formatDate(comment.date)}</span>
                  </div>
                  <div className="comment-body">{plainText(comment.body)}</div>
                </div>
              ))}
              <div className="comment-actions">
                <button type="button" onClick={() => setReplyTo(root.id)}>
                  返信
                </button>
                <button type="button" onClick={() => setDone(root.id, !root.done)}>
                  {root.done ? '未解決に戻す' : '解決'}
                </button>
                <button type="button" onClick={() => remove(root.id)}>
                  削除
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="comments-new">
        {replyTo !== null && (
          <div className="comments-replying">
            返信先: コメント {replyTo}
            <button type="button" onClick={() => setReplyTo(null)}>
              取り消し
            </button>
          </div>
        )}
        {replyTo === null && selectionText.length === 0 && (
          <p className="comments-hint">本文を選択してからコメントを書いてください。</p>
        )}
        <textarea
          value={draft}
          rows={3}
          placeholder="コメントを入力"
          onChange={(e) => setDraft(e.target.value)}
          data-testid="comment-draft"
        />
        <button type="button" disabled={!canAdd} onClick={addComment} data-testid="comment-add">
          {replyTo !== null ? '返信する' : 'コメントを追加'}
        </button>
      </div>
    </aside>
  )
}

/** 入力文字列をコメント本文 (段落の並び) にする */
function bodyOf(text: string): WowdDoc {
  return {
    type: 'doc',
    content: text.split(/\r?\n/).map((line) => ({
      type: 'paragraph',
      // スレッドの結び付けに使うので paraId は必ず持たせる
      attrs: { ...EMPTY_PARAGRAPH_ATTRS, paraId: newParaId() },
      content: line.length > 0 ? [{ type: 'text', text: line }] : []
    }))
  }
}

function plainText(body: WowdDoc): string {
  return body.content
    .map((block) =>
      block.type === 'paragraph'
        ? (block.content ?? []).map((n) => (n.type === 'text' ? n.text : '')).join('')
        : ''
    )
    .join('\n')
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}
