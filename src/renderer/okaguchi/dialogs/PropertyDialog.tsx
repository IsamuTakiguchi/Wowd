import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import {
  buildPropertyList,
  type LandInput,
  type BuildingInput,
  type CondoInput,
  type FloorArea
} from '@core/okaguchi/property'
import { insertLines } from '../insert'
import { documentPitchTwip } from '../pitch'
import { Check } from './common'

type Tab = 'land' | 'building' | 'condo'

const floors = (n: number): FloorArea[] => Array.from({ length: n }, () => ({ floor: '', area: '' }))

const EMPTY_LAND: LandInput = { title: '', location: '', lotNumber: '', category: '', area: '', share: '' }
const EMPTY_BUILDING: BuildingInput = {
  title: '',
  location: '',
  houseNumber: '',
  kind: '',
  structure: '',
  floors: floors(6),
  share: '',
  annex: { sign: '', kind: '', structure: '', area1: '', area2: '' }
}
const EMPTY_CONDO: CondoInput = {
  title: '',
  location: '',
  buildingName: '',
  structure: '',
  floors: floors(6),
  houseNumber: '',
  unitName: '',
  unitKind: '',
  unitStructure: '',
  unitFloors: floors(2),
  share: '',
  siteSign: '',
  siteLocation: '',
  siteCategory: '',
  siteArea: '',
  siteKind: '',
  siteRatio: ''
}

/** 物件情報入力 (Alt+B)。物件目録を組み立てて差し込む */
export function PropertyDialog({ editor, onClose }: { editor: Editor | null; onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('land')
  const [land, setLand] = useState(EMPTY_LAND)
  const [building, setBuilding] = useState(EMPTY_BUILDING)
  const [condo, setCondo] = useState(EMPTY_CONDO)
  const [header, setHeader] = useState(false)
  const [annexOnly, setAnnexOnly] = useState(false)
  const [siteOnly, setSiteOnly] = useState(false)

  const lines = buildPropertyList(land, building, condo, { header, annexOnly, siteOnly })

  const insert = (): boolean => {
    if (!editor || lines.length === 0) return false
    insertLines(editor, lines, documentPitchTwip())
    return true
  }

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    testId: string,
    disabled = false,
    unit?: string
  ): React.JSX.Element => (
    <>
      <label htmlFor={`okaguchi-prop-${testId}`}>{label}</label>
      <span className="okaguchi-prop-input">
        <input
          id={`okaguchi-prop-${testId}`}
          value={value}
          disabled={disabled}
          data-testid={`okaguchi-prop-${testId}`}
          onChange={(e) => set(e.target.value)}
        />
        {unit}
      </span>
    </>
  )

  const floorFields = (
    list: FloorArea[],
    set: (next: FloorArea[]) => void,
    prefix: string,
    floorUnit: string,
    disabled: boolean
  ): React.JSX.Element => (
    <>
      <label>床面積</label>
      <span className="okaguchi-prop-floors">
        {list.map((f, i) => (
          <span key={i} className="okaguchi-prop-floor">
            <input
              aria-label={`${i + 1} 行目の階`}
              value={f.floor}
              disabled={disabled}
              data-testid={`okaguchi-prop-${prefix}-floor-${i}`}
              onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, floor: e.target.value } : x)))}
            />
            {floorUnit}
            <input
              aria-label={`${i + 1} 行目の面積`}
              value={f.area}
              disabled={disabled}
              data-testid={`okaguchi-prop-${prefix}-area-${i}`}
              onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))}
            />
            ㎡
          </span>
        ))}
      </span>
    </>
  )

  const mainDisabled = annexOnly || siteOnly

  return (
    <Dialog
      title="物件情報入力"
      open
      onClose={onClose}
      onSubmit={() => {
        if (insert()) onClose()
      }}
      submitDisabled={lines.length === 0}
      width={640}
    >
      <div className="wowd-dialog-tabs" role="tablist">
        {(
          [
            ['land', '土地'],
            ['building', '建物'],
            ['condo', '区分建物']
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : undefined}
            data-testid={`okaguchi-prop-tab-${value}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'land' && (
        <div className="wowd-dialog-grid">
          {field('見出し (付ける場合)', land.title, (v) => setLand({ ...land, title: v }), 'land-title', mainDisabled)}
          {field('所在', land.location, (v) => setLand({ ...land, location: v }), 'land-location', mainDisabled)}
          {field('地番', land.lotNumber, (v) => setLand({ ...land, lotNumber: v }), 'land-lot', mainDisabled)}
          {field('地目', land.category, (v) => setLand({ ...land, category: v }), 'land-category', mainDisabled)}
          {field('地積', land.area, (v) => setLand({ ...land, area: v }), 'land-area', mainDisabled, '㎡')}
          {field('共有持分', land.share, (v) => setLand({ ...land, share: v }), 'land-share', mainDisabled)}
        </div>
      )}

      {tab === 'building' && (
        <div className="wowd-dialog-grid">
          {field('見出し (付ける場合)', building.title, (v) => setBuilding({ ...building, title: v }), 'bld-title', mainDisabled)}
          {field('所在', building.location, (v) => setBuilding({ ...building, location: v }), 'bld-location', mainDisabled)}
          {field('家屋番号', building.houseNumber, (v) => setBuilding({ ...building, houseNumber: v }), 'bld-number', mainDisabled)}
          {field('種類', building.kind, (v) => setBuilding({ ...building, kind: v }), 'bld-kind', mainDisabled)}
          {field('構造', building.structure, (v) => setBuilding({ ...building, structure: v }), 'bld-structure', mainDisabled)}
          {floorFields(building.floors, (next) => setBuilding({ ...building, floors: next }), 'bld', '階', mainDisabled)}
          {field('共有持分', building.share, (v) => setBuilding({ ...building, share: v }), 'bld-share', mainDisabled)}
          <label className="okaguchi-prop-section">附属建物</label>
          <span />
          {field('符号', building.annex.sign, (v) => setBuilding({ ...building, annex: { ...building.annex, sign: v } }), 'annex-sign', siteOnly)}
          {field('種類', building.annex.kind, (v) => setBuilding({ ...building, annex: { ...building.annex, kind: v } }), 'annex-kind', siteOnly)}
          {field('構造', building.annex.structure, (v) => setBuilding({ ...building, annex: { ...building.annex, structure: v } }), 'annex-structure', siteOnly)}
          {field('床面積 1 階', building.annex.area1, (v) => setBuilding({ ...building, annex: { ...building.annex, area1: v } }), 'annex-area1', siteOnly, '㎡')}
          {field('床面積 2 階', building.annex.area2, (v) => setBuilding({ ...building, annex: { ...building.annex, area2: v } }), 'annex-area2', siteOnly, '㎡')}
        </div>
      )}

      {tab === 'condo' && (
        <div className="wowd-dialog-grid">
          {field('見出し (付ける場合)', condo.title, (v) => setCondo({ ...condo, title: v }), 'condo-title', mainDisabled)}
          <label className="okaguchi-prop-section">一棟の建物</label>
          <span />
          {field('所在', condo.location, (v) => setCondo({ ...condo, location: v }), 'condo-location', mainDisabled)}
          {field('建物の名称', condo.buildingName, (v) => setCondo({ ...condo, buildingName: v }), 'condo-name', mainDisabled)}
          {field('構造', condo.structure, (v) => setCondo({ ...condo, structure: v }), 'condo-structure', mainDisabled)}
          {floorFields(condo.floors, (next) => setCondo({ ...condo, floors: next }), 'condo', '階', mainDisabled)}
          <label className="okaguchi-prop-section">専有部分</label>
          <span />
          {field('家屋番号', condo.houseNumber, (v) => setCondo({ ...condo, houseNumber: v }), 'unit-number', mainDisabled)}
          {field('建物の名称', condo.unitName, (v) => setCondo({ ...condo, unitName: v }), 'unit-name', mainDisabled)}
          {field('種類', condo.unitKind, (v) => setCondo({ ...condo, unitKind: v }), 'unit-kind', mainDisabled)}
          {field('構造', condo.unitStructure, (v) => setCondo({ ...condo, unitStructure: v }), 'unit-structure', mainDisabled)}
          {floorFields(condo.unitFloors, (next) => setCondo({ ...condo, unitFloors: next }), 'unit', '階部分', mainDisabled)}
          {field('共有持分', condo.share, (v) => setCondo({ ...condo, share: v }), 'unit-share', mainDisabled)}
          <label className="okaguchi-prop-section">敷地権</label>
          <span />
          {field('土地の符号', condo.siteSign, (v) => setCondo({ ...condo, siteSign: v }), 'site-sign', annexOnly)}
          {field('所在及び地番', condo.siteLocation, (v) => setCondo({ ...condo, siteLocation: v }), 'site-location', annexOnly)}
          {field('地目', condo.siteCategory, (v) => setCondo({ ...condo, siteCategory: v }), 'site-category', annexOnly)}
          {field('地積', condo.siteArea, (v) => setCondo({ ...condo, siteArea: v }), 'site-area', annexOnly, '㎡')}
          {field('敷地権の種類', condo.siteKind, (v) => setCondo({ ...condo, siteKind: v }), 'site-kind', annexOnly)}
          {field('敷地権の割合', condo.siteRatio, (v) => setCondo({ ...condo, siteRatio: v }), 'site-ratio', annexOnly)}
        </div>
      )}

      <div className="wowd-dialog-row okaguchi-prop-options">
        <Check label="冒頭に（別紙）物件目録と記載する" checked={header} onChange={setHeader} />
        <Check
          label="附属建物の記載のみ追加する"
          checked={annexOnly}
          onChange={(on) => {
            setAnnexOnly(on)
            if (on) {
              setSiteOnly(false)
              setTab('building')
            }
          }}
        />
        <Check
          label="敷地権の記載のみ追加する"
          checked={siteOnly}
          onChange={(on) => {
            setSiteOnly(on)
            if (on) {
              setAnnexOnly(false)
              setTab('condo')
            }
          }}
        />
      </div>
      <p className="wowd-dialog-note">全ての項目について、半角・全角いずれでも入力できます (混在も可)。</p>
      <div className="wowd-dialog-preview okaguchi-party-preview" data-testid="okaguchi-preview">
        {lines.map((line, i) => (
          <div key={i} style={line.align === 'center' ? { textAlign: 'center' } : undefined}>
            {line.runs.map((run, j) =>
              run.fit ? (
                <span key={j} className="okaguchi-fit" style={{ width: `${run.fit}em` }}>
                  {run.text}
                </span>
              ) : (
                <span key={j}>{run.text}</span>
              )
            )}
            {line.runs.length === 0 && ' '}
          </div>
        ))}
        {lines.length === 0 && ' '}
      </div>
      <div className="wowd-dialog-row">
        <button
          type="button"
          disabled={lines.length === 0}
          data-testid="okaguchi-prop-continue"
          title="差し込んで空行を 1 つ足し、この画面は開いたままにします"
          onClick={() => {
            if (!insert() || !editor) return
            editor.chain().insertContent({ type: 'paragraph' }).run()
          }}
        >
          続けて入力
        </button>
      </div>
    </Dialog>
  )
}
