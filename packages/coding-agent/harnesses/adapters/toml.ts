// TOML 설정 merge다. lophn 소유 테이블만
// 텍스트 패치로 고치고 주석·빈 줄·다른 테이블은 그대로 둔다. 제품 자신의
// `mcp add` 명령은 파일 전체를 다시 직렬화하고 동명 항목을 묻지 않고 바꾸므로
// 부르지 않는다(조사 9.6). 깨진 TOML은 무변경이다(조사 9.2).
import { parse } from "@std/toml";
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
  // 없거나 빈 config.toml은 빈 표다. 처음 설치가 이 base에서 시작한다.
  if (text.trim() === "") return ok({});
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

// 소유 테이블의 최소 TOML 본문이다. 사람의 파일 스타일을 흉내 내지 않고
// 한 줄 key = value만 둔다(indentation은 key-value 페어라 모양이 자유롭다).
function tableLines(key: string, value: Table): string[] {
  const header = `[${key}]`;
  const lines = [header];
  for (const [name, item] of Object.entries(value)) {
    lines.push(`${name} = ${inlineValue(item)}`);
  }
  return lines;
}

function inlineValue(item: unknown): string {
  if (typeof item === "string") {
    return `"${item.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  if (typeof item === "boolean" || typeof item === "number") return `${item}`;
  if (Array.isArray(item)) {
    return `[${item.map(inlineValue).join(", ")}]`;
  }
  if (item === null || item === undefined) return `""`;
  const entries = Object.entries(item as Table).map(([name, item]) =>
    `${name} = ${inlineValue(item)}`
  );
  return `{ ${entries.join(", ")} }`;
}

// 헤더 행 기준으로 테이블 몸이 끝나는 위치다. 다음 표 헤더나 파일 끝이다.
function bodyEnd(lines: readonly string[], start: number): number {
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    const content = line.trim();
    if (content.startsWith("[") && content.endsWith("]")) break;
    index += 1;
  }
  return index;
}

// 소유 헤더 행의 위치다. `#` 주석 제외한 첫 행(`[...]`)만 본다. 문자열 안
// `[`는 헤더가 아니므로 대괄호로만 끝나는 행은 넘어간다. 정확한
// locator는 나중에 더할 자리다. 여기서는 key 헤더만 찾고, 찾지 못하면 null이다.
function findHeader(
  lines: readonly string[],
  key: string,
): number | null {
  const target = `[${key}]`;
  for (let index = 0; index < lines.length; index++) {
    const content = lines[index].trim();
    if (content === target) return index;
    // 헤더 한 개는 파일에 하나뿐이라[TOML 명세] 첫 대상 헤더가 정본이다.
  }
  return null;
}

function rendered(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

// 소유 테이블만 넣는다. 같은 값이면 파일을 바꾸지 않는다. 다른 테이블의
// 바이트는 하나도 가리지 않는다.
export function setOwned(text: string, key: string, value: Table): SetOutcome {
  const parsed = parseToml(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  if (same(at(parsed.value, key), value)) return { kind: "unchanged" };
  const lines = text.split("\n");
  // 끝의 빈 줄은 join 복구용이라 몸에서 뺀다.
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  const body = trailing ? lines.slice(0, -1) : [...lines];
  const replacement = tableLines(key, value);
  const header = findHeader(body, key);
  if (header !== null) {
    // 헤더 행은 유지하고 몸만 바꾼다. 헤더 스타일도 사람의 것을 둔다.
    const end = bodyEnd(body, header);
    const patched = [
      ...body.slice(0, header + 1),
      ...replacement.slice(1),
      ...body.slice(end),
    ];
    return { kind: "changed", text: rendered(patched) };
  }
  // 테이블이 없으면 파일 끝에 더한다. 다른 테이블은 그대로다.
  const appended = body.length > 0 && body[body.length - 1].trim() !== ""
    ? [...body, "", ...replacement]
    : [...body, ...replacement];
  return { kind: "changed", text: rendered(appended) };
}

// 소유 테이블만 지운다. 없으면 무변경이다. 다른 테이블과 테이블
// 사이 빈 줄도 그대로 둔다.
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
  const lines = text.split("\n");
  // 끝의 빈 줄은 join 복구용이라 몸에서 뺀다.
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  const body = trailing ? lines.slice(0, -1) : [...lines];
  const header = findHeader(body, key);
  if (header === null) return { kind: "changed", text: rendered(body) };
  const end = bodyEnd(body, header);
  const patched = [...body.slice(0, header), ...body.slice(end)];
  return { kind: "changed", text: rendered(patched) };
}

export function ownedFragment(
  text: string,
  key: string,
): Result<unknown, ParseFailure> {
  const parsed = parseToml(text);
  if (!parsed.ok) return parsed;
  return ok(at(parsed.value, key) ?? null);
}
