import { describe, it, expect } from 'vitest'
import { parseFieldInstruction, resolveField, isResolvableField } from '@core/fields'

const ctx = {
  pageNumber: 3,
  pageCount: 12,
  pageNumberFormat: 'decimal'
}

describe('parseFieldInstruction', () => {
  it('命令名を大文字にする', () => {
    expect(parseFieldInstruction('page').name).toBe('PAGE')
  })

  it('スイッチと引数を分ける', () => {
    const f = parseFieldInstruction('PAGE \\* MERGEFORMAT')
    expect(f.name).toBe('PAGE')
    expect(f.args).toEqual([])
    expect(f.switches).toEqual(['\\* MERGEFORMAT'])
  })

  it('引用符で囲まれた引数を 1 つとして扱う', () => {
    const f = parseFieldInstruction('TOC \\o "1-3" \\h \\z \\u')
    expect(f.name).toBe('TOC')
    expect(f.switches).toContain('\\o 1-3')
    expect(f.switches).toContain('\\h')
  })

  it('PAGEREF のブックマーク名を引数として取る', () => {
    const f = parseFieldInstruction('PAGEREF _Toc12345 \\h')
    expect(f.args).toEqual(['_Toc12345'])
  })

  it('空文字でも壊れない', () => {
    expect(parseFieldInstruction('').name).toBe('')
  })
})

describe('resolveField', () => {
  it('PAGE は現在のページ番号', () => {
    expect(resolveField('PAGE', ctx)).toBe('3')
    expect(resolveField('PAGE \\* MERGEFORMAT', ctx)).toBe('3')
  })

  it('NUMPAGES は総ページ数', () => {
    expect(resolveField('NUMPAGES', ctx)).toBe('12')
  })

  it('書式スイッチでローマ数字になる', () => {
    expect(resolveField('PAGE \\* roman', ctx)).toBe('iii')
  })

  it('セクションの番号書式に従う', () => {
    expect(resolveField('PAGE', { ...ctx, pageNumberFormat: 'japaneseCounting' })).toBe('三')
    expect(resolveField('PAGE', { ...ctx, pageNumberFormat: 'upperRoman' })).toBe('III')
  })

  it('MERGEFORMAT は番号書式を変えない', () => {
    expect(resolveField('PAGE \\* MERGEFORMAT', { ...ctx, pageNumberFormat: 'upperRoman' })).toBe(
      'III'
    )
  })

  it('PAGEREF はブックマークのあるページ番号', () => {
    const bookmarkPages = new Map([['_Toc1', 7]])
    expect(resolveField('PAGEREF _Toc1 \\h', { ...ctx, bookmarkPages })).toBe('7')
  })

  it('未知のブックマークは解決しない', () => {
    expect(resolveField('PAGEREF _Missing \\h', ctx)).toBeNull()
  })

  it('計算し直すと内容が変わるフィールドには触らない', () => {
    // DATE や TOC を勝手に再計算すると文書の内容が変わってしまう
    expect(resolveField('DATE \\@ "yyyy/MM/dd"', ctx)).toBeNull()
    expect(resolveField('TOC \\o "1-3" \\h', ctx)).toBeNull()
    expect(resolveField('HYPERLINK "https://example.com"', ctx)).toBeNull()
  })
})

describe('isResolvableField', () => {
  it('ページ番号系だけが計算対象', () => {
    expect(isResolvableField('PAGE')).toBe(true)
    expect(isResolvableField('NUMPAGES')).toBe(true)
    expect(isResolvableField('PAGEREF _Toc1')).toBe(true)
    expect(isResolvableField('TOC \\o "1-3"')).toBe(false)
    expect(isResolvableField('DATE')).toBe(false)
  })
})
