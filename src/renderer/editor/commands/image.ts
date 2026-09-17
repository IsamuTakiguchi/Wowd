import type { Editor } from '@tiptap/react'
import type { WowdDocument, MediaEntry, Emu } from '@core/model/types'
import { ptToEmu, emuToPt } from '@shared/units'
import { mediaRegistry } from '../media'

/**
 * 画像の挿入。
 *
 * .docx の画像は 3 つが揃って初めて成立する:
 *   1. パッケージの中のバイト列 (word/media/xxx.png)
 *   2. document.xml.rels の関係 (r:embed が指す先)
 *   3. [Content_Types].xml の拡張子ごとの既定
 *
 * ここでは 1 と 2 をモデルに載せ、3 は保存時に書き出し側が足す。
 * 1 つでも欠けると Word は画像を見つけられず、開いたときに空欄になる。
 */

const IMAGE_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/** 既存と衝突しない word/media のパート名を決める */
export function nextMediaKey(media: Map<string, MediaEntry>, extension: string): string {
  const ext = extension.replace(/^\./, '').toLowerCase() || 'png'
  for (let i = 1; i < 10_000; i++) {
    const key = `word/media/image${i}.${ext}`
    if (!media.has(key)) return key
  }
  // ここまで来ることはないが、衝突したまま返すよりは分かる名前にする
  return `word/media/image-${Date.now()}.${ext}`
}

export interface InsertedImage {
  mediaKey: string
  relId: string
  cx: Emu
  cy: Emu
}

/**
 * 画像を資源に登録する。文書ツリーへの挿入は呼び出し側が行う。
 *
 * @param maxWidthEmu 本文の幅。これより大きい画像は縦横比を保って縮める
 */
export function registerImage(
  document_: WowdDocument,
  picked: { name: string; contentType: string; bytes: Uint8Array; width: number | null; height: number | null },
  maxWidthEmu: Emu
): InsertedImage {
  const ext = picked.name.split('.').pop() ?? 'png'
  const mediaKey = nextMediaKey(document_.resources.media, ext)

  document_.resources.media.set(mediaKey, {
    bytes: picked.bytes,
    contentType: picked.contentType
  })

  const relId = `rId${document_.resources.rels.nextId}`
  document_.resources.rels.byId.set(relId, {
    id: relId,
    type: IMAGE_REL_TYPE,
    target: mediaKey.replace(/^word\//, ''),
    targetMode: null
  })
  document_.resources.rels.nextId += 1

  // 画面に出せるようにしておく。ここで登録しないと挿入直後だけ空欄になる
  mediaRegistry.add(mediaKey, picked.bytes, picked.contentType)

  return { mediaKey, relId, ...fitSize(picked.width, picked.height, maxWidthEmu) }
}

/**
 * 表示サイズを決める。
 *
 * 画像のピクセルは 96dpi として点に直す (Word の既定と同じ)。
 * 本文の幅を超える場合は縦横比を保って縮める。
 * 縮めないと、写真 1 枚で用紙からはみ出す。
 */
export function fitSize(
  widthPx: number | null,
  heightPx: number | null,
  maxWidthEmu: Emu
): { cx: Emu; cy: Emu } {
  // 分からない場合は 4cm 角。Word も寸法不明の画像を既定サイズで置く
  if (!widthPx || !heightPx) {
    const side = ptToEmu(113)
    return { cx: Math.min(side, maxWidthEmu), cy: side }
  }

  const cx = ptToEmu((widthPx / 96) * 72)
  const cy = ptToEmu((heightPx / 96) * 72)
  if (cx <= maxWidthEmu) return { cx, cy }

  const scale = maxWidthEmu / cx
  return { cx: maxWidthEmu, cy: Math.round(cy * scale) }
}

/** 画像ノードを本文に挿入する */
export function insertImage(editor: Editor, image: InsertedImage, name: string): void {
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'image',
      attrs: {
        mediaKey: image.mediaKey,
        relId: image.relId,
        cx: image.cx,
        cy: image.cy,
        wrap: 'inline',
        name,
        descr: '',
        inline: true,
        rawDrawing: null
      }
    })
    .run()
}

/** 点で見た本文の幅。挿入サイズの上限に使う */
export function textWidthEmu(pgSzW: number, marLeft: number, marRight: number): Emu {
  const twip = Math.max(1440, pgSzW - marLeft - marRight)
  return ptToEmu(twip / 20)
}

/** 画面に出す寸法 (pt)。E2E から確かめるために公開する */
export function sizeInPt(image: InsertedImage): { w: number; h: number } {
  return { w: emuToPt(image.cx), h: emuToPt(image.cy) }
}
