// NumberField 확정 판정(순수, 시험용). 읽은 값이 유한 수면 set, 아니면 rejected
export type NumberCommit = { kind: 'set'; value: number } | { kind: 'rejected' }

export function numberCommit(draft: string, parse: (text: string) => number | null): NumberCommit {
  const parsed = parse(draft)
  return parsed !== null && Number.isFinite(parsed)
    ? { kind: 'set', value: parsed }
    : { kind: 'rejected' }
}
