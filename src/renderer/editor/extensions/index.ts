import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import HardBreak from '@tiptap/extension-hard-break'
import { CharacterCount, Dropcursor, Gapcursor, UndoRedo } from '@tiptap/extensions'
import type { Extension, Node, Mark } from '@tiptap/core'

import { WParagraph } from './WParagraph'
import { WHeading } from './WHeading'
import { WRunProps } from './WRunProps'
import { RawBlock, RawRun } from './RawContent'
import { WTab } from './WTab'
import { PageBreak, SectionBreak } from './PageBreak'
import { Numbering } from './Numbering'
import { Shortcuts } from './Shortcuts'
import { TrackChanges } from '../track/TrackChanges'
import { Ruby, Field, Bookmark, WBreak } from './InlineNodes'
import { WImage } from './WImage'
import { WTable, WTableRow, WTableCell, WTableHeader } from './WTable'
import {
  DoubleStrike,
  WUnderline,
  WLink,
  CommentMark,
  InsertionMark,
  DeletionMark
} from './Marks'

/**
 * 使用する拡張の一覧。
 *
 * @tiptap/starter-kit は使わない。BulletList / OrderedList / ListItem / Blockquote /
 * CodeBlock / HorizontalRule を抱き合わせで入れてしまい、Word 形状のスキーマと衝突するため。
 * リストは Numbering プラグイン (段落属性 + Decoration) で実装する。
 */
export function buildExtensions(): (Extension | Node | Mark)[] {
  return [
    Document,
    WParagraph,
    Text,
    WHeading,
    HardBreak,

    Bold,
    Italic,
    WUnderline,
    Strike,
    WRunProps,
    // マークもノードと同じく、モデルが作りうるものはすべて登録する。
    // 1 つでも欠けると、それを含む文書が読み込み時に例外になる
    DoubleStrike,
    WLink,
    CommentMark,
    InsertionMark,
    DeletionMark,

    WTab,
    PageBreak,
    SectionBreak,
    RawBlock,
    RawRun,

    // WowdDoc が生成しうるノードはすべて登録する。
    // スキーマに無いノードを含む JSON は ProseMirror が例外にするので、
    // 1 つでも欠けるとその要素を含む文書が読み込めなくなる
    Ruby,
    Field,
    Bookmark,
    WBreak,
    WImage,
    WTable,
    WTableRow,
    WTableCell,
    WTableHeader,

    Numbering,
    // Tab は Numbering と WTab が先に処理するので、その後ろに置く
    Shortcuts,
    TrackChanges,

    UndoRedo.configure({ depth: 200, newGroupDelay: 400 }),
    Gapcursor,
    Dropcursor,
    CharacterCount
  ] as (Extension | Node | Mark)[]
}

export {
  WParagraph,
  WHeading,
  WRunProps,
  RawBlock,
  RawRun,
  WTab,
  PageBreak,
  SectionBreak,
  Ruby,
  Field,
  Bookmark,
  WBreak,
  WImage,
  WTable,
  DoubleStrike,
  WLink,
  CommentMark,
  InsertionMark,
  DeletionMark
}
