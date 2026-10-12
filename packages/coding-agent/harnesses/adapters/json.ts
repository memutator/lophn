// JSON 설정 merge다. lophn 소유 key만 바꾸고
// 나머지 key는 그대로 둔다. 깨진 JSON·root가 객체가 아니면 무변경이다.
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

// 깨진 설정은 고치지 않고 그 사실을 돌려준다.
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

// 소유 key만 넣는다. 같은 값이면 파일을 바꾸지 않는다.
function setKey(
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
      // 중간에 객체가 아닌 값이 있으면 사람 값을 덮지 않는다.
      return { kind: "broken" };
    }
  }
  cursor[segments[segments.length - 1]] = value;
  return { kind: "changed", text: write(parsed.value, text) };
}

// 소유 key만 지운다. 주변 key는 남긴다. 없으면 무변경이다.
function removeKey(text: string, key: string): SetOutcome {
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

// 소유 조각만 꺼낸다. fragment digest의 재료다. 없으면 null이다.
function keyFragment(
  text: string,
  key: string,
): Result<JsonValue | null, ParseFailure> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return ok(at(parsed.value, key) ?? null);
}

// 배열 원소 소유다. `경로#member`는 그 경로의 배열에서 member가 가리키는
// 원소 하나만 lophn 소유라는 뜻이다. Gemini `context.fileName`의 `AGENTS.md`나
// settings `hooks.SessionStart`의 lophn hook 항목처럼 사람의 다른 원소가 같은
// 배열에 있는 자리다. 문자열 원소는 member와 같을 때, 객체 원소는 안의 문자열
// 값 하나가 member를 그대로 담을 때 소유 원소다.
function memberKey(key: string): { path: string; member: string } | null {
  const at = key.indexOf("#");
  if (at <= 0 || at === key.length - 1) return null;
  return { path: key.slice(0, at), member: key.slice(at + 1) };
}

// 배열 원소의 소유 판정은 문자열 안에 member가 들어 있는 것도 포함한다. hook
// command 문자열이 member token을 담는 모양이다.
function owns(value: JsonValue, member: string): boolean {
  if (typeof value === "string") return value === member;
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value).includes(JSON.stringify(member).slice(1, -1));
  }
  return false;
}

function listAt(
  document: JsonDocument,
  path: string,
): JsonValue[] | "absent" | "broken" | string {
  const found = at(document, path);
  if (found === undefined) return "absent";
  if (Array.isArray(found)) return found;
  // 사람이 문자열 하나로 쓴 목록이다. 그 값은 지우지 않고 목록의 첫 원소로
  // 옮긴다.
  if (typeof found === "string") return found;
  return "broken";
}

function setMember(
  text: string,
  path: string,
  member: string,
  value: JsonValue,
): SetOutcome {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(path);
  if (segments === null) return { kind: "broken" };
  const found = listAt(parsed.value, path);
  if (found === "broken") return { kind: "broken" };
  let list: JsonValue[];
  if (found === "absent") list = [];
  else if (typeof found === "string") list = [found];
  else list = [...found];
  const index = list.findIndex((item) => owns(item, member));
  if (index >= 0) {
    if (JSON.stringify(list[index]) === JSON.stringify(value)) {
      return { kind: "unchanged" };
    }
    list[index] = value;
  } else {
    list.push(value);
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
      return { kind: "broken" };
    }
  }
  cursor[segments[segments.length - 1]] = list;
  return { kind: "changed", text: write(parsed.value, text) };
}

function removeMember(text: string, path: string, member: string): SetOutcome {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed.error;
  const found = listAt(parsed.value, path);
  if (found === "broken") return { kind: "broken" };
  if (found === "absent") return { kind: "unchanged" };
  const list = typeof found === "string" ? [found] : [...found];
  const kept = list.filter((item) => !owns(item, member));
  if (kept.length === list.length) return { kind: "unchanged" };
  const segments = segmentsOf(path);
  if (segments === null) return { kind: "broken" };
  let cursor: { [key: string]: JsonValue } = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    cursor = cursor[segment] as { [key: string]: JsonValue };
  }
  cursor[segments[segments.length - 1]] = kept;
  return { kind: "changed", text: write(parsed.value, text) };
}

function memberFragment(
  text: string,
  path: string,
  member: string,
): Result<JsonValue | null, ParseFailure> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  const found = listAt(parsed.value, path);
  if (found === "broken") return err({ kind: "broken" });
  if (found === "absent") return ok(null);
  const list = typeof found === "string" ? [found] : found;
  return ok(list.find((item) => owns(item, member)) ?? null);
}

export function setOwned(
  text: string,
  key: string,
  value: JsonValue,
): SetOutcome {
  const member = memberKey(key);
  return member === null
    ? setKey(text, key, value)
    : setMember(text, member.path, member.member, value);
}

export function removeOwned(text: string, key: string): SetOutcome {
  const member = memberKey(key);
  return member === null
    ? removeKey(text, key)
    : removeMember(text, member.path, member.member);
}

export function ownedFragment(
  text: string,
  key: string,
): Result<JsonValue | null, ParseFailure> {
  const member = memberKey(key);
  return member === null
    ? keyFragment(text, key)
    : memberFragment(text, member.path, member.member);
}
