import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 保存している最中に打った文字が「保存済み」扱いになって消えないこと。
 *
 * 保存は非同期で、書き出している間も利用者は打てる。以前は保存が終わると
 * 無条件に dirty を下ろしていたので、その間の打鍵は保存済み扱いになり、
 * 次の保存まで誰も書かず、閉じるときの確認も出ずに失われた。
 * 手動保存では稀だが、自動保存は数秒おきに書くので実際に起きる。
 */

// 書き出しの完了を、テストの側で好きな時機に起こせるようにする
let release: (() => void) | null = null
const writes: string[] = []

vi.mock('../../src/renderer/workers/client', () => ({
  docxClient: {
    save: vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = () => resolve(new Uint8Array([9, 9, 9]))
        })
    ),
    open: vi.fn()
  }
}))

vi.mock('../../src/renderer/platform', () => ({
  platform: {
    writeFile: vi.fn(async (path: string) => {
      writes.push(path)
    }),
    addRecent: vi.fn(async () => undefined),
    canWriteInPlace: () => true
  },
  isElectron: false
}))

const { useDocumentStore } = await import('../../src/renderer/store/document')

function loadFakeDocument(): void {
  useDocumentStore.setState({
    document: {
      doc: { type: 'doc', content: [] },
      resources: { comments: new Map() }
    } as never,
    sourceBytes: new Uint8Array([1, 2, 3]),
    filePath: '/tmp/report.docx',
    dirty: true,
    commentsChanged: false,
    saveBlockedReason: null,
    busy: false
  })
}

/** 書き出しが始まって、完了待ちになるまで待つ */
async function untilWriting(): Promise<void> {
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 0))
  if (!release) throw new Error('書き出しが始まらない')
}

beforeEach(() => {
  release = null
  writes.length = 0
  loadFakeDocument()
})

describe('保存中の変更', () => {
  it('途中で何も打たなければ、保存後は未保存の印が下りる', async () => {
    const saving = useDocumentStore.getState().save()
    await untilWriting()
    release?.()
    expect(await saving).toBe(true)
    expect(useDocumentStore.getState().dirty).toBe(false)
  })

  it('書き出している間に打った文字は、保存後も未保存のまま残る', async () => {
    const saving = useDocumentStore.getState().save()
    await untilWriting()

    // 書き出しの最中に打つ
    useDocumentStore.getState().markDirty()

    release?.()
    expect(await saving).toBe(true)
    // ファイルには書いた。けれども打った分はまだ書いていない
    expect(writes).toEqual(['/tmp/report.docx'])
    expect(useDocumentStore.getState().dirty).toBe(true)
  })

  it('書き出している間に足したコメントを、開始時の写しで上書きしない', async () => {
    const saving = useDocumentStore.getState().save()
    await untilWriting()

    useDocumentStore.getState().updateComments((m) =>
      new Map(m).set('c1', { id: 'c1' } as never)
    )

    release?.()
    await saving
    const state = useDocumentStore.getState()
    expect(state.document?.resources.comments.has('c1')).toBe(true)
    // comments.xml を書き直す印も残す。消すと次の保存でコメントが落ちる
    expect(state.commentsChanged).toBe(true)
  })

  it('途中で変更があっても、原本は書いたものに進める', async () => {
    const saving = useDocumentStore.getState().save()
    await untilWriting()
    useDocumentStore.getState().markDirty()
    release?.()
    await saving
    expect(Array.from(useDocumentStore.getState().sourceBytes ?? [])).toEqual([9, 9, 9])
  })
})
