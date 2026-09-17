import type { WowdResources } from '@core/model/types'

/**
 * 文書のメディアを blob URL にして配る。
 *
 * 画像は文書の中にバイト列として入っているので、表示するには
 * ブラウザが読める URL に変える必要がある。
 * data URL だと巨大な文字列が DOM に載るので blob を使う。
 *
 * 文書を閉じたら URL を解放する。解放し忘れるとメモリを掴んだままになる。
 */
class MediaRegistry {
  private urls = new Map<string, string>()

  /** 文書を差し替える。前の文書の URL はすべて解放する */
  load(resources: WowdResources | null): void {
    this.clear()
    if (!resources) return
    for (const [key, entry] of resources.media) {
      try {
        const blob = new Blob([entry.bytes as BlobPart], { type: entry.contentType })
        this.urls.set(key, URL.createObjectURL(blob))
      } catch {
        // 1 つ壊れていても他の画像は出したい
      }
    }
  }

  get(mediaKey: string): string | null {
    return this.urls.get(mediaKey) ?? null
  }

  clear(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
  }
}

export const mediaRegistry = new MediaRegistry()
