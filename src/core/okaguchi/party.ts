/**
 * 岡口マクロの「当事者欄作成」(Alt+M 自然人・代理人 / Alt+K 法人)。
 *
 * 略語の入力 (g → 原告、gsb → 原告訴訟代理人弁護士、@k → 株式会社 など) から、
 * 字下げと均等割り付けの付いた当事者欄の段落を組み立てる。
 * 氏名は左から 23 字目にそろう (地位の幅によって字下げを変える)。
 *
 * 出典: 岡口マクロ_自然人当事者欄作成.frm、岡口マクロ_法人当事者欄作成.frm。
 *
 * 元のマクロとの違い (不具合を直したもの):
 * - 6s が「上記6６名」になっていた → 上記６名
 * - 本籍に「同」と入れても住所と同じ扱いにならなかった → d / 同 のどちらでもよい
 * - 短い本籍 (東京都港区) が「国籍」になっていた → 都道府県を含めば本籍
 * - 生年月日は小文字の元号記号しか読まなかった → 大文字や西暦も読む (和暦で出す)
 * - 法人の文字数警告が肩書の欄を見ていた → 郵便番号を見る
 */
import { toNarrowAscii, toWideAscii, parseDateInput, warekiYear } from './dates'
import { sjisWidth } from './wideChar'

/** 段落の中の文字。fit を指定すると、その字数の幅に均等割り付けする */
export interface PartyRun {
  text: string
  fit?: number
}

export interface PartyLine {
  /** 左の字下げ (字数)。半端 (9.5 字など) もある */
  indent: number
  runs: PartyRun[]
  /** 段落の配置。既定は左 (両端) */
  align?: 'center'
}

/** 氏名の書き出し位置 (左から何字目か) */
export const NAME_COLUMN = 23
/** 郵便番号と住所の合計がこれを超えたら、2 段目に分けるよう勧める */
export const ADDRESS_LIMIT = 35

const SPACE = '\u3000'

// ---- 郵便番号 ----

/** 郵便番号を「〒１０５－０００１」にする。形が分からなければ全角にするだけ */
export function formatZip(input: string): string {
  const raw = input.trim()
  if (raw === '') return ''
  const narrow = toNarrowAscii(raw).replace(/^〒/, '').replace(/[ー−‐―]/g, '-')
  const m = /^(\d{3})-?(\d{4})$/.exec(narrow)
  if (m) return `〒${toWideAscii(m[1]!)}－${toWideAscii(m[2]!)}`
  return toWideAscii(raw)
}

/** 郵便番号と住所 1 段目の文字数。ADDRESS_LIMIT を超えたら分けるよう勧める */
export function addressLength(zip: string, address: string): number {
  const z = formatZip(zip)
  return z.length + (z ? 1 : 0) + address.trim().length
}

// ---- 地位 ----

const PERSON_EXACT: Record<string, string> = {
  d: '同',
  sf: '訴訟復代理人弁護士',
  同s: '同訴訟代理人弁護士',
  同db: '同代理人弁護士',
  同dt: '同代表者代表取締役',
  同t: '同代表者取締役',
  同r: '同代表者理事',
  同sf: '同訴訟復代理人弁護士',
  '2s': '上記両名訴訟代理人弁護士',
  '2sf': '上記両名訴訟復代理人弁護士',
  sd: '指定代理人',
  同sd: '同指定代理人',
  // 家事事件の事件本人 (元のマクロの表どおり。上告人は jsb のように続けて入れる)
  j: '事件本人'
}
for (let n = 3; n <= 9; n++) {
  PERSON_EXACT[`${n}s`] = `上記${toWideAscii(String(n))}名訴訟代理人弁護士`
  PERSON_EXACT[`${n}sf`] = `上記${toWideAscii(String(n))}名訴訟復代理人弁護士`
}

/** 先頭の略語。長いものから順に調べる (元のマクロの順) */
const PREFIXES: [string, string][] = [
  ['hkh', '被控訴人兼附帯控訴人'],
  ['khg', '甲事件被告(乙事件原告)'],
  ['kgh', '甲事件原告(乙事件被告)'],
  ['gh', '本訴原告(反訴被告)'],
  ['hk', '被控訴人'],
  ['hj', '被上告人'],
  ['kh', '控訴人兼附帯被控訴人'],
  ['hg', '本訴被告(反訴原告)'],
  ['sk', '債権者'],
  ['sm', '債務者'],
  ['g', '原告'],
  ['k', '控訴人'],
  ['j', '上告人'],
  ['m', '申立人'],
  ['h', '被告'],
  ['a', '相手方'],
  ['あ', '相手方']
]

const SUFFIXES: [string, string][] = [
  ['sb', '訴訟代理人弁護士'],
  ['db', '代理人弁護士']
]

/** 自然人の画面の「原告・被告等」を展開する */
export function expandPersonRole(input: string): string {
  const s = toNarrowAscii(input.trim())
  if (s === '') return ''
  const exact = PERSON_EXACT[s]
  if (exact) return exact
  let out = s
  for (const [abbr, full] of PREFIXES) {
    if (out.startsWith(abbr)) {
      out = full + out.slice(abbr.length)
      break
    }
  }
  for (const [abbr, full] of SUFFIXES) {
    if (out.endsWith(abbr)) {
      out = out.slice(0, out.length - abbr.length) + full
      break
    }
  }
  return out
}

const CORP_ROLES: Record<string, string> = {
  d: '同',
  g: '原告',
  k: '控訴人',
  j: '上告人',
  m: '申立人',
  sk: '債権者',
  hkh: '被控訴人兼附帯控訴人',
  gh: '本訴原告(反訴被告)',
  kgh: '甲事件原告(乙事件被告)',
  h: '被告',
  hk: '被控訴人',
  hj: '被上告人',
  a: '相手方',
  あ: '相手方',
  sm: '債務者',
  kh: '控訴人兼附帯被控訴人',
  hg: '本訴被告(反訴原告)',
  khg: '甲事件被告(乙事件原告)'
}

/** 法人の画面の「原告・被告等」(全体一致だけ) */
export function expandCorpRole(input: string): string {
  const s = toNarrowAscii(input.trim())
  return CORP_ROLES[s] ?? s
}

const CORP_KINDS: [string[], string][] = [
  [['@gd'], '合同会社'],
  [['@gm'], '合名会社'],
  [['@gs'], '合資会社'],
  [['@is', '@いs'], '一般社団法人'],
  [['@iz', '@いz'], '一般財団法人'],
  [['@ks'], '公益社団法人'],
  [['@kz'], '公益財団法人'],
  [['@np', '@んp'], '特定非営利活動法人'],
  [['@k'], '株式会社'],
  [['@y'], '有限会社']
]

/** 法人名の略語 (@k → 株式会社 など) を展開する。略語が無ければ入力のまま */
export function expandCorpName(input: string): string {
  const s = input.trim()
  const narrow = toNarrowAscii(s)
  for (const [abbrs, kind] of CORP_KINDS) {
    for (const abbr of abbrs) {
      if (narrow.startsWith(abbr)) return kind + toWideAscii(s.slice(abbr.length))
    }
  }
  for (const [abbrs, kind] of CORP_KINDS) {
    for (const abbr of abbrs) {
      if (narrow.endsWith(abbr)) return toWideAscii(s.slice(0, s.length - abbr.length)) + kind
    }
  }
  return s
}

const TITLES: Record<string, string> = { dt: '代表取締役', dr: '代表理事', t: '取締役', r: '理事' }

export function expandTitle(input: string): string {
  const s = toNarrowAscii(input.trim())
  return TITLES[s] ?? input.trim()
}

// ---- 生年月日・本籍 ----

/** 生年月日を「昭和６０年５月２４日生」にする。読めなければ入力のまま「生」を付ける */
export function formatBirth(input: string): string {
  const s = input.trim()
  if (s === '') return ''
  // 今日の年は使わない (年の無い入力は生年月日として読まない)
  const parsed = /\//.test(toNarrowAscii(s)) && toNarrowAscii(s).split('/').length === 3
    ? parseDateInput(s, { y: 2000, m: 1, d: 1 })
    : null
  if (!parsed) return `${s}生`
  const era = warekiYear(parsed) ?? `${parsed.y}年`
  return `${toWideAscii(era)}${toWideAscii(String(parsed.m))}月${toWideAscii(String(parsed.d))}日生`
}

/** 本籍が「住所と同じ」の指定か */
function isSameAsAddress(input: string): boolean {
  const s = toNarrowAscii(input.trim())
  return s === 'd' || s === 'D' || s === '同'
}

/** 本籍の見出し。都道府県を含むか 8 字以上なら本籍、短い地名だけなら国籍 */
function domicileLabel(text: string): string {
  return /[都道府県]/.test(text) || text.length >= 8 ? '本籍' : '国籍'
}

// ---- 組み立て ----

/** 地位の字下げと割り付け (自然人・法人で共通)。氏名が 23 字目から始まるようにする */
function roleLayout(role: string): { indent: number; runs: PartyRun[] } {
  if ([...role].length === 1) return { indent: 10, runs: [{ text: role + SPACE.repeat(12) }] }
  const b = sjisWidth(role)
  const indent = b < 20 ? 10 : b > 34 ? 3 : 10 - (b - 20) / 2
  const fit = b < 20 ? 10 : b > 34 ? 17 : undefined
  return { indent, runs: [{ text: role, fit }, { text: SPACE.repeat(3) }] }
}

class Lines {
  readonly lines: PartyLine[] = []
  private current: PartyLine | null = null
  open(indent: number): void {
    this.current = { indent, runs: [] }
    this.lines.push(this.current)
  }
  push(run: PartyRun): void {
    if (!this.current) this.open(1)
    if (run.text) this.current!.runs.push(run)
  }
  get hasLine(): boolean {
    return this.current !== null
  }
}

export interface PersonInput {
  role: string
  name: string
  zip: string
  address1: string
  address2: string
  domicile: string
  alias: string
  birth: string
}

/** 自然人・代理人の当事者欄 */
export function buildPersonParty(input: PersonInput): PartyLine[] {
  const out = new Lines()
  const zip = formatZip(input.zip)
  let address1 = toWideAscii(input.address1.trim())
  const address2 = toWideAscii(input.address2.trim())
  const role = expandPersonRole(input.role)
  const name = input.name.trim()
  const alias = input.alias.trim()
  const birth = formatBirth(input.birth)

  const hasDomicile = input.domicile.trim() !== ''
  const same = hasDomicile && isSameAsAddress(input.domicile)
  if (hasDomicile) {
    const domicile = same ? address1 : toWideAscii(input.domicile.trim())
    if (same) address1 = '本籍に同じ'
    out.open(1)
    out.push({ text: `${domicileLabel(domicile)}${SPACE}${domicile}` })
    if (same && address2) {
      out.open(4)
      out.push({ text: address2 })
    }
    out.open(1)
    out.push({ text: `住所${SPACE}` })
  }
  if (zip || address1) {
    if (!out.hasLine) out.open(1)
    if (zip) out.push({ text: zip + SPACE })
    out.push({ text: address1 })
  }
  if (address2 && !same) {
    const shortEnough = address2.length < (hasDomicile ? 24 : 27)
    const indent = zip && shortEnough ? (hasDomicile ? 14 : 11) : hasDomicile ? 4 : 1
    out.open(indent)
    out.push({ text: address2 })
  }

  if (role) {
    const layout = roleLayout(role)
    out.open(layout.indent)
    layout.runs.forEach((r) => out.push(r))
    if (alias) {
      out.push({ text: `${alias}こと`, fit: 13 })
      if (name) {
        out.open(NAME_COLUMN)
        out.push({ text: name, fit: 13 })
      }
    } else if (name) {
      out.push({ text: name, fit: 13 })
    }
  } else if (alias) {
    out.open(NAME_COLUMN)
    out.push({ text: `${alias}こと`, fit: 13 })
    if (name) {
      out.open(NAME_COLUMN)
      out.push({ text: name, fit: 13 })
    }
  } else if (name) {
    out.open(NAME_COLUMN)
    out.push({ text: name, fit: 13 })
  }
  if (birth) {
    out.open(NAME_COLUMN)
    out.push({ text: birth, fit: 13 })
  }
  return out.lines.filter((l) => l.runs.length > 0)
}

export interface CorpInput {
  role: string
  corpName: string
  title: string
  representative: string
  zip: string
  address1: string
  address2: string
}

/** 法人の当事者欄 */
export function buildCorpParty(input: CorpInput): PartyLine[] {
  const out = new Lines()
  const zip = formatZip(input.zip)
  const address1 = toWideAscii(input.address1.trim())
  const address2 = toWideAscii(input.address2.trim())
  const role = expandCorpRole(input.role)
  const corpName = expandCorpName(input.corpName)
  const title = input.title.trim() ? expandTitle(input.title) : ''
  const representative = input.representative.trim()

  if (zip || address1) {
    out.open(1)
    if (zip) out.push({ text: zip + SPACE })
    out.push({ text: address1 })
  }
  if (address2) {
    out.open(zip && address2.length < 27 ? 11 : 1)
    out.push({ text: address2 })
  }

  if (role) {
    const layout = roleLayout(role)
    out.open(layout.indent)
    layout.runs.forEach((r) => out.push(r))
    if (corpName) out.push({ text: corpName, fit: 13 })
  } else if (corpName) {
    out.open(NAME_COLUMN)
    out.push({ text: corpName, fit: 13 })
  }

  if (title) {
    // 肩書の行の字下げは地位の幅で決める (元のマクロと同じ)
    const indent = role ? roleLayout(role).indent : 10
    out.open(indent)
    // 「上記代表者」+ 肩書を 10 字幅に。長い肩書 (代表執行役社長など) は 10 字幅に縮まる
    out.push({ text: `上記代表者${title}`, fit: 10 })
    out.push({ text: SPACE.repeat(3) })
    if (representative) out.push({ text: representative, fit: 13 })
  } else if (representative) {
    out.open(NAME_COLUMN)
    out.push({ text: representative, fit: 13 })
  }
  return out.lines.filter((l) => l.runs.length > 0)
}
