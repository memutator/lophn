// JSON 설정 merge다(coding-agent/harnesses#R8, T29). lophn 소유 key만 바꾸고
// 나머지 key는 그대로 둔다. 깨진 JSON·root가 객체가 아니면 무변경이다(R8).
// 직렬화는 기존 들여쓰기와 끝 newline을 보존해 harness가 다시 쓴 것과
// lophn이 쓴 것을 구분할 수 있게 한다.
import { err, ok, type Result } from "../../../base/mod.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonDocument = { [key: string]: JsonValue };

// 깨진 설정은 고치지 않고 그 사실을 돌려준다(R8 확인).
export type ParseFailure = { kind: "broken" };

export type SetOutcome =
  | { kind: "unchanged" }
  | { kind: "changed"; text: string }
  | ParseFailure;

// 점 경로다. 빈 조각은 거절한다.
function segmentsOf(key: string): string[] | null {
  const segments = key.split(".");
  if (segments.some((segment) => segment === "")) return null;
  return segments;
}

export function parseJson(text: string): Result<JsonDocument, ParseFailure> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err({ kind: "broken" });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return err({ kind: "broken" });
  }
  return ok(value as JsonDocument);
}

function at(document: JsonDocument, key: string): JsonValue | undefined {
  const segments = segmentsOf(key);
  if (segments === null) return undefined;
  let cursor: JsonValue = document;
  for (const segment of segments) {
    if (
      cursor === null || typeof cursor !== "object" || Array.isArray(cursor)
    ) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

// 사람이 쓴 파일의 모양을 유지한다. 탭 들여쓰기와 끝 newline을 따른다.
function shapeOf(text: string): { indent: string; trailing: boolean } {
  const indent = text.match(/\n(\t| {2,})"/)?.[1] ?? "  ";
  return { indent, trailing: text.endsWith("\n") };
}

function write(document: JsonDocument, text: string): string {
  const { indent, trailing } = shapeOf(text);
  const out = JSON.stringify(document, null, indent);
  return trailing ? `${out}\n` : out;
}

// 소유 key만 넣는다(R8). 같은 값이면 파일을 바꾸지 않는다.
export function setOwned(
  text: string,
  key: string,
  value: JsonValue,
): SetOutcome {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  const current = at(parsed.value, key);
  if (JSON.stringify(current) === JSON.stringify(value)) {
    return { kind: "unchanged" };
  }
  let cursor: { [key: string]: JsonValue } = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === undefined) {
      const created: { [key: string]: JsonValue } = {};
      cursor[segment] = created;
      cursor = created;
    } else if (
      next !== null && typeof next === "object" && !Array.isArray(next)
    ) {
      cursor = next;
    } else {
      // 중간에 객체가 아닌 값이 있으면 사람 값을 덮지 않는다(R7, R8).
      return { kind: "broken" };
    }
  }
  cursor[segments[segments.length - 1]] = value;
  return { kind: "changed", text: write(parsed.value, text) };
}

// 소유 key만 지운다(R8 제거). 주변 key는 남긴다. 없으면 무변경이다.
export function removeOwned(text: string, key: string): SetOutcome {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  let cursor: { [key: string]: JsonValue } = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === undefined) return { kind: "unchanged" };
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      return { kind: "broken" };
    }
    cursor = next;
  }
  const leaf = segments[segments.length - 1];
  if (!(leaf in cursor)) return { kind: "unchanged" };
  delete cursor[leaf];
  return { kind: "changed", text: write(parsed.value, text) };
}

// 소유 조각만 꺼낸다. fragment digest의 재료다(R7). 없으면 null이다.
export function ownedFragment(
  text: string,
  key: string,
): Result<JsonValue | null, ParseFailure> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return ok(at(parsed.value, key) ?? null);
}
