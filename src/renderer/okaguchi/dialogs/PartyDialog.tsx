import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import {
  buildPersonParty,
  buildCorpParty,
  addressLength,
  ADDRESS_LIMIT,
  type PartyLine
} from '@core/okaguchi/party'
import { insertLines } from '../insert'
import { documentPitchTwip } from '../pitch'

interface FieldSpec<K extends string> {
  key: K
  label: string
  guide: string
}

const PERSON_FIELDS: FieldSpec<keyof PersonState>[] = [
  {
    key: 'role',
    label: '原告・被告等',
    guide:
      'g 原告 / h 被告 / k 控訴人 / hk 被控訴人 / j 上告人 / hj 被上告人 / m 申立人 / a 相手方 / sk 債権者 / sm 債務者 / d 同。' +
      '後ろに sb で訴訟代理人弁護士、db で代理人弁護士 (例: gsb → 原告訴訟代理人弁護士)。' +
      '2s〜9s → 上記両名 (３名…) 訴訟代理人弁護士、sf → 訴訟復代理人弁護士、sd → 指定代理人、j → 事件本人'
  },
  { key: 'name', label: '氏名', guide: '氏名を直接入力してください。' },
  { key: 'zip', label: '郵便番号', guide: '〒・ハイフンは省略できます。(例) 1050001 → 〒１０５－０００１' },
  { key: 'address1', label: '住所 (1 段目)', guide: '住所が長い場合は、1・2 段目に分けて記入してください。' },
  { key: 'address2', label: '住所 (2 段目)', guide: '住所が長い場合は、1・2 段目に分けて記入してください。' },
  { key: 'domicile', label: '本籍', guide: '住所と同じ場合は「同」又は「d」と入力してください。' },
  { key: 'alias', label: '通称', guide: '通称の後に「こと」と自動的に入ります。' },
  {
    key: 'birth',
    label: '生年月日',
    guide: '末尾に「生」と自動的に入ります。(例) s60/5/24 → 昭和６０年５月２４日生、h1/7/6 → 平成元年７月６日生'
  }
]

const CORP_FIELDS: FieldSpec<keyof CorpState>[] = [
  {
    key: 'role',
    label: '原告・被告等',
    guide: 'g 原告 / h 被告 / k 控訴人 / hk 被控訴人 / j 上告人 / hj 被上告人 / m 申立人 / a 相手方 / sk 債権者 / sm 債務者 / d 同'
  },
  {
    key: 'corpName',
    label: '法人名',
    guide:
      '@k 株式会社 / @y 有限会社 / @gd 合同会社 / @gm 合名会社 / @gs 合資会社 / @is 一般社団法人 / @iz 一般財団法人 / ' +
      '@ks 公益社団法人 / @kz 公益財団法人 / @np 特定非営利活動法人。前か後ろに付けます (例: ザイフリート@k)'
  },
  { key: 'title', label: '肩書', guide: 'dt 代表取締役 / dr 代表理事 / t 取締役 / r 理事。それ以外は直接入力' },
  { key: 'representative', label: '代表者氏名', guide: '代表者の氏名を直接入力してください。' },
  { key: 'zip', label: '郵便番号', guide: '〒・ハイフンは省略できます。(例) 1000013 → 〒１００－００１３' },
  { key: 'address1', label: '住所 (1 段目)', guide: '住所が長い場合は、1・2 段目に分けて記入してください。' },
  { key: 'address2', label: '住所 (2 段目)', guide: '住所が長い場合は、1・2 段目に分けて記入してください。' }
]

type PersonState = Record<'role' | 'name' | 'zip' | 'address1' | 'address2' | 'domicile' | 'alias' | 'birth', string>
type CorpState = Record<'role' | 'corpName' | 'title' | 'representative' | 'zip' | 'address1' | 'address2', string>

function emptyOf<K extends string>(fields: FieldSpec<K>[]): Record<K, string> {
  return Object.fromEntries(fields.map((f) => [f.key, ''])) as Record<K, string>
}

/** 当事者欄作成 (Alt+M 自然人・代理人 / Alt+K 法人) */
export function PartyDialog({
  kind,
  editor,
  onClose
}: {
  kind: 'person' | 'corp'
  editor: Editor | null
  onClose: () => void
}): React.JSX.Element {
  return kind === 'person' ? (
    <PartyForm
      title="当事者欄作成 (自然人・代理人)"
      fields={PERSON_FIELDS}
      build={(v) => buildPersonParty(v)}
      editor={editor}
      onClose={onClose}
      testId="person"
    />
  ) : (
    <PartyForm
      title="当事者欄作成 (法人)"
      fields={CORP_FIELDS}
      build={(v) => buildCorpParty(v)}
      editor={editor}
      onClose={onClose}
      testId="corp"
    />
  )
}

function PartyForm<K extends string>({
  title,
  fields,
  build,
  editor,
  onClose,
  testId
}: {
  title: string
  fields: FieldSpec<K>[]
  build: (values: Record<K, string>) => PartyLine[]
  editor: Editor | null
  onClose: () => void
  testId: string
}): React.JSX.Element {
  const [values, setValues] = useState<Record<K, string>>(() => emptyOf(fields))
  const [focused, setFocused] = useState<K>(fields[0]!.key)
  const lines = build(values)
  const v = values as Record<string, string>
  const length = addressLength(v['zip'] ?? '', v['address1'] ?? '')

  const submit = (): void => {
    if (!editor || lines.length === 0) return
    insertLines(editor, lines, documentPitchTwip())
    onClose()
  }

  return (
    <Dialog title={title} open onClose={onClose} onSubmit={submit} submitDisabled={lines.length === 0} width={560}>
      <div className="wowd-dialog-grid">
        {fields.map((f, i) => (
          <PartyField
            key={f.key}
            spec={f}
            value={values[f.key]}
            autoFocus={i === 0}
            testId={`okaguchi-${testId}-${f.key}`}
            onFocus={() => setFocused(f.key)}
            onChange={(text) => setValues((cur) => ({ ...cur, [f.key]: text }))}
          />
        ))}
      </div>
      <p className="wowd-dialog-note" data-testid="okaguchi-guide">
        {fields.find((f) => f.key === focused)?.guide}
      </p>
      {length > ADDRESS_LIMIT && (
        <p className="wowd-dialog-note wowd-dialog-error">
          郵便番号・住所の文字数が 1 行の文字数を超えています。超過 ({length - ADDRESS_LIMIT} 文字) 分を 2 段目に記入することをお勧めします。
        </p>
      )}
      <p className="wowd-dialog-note">全ての項目について、半角・全角いずれでも入力できます。</p>
      <div className="wowd-dialog-preview okaguchi-party-preview" data-testid="okaguchi-preview">
        {lines.map((line, i) => (
          <div key={i} style={{ paddingLeft: `${line.indent}em` }}>
            {line.runs.map((run, j) =>
              run.fit ? (
                <span key={j} className="okaguchi-fit" style={{ width: `${run.fit}em` }}>
                  {run.text}
                </span>
              ) : (
                <span key={j}>{run.text}</span>
              )
            )}
          </div>
        ))}
        {lines.length === 0 && ' '}
      </div>
    </Dialog>
  )
}

function PartyField({
  spec,
  value,
  autoFocus,
  testId,
  onFocus,
  onChange
}: {
  spec: FieldSpec<string>
  value: string
  autoFocus: boolean
  testId: string
  onFocus: () => void
  onChange: (text: string) => void
}): React.JSX.Element {
  const id = `okaguchi-field-${testId}`
  return (
    <>
      <label htmlFor={id}>{spec.label}</label>
      <input
        id={id}
        autoFocus={autoFocus}
        value={value}
        data-testid={testId}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  )
}
