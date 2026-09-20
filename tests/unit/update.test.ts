import { describe, it, expect } from 'vitest'
import { compareVersions } from '../../src/main/update'

/**
 * 版の比較。
 *
 * 文字列の大小で比べると "0.10.0" < "0.9.0" になり、
 * **新しい版が出ているのに「最新です」と言う**。
 * 気づきにくいので、数値として比べていることを押さえておく。
 */
describe('版の比較', () => {
  it('数値として比べる', () => {
    expect(compareVersions('0.10.0', '0.9.0'), '桁上がりを文字列で比べている').toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
  })

  it('前置きの v を無視する', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('v1.3.0', '1.2.0')).toBe(1)
  })

  it('桁数が違っても比べられる', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })

  it('読めない値は 0 として扱い、落ちない', () => {
    expect(compareVersions('壊れた', '0.0.0')).toBe(0)
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0)
  })
})
