// 관리 구간 merge다. Markdown
// 지침 파일의 `<!-- begin lophn-managed -->`와 `<!-- end lophn-managed -->`
// 사이만 lophn 소유이고 바깥 사람 내용은 바이트 그대로 둔다. marker가 없거나
// 중복·불완전·짝이 맞지 않으면 무변경이다(broken). 새 파일 만들기는 별도 명시
// plan의 몫이라 여기서 구간을 새로 만들지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";

export const BEGIN_MARKER = "<!-- begin lophn-managed -->";
export const END_MARKER = "<!-- end lophn-managed -->";

export type ParseFailure = { kind: "broken" };

export type SetOutcome =
  | { kind: "unchanged" }
  | { kind: "changed"; text: string }
  | ParseFailure;

type Span = { bodyStart: number; bodyEnd: number; begin: number; end: number };

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// 짝이 맞는 구간 하나의 위치다.
function spanOf(text: string): Result<Span, ParseFailure> {
  if (count(text, BEGIN_MARKER) !== 1 || count(text, END_MARKER) !== 1) {
    return err({ kind: "broken" });
  }
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  if (end < begin) return err({ kind: "broken" });
  return ok({
    begin,
    bodyStart: begin + BEGIN_MARKER.length,
    bodyEnd: end,
    end: end + END_MARKER.length,
  });
}

// 구간 안쪽을 body로 바꾼다. body는 앞뒤 newline 하나씩으로 감싼다.
export function setRegion(text: string, body: string): SetOutcome {
  const span = spanOf(text);
  if (!span.ok) return span.error;
  const inner = `\n${body}\n`;
  if (text.slice(span.value.bodyStart, span.value.bodyEnd) === inner) {
    return { kind: "unchanged" };
  }
  return {
    kind: "changed",
    text: text.slice(0, span.value.bodyStart) + inner +
      text.slice(span.value.bodyEnd),
  };
}

// 구간 안쪽만 비운다. marker는 사람이 둔 것이라 남긴다.
export function removeRegion(text: string): SetOutcome {
  const span = spanOf(text);
  if (!span.ok) return span.error;
  if (text.slice(span.value.bodyStart, span.value.bodyEnd) === "\n") {
    return { kind: "unchanged" };
  }
  return {
    kind: "changed",
    text: text.slice(0, span.value.bodyStart) + "\n" +
      text.slice(span.value.bodyEnd),
  };
}

// 구간 안쪽이다. 빈 구간과 marker 없는 파일은 null이라 receipt 없는 첫 설치가
// conflict가 아니다. marker 없는 파일은 setRegion이 broken으로 무변경이다.
export function regionFragment(
  text: string,
): Result<string | null, ParseFailure> {
  const hasAny = text.includes(BEGIN_MARKER) || text.includes(END_MARKER);
  if (!hasAny) return ok(null);
  const span = spanOf(text);
  if (!span.ok) return span;
  const inner = text.slice(span.value.bodyStart, span.value.bodyEnd).trim();
  return ok(inner === "" ? null : inner);
}
