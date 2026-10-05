// Term의 순수 규칙. 이름 비교·근거 동일성·정의 상태·glossary page 계산이다.
import type { TermEvidence } from "../../contracts/documents/mod.ts";

// 같은 이름 비교는 정확한 문자열이다. Unicode 정규화·case 비교·번역·별칭으로
// 넓히지 않는다(documents/terms#R3).
export function sameName(a: string, b: string): boolean {
  return a === b;
}

// 정의가 있으면 정의됨, 없으면 후보다. 별도 status 열은 없다.
export function isCandidate(term: { definition: string | null }): boolean {
  return term.definition === null;
}

// 근거의 동일성 key. null-safe라서 같은 null도 같은 근거다.
export function evidenceKey(value: TermEvidence): string {
  return JSON.stringify([
    value.document,
    value.version,
    value.section,
    value.start_line,
    value.end_line,
  ]);
}

export function sameEvidence(
  a: readonly TermEvidence[],
  b: readonly TermEvidence[],
): boolean {
  return a.length === b.length &&
    a.every((item, index) => evidenceKey(item) === evidenceKey(b[index]));
}

// 근거가 section 또는 줄 범위를 가리키는가. 문서 id·판만 있는 근거는 아니다.
export function locatesEvidence(value: TermEvidence): boolean {
  return value.section !== null || value.start_line !== null;
}

// 후보의 근거는 1개 이상이고 모두 section 또는 줄 범위를 가리킨다.
export function validCandidateEvidence(
  items: readonly TermEvidence[],
): boolean {
  return items.length >= 1 && items.every(locatesEvidence);
}

// glossary 한 page의 두 목록 위치. cursor는 정의 위치와 후보 위치를 같이 담는다:
// 정의는 page마다 limit개, 후보도 같은 limit으로 이어 읽어 어느 쪽도 잃지 않는다.
export type GlossaryPosition = { definitions: number; candidates: number };

const CURSOR = /^(0|[1-9][0-9]{0,15})\.(0|[1-9][0-9]{0,15})$/;

export function encodeGlossaryCursor(position: GlossaryPosition): string {
  return `${position.definitions}.${position.candidates}`;
}

export function decodeGlossaryCursor(
  cursor: string | undefined,
): GlossaryPosition | null {
  if (cursor === undefined) return { definitions: 0, candidates: 0 };
  const match = CURSOR.exec(cursor);
  if (match === null) return null;
  const definitions = Number(match[1]);
  const candidates = Number(match[2]);
  return Number.isSafeInteger(definitions) && Number.isSafeInteger(candidates)
    ? { definitions, candidates }
    : null;
}
