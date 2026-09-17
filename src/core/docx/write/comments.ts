import type { CommentRecord } from '../../model/types'
import { wrap, el, XML_DECL } from '../xml'
import { rootAttrsOf, applyRootAttrs, ensureIgnorable, ROOT_ATTR_PLACEHOLDER } from './rootAttrs'
import { writeParagraph } from './paragraph'

/**
 * comments.xml と commentsExtended.xml を書く。
 *
 * スレッドの親子関係は段落の w14:paraId で結ばれる。
 * paraId を失うと Word 側で返信関係が壊れるので、
 * 読み込み時に保持した値をそのまま書き戻す。
 */

const COMMENTS_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'mc:Ignorable="w14"'

const COMMENTS_EX_NS =
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'mc:Ignorable="w15"'

export function writeComments(
  comments: Map<string, CommentRecord>,
  originalXml: string | null = null
): string {
  const body = [...comments.values()]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((comment) =>
      wrap(
        'w:comment',
        {
          'w:id': comment.id,
          'w:author': comment.author,
          'w:initials': comment.initials || undefined,
          'w:date': comment.date || undefined
        },
        // 本文は普通の段落。セクションは持たないので空の Map を渡す
        comment.body.content
          .map((block) => (block.type === 'paragraph' ? writeParagraph(block, new Map()) : ''))
          .join('') || wrap('w:p', undefined, '')
      )
    )
    .join('')

  return (
    XML_DECL +
    applyRootAttrs(
      wrap('w:comments', ROOT_ATTR_PLACEHOLDER, body),
      // 段落に w14:paraId を書くので、宣言と mc:Ignorable を揃える
      ensureIgnorable(rootAttrsOf(originalXml, 'w:comments', COMMENTS_NS), ['w14'])
    )
  )
}

/**
 * commentsExtended.xml を書く。
 *
 * 各コメントの「末尾段落の paraId」を鍵にする。
 * 返信は親コメントの末尾段落 paraId を指す。
 */
export function writeCommentsExtended(
  comments: Map<string, CommentRecord>,
  originalXml: string | null = null
): string {
  const lastParaId = (comment: CommentRecord): string | null => {
    for (let i = comment.body.content.length - 1; i >= 0; i--) {
      const block = comment.body.content[i]
      if (block?.type === 'paragraph' && block.attrs.paraId) return block.attrs.paraId
    }
    return null
  }

  const body = [...comments.values()]
    .map((comment) => {
      const paraId = lastParaId(comment)
      if (!paraId) return ''
      const parent = comment.parentId ? comments.get(comment.parentId) : null
      const parentParaId = parent ? lastParaId(parent) : null
      return el('w15:commentEx', {
        'w15:paraId': paraId,
        'w15:paraIdParent': parentParaId ?? undefined,
        'w15:done': comment.done ? '1' : '0'
      })
    })
    .join('')

  return (
    XML_DECL +
    applyRootAttrs(
      wrap('w15:commentsEx', ROOT_ATTR_PLACEHOLDER, body),
      rootAttrsOf(originalXml, 'w15:commentsEx', COMMENTS_EX_NS)
    )
  )
}
