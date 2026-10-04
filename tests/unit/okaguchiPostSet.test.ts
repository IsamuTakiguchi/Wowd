import { describe, it, expect } from 'vitest'
import { planPostSet, type PostSetParagraph } from '@core/okaguchi/postSet'

const p = (text: string, rank: number | null = null): PostSetParagraph => ({ text, rank })
const plan = (texts: (string | PostSetParagraph)[], bodyIndent = true) =>
  [...planPostSet(texts.map((t) => (typeof t === 'string' ? p(t) : t)), { bodyIndent }).entries()].map(
    ([i, c]) => [i, c.kind, c.level, c.strip, c.restart] as const
  )

describe('連番等事後設定', () => {
  it('仕様書の例: 第１ / １ / （１） / 本文 / ２', () => {
    expect(
      plan(['第１　請求の趣旨', '１　被告は、原告に対し、', '（１）主位的請求', '原告は、', '２　訴訟費用は'])
    ).toEqual([
      [0, 'rank', 1, 3, false],
      [1, 'rank', 2, 2, false],
      [2, 'rank', 3, 3, false],
      [3, 'body', 3, 0, false],
      [4, 'rank', 2, 2, false]
    ])
  })

  it('半角で打った符号も見つける', () => {
    expect(plan(['第1 請求', '1 被告は', '(1)主位的'])).toEqual([
      [0, 'rank', 1, 3, false],
      [1, 'rank', 2, 2, false],
      [2, 'rank', 3, 3, false]
    ])
  })

  it('10 以上の番号も見つける (元のマクロは見つけられなかった)', () => {
    const texts = Array.from({ length: 11 }, (_, i) => `第${i + 1}\u3000見出し`)
    const result = plan(texts)
    expect(result).toHaveLength(11)
    expect(result[10]).toEqual([10, 'rank', 1, 4, false])
  })

  it('⑴ ⑵ ⑶ と続けて見つける (元のマクロは ⑵ 以降を見つけられなかった)', () => {
    expect(plan(['⑴　あ', '⑵　い', '⑶ う'])).toEqual([
      [0, 'rank', 3, 2, false],
      [1, 'rank', 3, 2, false],
      [2, 'rank', 3, 2, false]
    ])
  })

  it('ア イ … (ア) (イ) … ａ ｂ … ① ② の各階層', () => {
    expect(plan(['ア　一', 'イ　二', '（ア）三', 'ａ　四', '(a)五', '①　六', '②　七']).map((r) => r[2])).toEqual([
      4, 4, 5, 6, 7, 8, 8
    ])
  })

  it('順番の飛んだ番号は見出しにしない。「１」は振り直し', () => {
    expect(plan(['１　一', '２　二', '５　飛んだ', '１　振り直し'])).toEqual([
      [0, 'rank', 2, 2, false],
      [1, 'rank', 2, 2, false],
      [2, 'body', 2, 0, false],
      [3, 'rank', 2, 2, true]
    ])
  })

  it('上の階層が出ると下の階層は 1 から数え直す (振り直しの指定は要らない)', () => {
    expect(plan(['第１　一', '１　あ', '２　い', '第２　二', '１　う'])).toEqual([
      [0, 'rank', 1, 3, false],
      [1, 'rank', 2, 2, false],
      [2, 'rank', 2, 2, false],
      [3, 'rank', 1, 3, false],
      [4, 'rank', 2, 2, false]
    ])
  })

  it('既に連番ランクの段落はそのまま数に入れ、本文にしない', () => {
    expect(plan([p('請求の趣旨', 1), '１　被告は', p('請求の原因', 1), '１　当事者'])).toEqual([
      [1, 'rank', 2, 2, false],
      [3, 'rank', 2, 2, false]
    ])
  })

  it('本文の字下げを付けない指定', () => {
    expect(plan(['第１　一', '本文'], false)).toEqual([[0, 'rank', 1, 3, false]])
  })

  it('見出しより前の段落は本文にしない', () => {
    expect(plan(['表題', '第１　一'])).toEqual([[1, 'rank', 1, 3, false]])
  })

  it('46 字目のン・⑳ を超えても止まらない', () => {
    const kana = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'
    const texts = [...kana].map((k) => `${k}\u3000x`)
    texts.push('ア　次')
    expect(() => plan(texts)).not.toThrow()
  })
})
