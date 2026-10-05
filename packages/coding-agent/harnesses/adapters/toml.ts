// TOML 설정 merge다(coding-agent/harnesses#R8, T29). lophn 소유 테이블만
// 바꾸고 다른 테이블은 그대로 둔다. 제품 자신의 `mcp add` 명령은 파일 전체를
// 다시 직렬화하고 동명 항목을 묻지 않고 바꾸므로 부르지 않는다(조사 9.6,
// R8). 깨진 TOML은 무변경이다.
import { parse, stringify } from "@std/toml";
import { err, ok, type Result } from "../../../base/mod.ts";

type Table = Record<string, unknown>;

export type ParseFailure = { kind: "broken" };

export type SetOutcome =
  | { kind: "unchanged" }
  | { kind: "changed"; text: string }
  | ParseFailure;

function segmentsOf(key: string): string[] | null {
  const segments = key.split(".");
  if (segments.some((segment) => segment === "")) return null;
  return segments;
}

export function parseToml(text: string): Result<Table, ParseFailure> {
  try {
    const value = parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return err({ kind: "broken" });
    }
    return ok(value as Table);
  } catch {
    return err({ kind: "broken" });
  }
}

function at(document: Table, key: string): unknown {
  const segments = segmentsOf(key);
  if (segments === null) return undefined;
  let cursor: unknown = document;
  for (const segment of segments) {
    if (
      cursor === null || typeof cursor !== "object" || Array.isArray(cursor)
    ) {
      return undefined;
    }
    cursor = (cursor as Table)[segment];
  }
  return cursor;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// 소유 테이블만 넣는다(R8). 같은 값이면 파일을 바꾸지 않는다.
export function setOwned(text: string, key: string, value: Table): SetOutcome {
  const parsed = parseToml(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  if (same(at(parsed.value, key), value)) return { kind: "unchanged" };
  let cursor: Table = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === undefined) {
      const created: Table = {};
      cursor[segment] = created;
      cursor = created;
    } else if (
      next !== null && typeof next === "object" && !Array.isArray(next)
    ) {
      cursor = next as Table;
    } else {
      return { kind: "broken" };
    }
  }
  cursor[segments[segments.length - 1]] = value;
  return { kind: "changed", text: stringify(parsed.value) };
}

// 소유 테이블만 지운다(R8 제거). 없으면 무변경이다.
export function removeOwned(text: string, key: string): SetOutcome {
  const parsed = parseToml(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  let cursor: Table = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === undefined) return { kind: "unchanged" };
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      return { kind: "broken" };
    }
    cursor = next as Table;
  }
  const leaf = segments[segments.length - 1];
  if (!(leaf in cursor)) return { kind: "unchanged" };
  delete cursor[leaf];
  return { kind: "changed", text: stringify(parsed.value) };
}

export function ownedFragment(
  text: string,
  key: string,
): Result<unknown, ParseFailure> {
  const parsed = parseToml(text);
  if (!parsed.ok) return parsed;
  return ok(at(parsed.value, key) ?? null);
}
