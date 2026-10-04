/**
 * 岡口マクロの「物件情報入力」(Alt+B)。不動産の物件目録を組み立てる。
 *
 * 土地・建物 (附属建物)・区分建物 (一棟の建物・専有部分・敷地権) を、
 * 登記簿の項目ごとの入力から、見出しをそろえた行にする。
 * 値は全角にする (1番1 → １番１、123.45 → １２３．４５)。空の欄の行は出さない。
 *
 * 見出しは均等割り付け (土地・建物は 4 字幅、区分建物は 6 字幅) にする。
 * 元のマクロは横幅を変えた空白を詰めて幅をそろえていたが、
 * 均等割り付け (Word の w:fitText) なら Word でも同じに見え、コピーしても見出しの文字がそのまま残る。
 *
 * 出典: 岡口マクロ_物件情報入力.frm。直した不具合 (仕様 7.4):
 * - 建物の床面積の 5・6 行目に 4 行目の面積が出ていた
 * - 附属建物の床面積 (1 階だけ) が全角にならなかった
 * - 「続けて入力」で専有部分の建物の名称に家屋番号が出ていた
 * - 一棟の建物 (1 階だけ) と敷地権の地積に「㎡」が付かなかった
 * - 一棟の建物の階の番号の欄を読まずに「１階」〜「６階」を出していた
 */
import { toWideAscii } from './dates'
import type { PartyLine, PartyRun } from './party'

const SP = '\u3000'

export interface FloorArea {
  floor: string
  area: string
}

export interface LandInput {
  title: string
  location: string
  lotNumber: string
  category: string
  area: string
  share: string
}

export interface AnnexInput {
  sign: string
  kind: string
  structure: string
  area1: string
  area2: string
}

export interface BuildingInput {
  title: string
  location: string
  houseNumber: string
  kind: string
  structure: string
  /** 床面積。上から順に、面積のある行だけ出す (6 行まで) */
  floors: FloorArea[]
  share: string
  annex: AnnexInput
}

export interface CondoInput {
  title: string
  /** 一棟の建物 */
  location: string
  buildingName: string
  structure: string
  floors: FloorArea[]
  /** 専有部分 */
  houseNumber: string
  unitName: string
  unitKind: string
  unitStructure: string
  unitFloors: FloorArea[]
  share: string
  /** 敷地権 */
  siteSign: string
  siteLocation: string
  siteCategory: string
  siteArea: string
  siteKind: string
  siteRatio: string
}

export interface PropertyOptions {
  /** 冒頭に（別紙）物件目録と書く */
  header: boolean
  /** 附属建物の記載のみ追加する */
  annexOnly: boolean
  /** 敷地権の記載のみ追加する */
  siteOnly: boolean
}

const w = (s: string): string => toWideAscii(s.trim())
const has = (...values: string[]): boolean => values.some((v) => v.trim() !== '')

/** 見出し (幅をそろえる) + 全角空白 2 つ + 値 */
function row(label: string, width: number, value: string, unit = ''): PartyLine {
  return { indent: 0, runs: [{ text: label, fit: width }, { text: SP + SP + value + unit }] }
}

/** 見出しの無い続きの行。見出しの幅 + 2 字を空ける */
function continuation(width: number, text: string): PartyLine {
  return { indent: 0, runs: [{ text: SP.repeat(width + 2) + text }] }
}

/**
 * 床面積の行。階が 2 つ以上なら「１階（全角空白）５０．００㎡」の形で、面積の右端をそろえる。
 *
 * @param suffix 階の後ろの語 (「階」、専有部分は「階部分」)
 */
function floorRows(width: number, floors: FloorArea[], suffix = '階'): PartyLine[] {
  // 面積のある行を上から続く限り
  const used: FloorArea[] = []
  for (const f of floors) {
    if (!f.area.trim()) break
    used.push({ floor: w(f.floor), area: w(f.area) })
  }
  if (used.length === 0) return []
  if (used.length === 1 && !floors[0]!.floor.trim()) return [row('床面積', width, used[0]!.area, '㎡')]
  const floorMax = Math.max(...used.map((f) => [...f.floor].length))
  const areaMax = Math.max(...used.map((f) => [...f.area].length))
  return used.map((f, i) => {
    const pad = SP.repeat(1 + floorMax - [...f.floor].length + areaMax - [...f.area].length)
    const text = `${f.floor}${suffix}${pad}${f.area}㎡`
    return i === 0 ? row('床面積', width, text) : continuation(width, text)
  })
}

export function buildLand(input: LandInput): PartyLine[] {
  const lines: PartyLine[] = []
  if (input.title.trim()) lines.push({ indent: 0, runs: [{ text: input.title.trim() }] })
  if (has(input.location)) lines.push(row('所在', 4, w(input.location)))
  if (has(input.lotNumber)) lines.push(row('地番', 4, w(input.lotNumber)))
  if (has(input.category)) lines.push(row('地目', 4, w(input.category)))
  if (has(input.area)) lines.push(row('地積', 4, w(input.area), '㎡'))
  if (has(input.share)) lines.push(row('共有持分', 4, w(input.share)))
  return lines
}

function annexLines(annex: AnnexInput): PartyLine[] {
  const lines: PartyLine[] = []
  if (has(annex.sign)) lines.push(row('符号', 4, w(annex.sign)))
  if (has(annex.kind)) lines.push(row('種類', 4, w(annex.kind)))
  if (has(annex.structure)) lines.push(row('構造', 4, w(annex.structure)))
  if (has(annex.area1)) {
    lines.push(
      ...floorRows(
        4,
        has(annex.area2)
          ? [
              { floor: '1', area: annex.area1 },
              { floor: '2', area: annex.area2 }
            ]
          : [{ floor: '', area: annex.area1 }]
      )
    )
  }
  return lines
}

export function buildBuilding(input: BuildingInput, options: Pick<PropertyOptions, 'annexOnly'>): PartyLine[] {
  const annex = annexLines(input.annex)
  if (options.annexOnly) return annex
  const lines: PartyLine[] = []
  if (input.title.trim()) lines.push({ indent: 0, runs: [{ text: input.title.trim() }] })
  if (has(input.location)) lines.push(row('所在', 4, w(input.location)))
  if (has(input.houseNumber)) lines.push(row('家屋番号', 4, w(input.houseNumber)))
  if (has(input.kind)) lines.push(row('種類', 4, w(input.kind)))
  if (has(input.structure)) lines.push(row('構造', 4, w(input.structure)))
  lines.push(...floorRows(4, input.floors))
  if (has(input.share)) lines.push(row('共有持分', 4, w(input.share)))
  if (annex.length > 0) {
    lines.push({ indent: 0, runs: [{ text: '（附属建物）' }] }, ...annex)
  }
  return lines
}

function siteLines(input: CondoInput): PartyLine[] {
  const lines: PartyLine[] = []
  if (has(input.siteSign)) lines.push(row('土地の符号', 6, w(input.siteSign)))
  if (has(input.siteLocation)) lines.push(row('所在及び地番', 6, w(input.siteLocation)))
  if (has(input.siteCategory)) lines.push(row('地目', 6, w(input.siteCategory)))
  if (has(input.siteArea)) lines.push(row('地積', 6, w(input.siteArea), '㎡'))
  if (has(input.siteKind)) lines.push(row('敷地権の種類', 6, w(input.siteKind)))
  if (has(input.siteRatio)) lines.push(row('敷地権の割合', 6, w(input.siteRatio)))
  return lines
}

export function buildCondo(input: CondoInput, options: Pick<PropertyOptions, 'siteOnly'>): PartyLine[] {
  const site = siteLines(input)
  if (options.siteOnly) return site
  const lines: PartyLine[] = []
  if (input.title.trim()) lines.push({ indent: 0, runs: [{ text: input.title.trim() }] })

  if (has(input.location, input.buildingName, input.structure)) {
    lines.push({ indent: 0, runs: [{ text: '（一棟の建物の表示）' }] })
  }
  if (has(input.location)) lines.push(row('所在', 6, w(input.location)))
  if (has(input.buildingName)) lines.push(row('建物の名称', 6, w(input.buildingName)))
  if (has(input.structure)) lines.push(row('構造', 6, w(input.structure)))
  // 一棟の建物の階は、番号が空なら 1 階から順に数える
  lines.push(
    ...floorRows(
      6,
      input.floors.map((f, i) => ({
        floor: f.floor.trim() || (input.floors.filter((x) => x.area.trim()).length > 1 ? String(i + 1) : ''),
        area: f.area
      }))
    )
  )

  if (has(input.houseNumber, input.unitName, input.unitKind, input.unitStructure)) {
    lines.push({ indent: 0, runs: [{ text: '（専有部分の建物の表示）' }] })
  }
  if (has(input.houseNumber)) lines.push(row('家屋番号', 6, w(input.houseNumber)))
  if (has(input.unitName)) lines.push(row('建物の名称', 6, w(input.unitName)))
  if (has(input.unitKind)) lines.push(row('種類', 6, w(input.unitKind)))
  if (has(input.unitStructure)) lines.push(row('構造', 6, w(input.unitStructure)))
  const unitFloors = input.unitFloors.filter((f) => has(f.floor, f.area))
  unitFloors.forEach((f, i) => {
    const parts = [f.floor.trim() ? `${w(f.floor)}階部分` : '', f.area.trim() ? `${w(f.area)}㎡` : '']
      .filter(Boolean)
      .join(SP)
    lines.push(i === 0 ? row('床面積', 6, parts) : continuation(6, parts))
  })
  if (has(input.share)) lines.push(row('共有持分', 6, w(input.share)))

  if (site.length > 0) lines.push({ indent: 0, runs: [{ text: '（敷地権の表示）' }] }, ...site)
  return lines
}

/** 物件目録の全体。土地 → 建物 → 区分建物の順 */
export function buildPropertyList(
  land: LandInput,
  building: BuildingInput,
  condo: CondoInput,
  options: PropertyOptions
): PartyLine[] {
  if (options.siteOnly) return buildCondo(condo, options)
  if (options.annexOnly) return buildBuilding(building, options)
  const lines: PartyLine[] = []
  if (options.header) {
    lines.push({ indent: 0, runs: [{ text: '（別紙）' }] })
    lines.push({ indent: 0, runs: [{ text: '物件目録' }], align: 'center' })
  }
  const blocks = [buildLand(land), buildBuilding(building, options), buildCondo(condo, options)].filter(
    (b) => b.length > 0
  )
  blocks.forEach((block, i) => {
    // 物件の間は 1 行空ける
    if (i > 0) lines.push({ indent: 0, runs: [] as PartyRun[] })
    lines.push(...block)
  })
  return lines
}
