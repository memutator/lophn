// YAML 설정 merge다(coding-agent/harnesses#R8, T29·T30). lophn이 쓰는 설정은
// 들여쓰기 map과 scalar뿐이라(Hermes `mcp_servers.lophn`의 command·args·env,
// 조사 9.1) 그 부분집합만 읽는다. 쓰기는 lophn이 쓴 뒤 원문을 바꿀 일이 없다
// (조사 9.7). 소유 블록만 텍스트 패치로 고치고 주석·빈 줄·다른 key는 그대로
// 둔다(T30). anchor·tag·flow 표기·여러 줄 문자는 쓰지 않으므로 만나면 깨진
// 설정으로 보고 무변경이다(조사 9.2). 의존성을 더하지 않는다(stack).
import { err, ok, type Result } from "../../../base/mod.ts";

export type YamlValue = string | YamlMap;

export type YamlMap = { [key: string]: YamlValue };

export type ParseFailure = { kind: "broken" };

export type SetOutcome =
  | { kind: "unchanged" }
  | { kind: "changed"; text: string }
  | ParseFailure;

type Line = { indent: number; key: string; value: string | null };

const UNSUPPORTED = /[&*!|>%@`[\]]/;

function segmentsOf(key: string): string[] | null {
  const segments = key.split(".");
  if (segments.some((segment) => segment === "")) return null;
  return segments;
}

function linesOf(text: string): Result<Line[], ParseFailure> {
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    if (indent % 2 !== 0) return err({ kind: "broken" });
    const body = raw.slice(indent);
    // 다른 key의 목록 줄(`- item`)은 lophn 조간 모양이 아니므로 넘어간다.
    // 사람 파일 전체를 읽어야 하므로 깨진 설정으로 보지 않는다(T30).
    if (body.startsWith("- ")) continue;
    const colon = body.indexOf(":");
    if (colon <= 0) return err({ kind: "broken" });
    const key = body.slice(0, colon);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return err({ kind: "broken" });
    const rest = body.slice(colon + 1).trim();
    if (rest === "") lines.push({ indent, key, value: null });
    else if (UNSUPPORTED.test(rest) || rest.startsWith("{")) {
      return err({ kind: "broken" });
    } else lines.push({ indent, key, value: unquote(rest) });
  }
  return ok(lines);
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function quote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

// 들여쓰기 줄을 중첩 map으로 접는다. 같은 깊이에서 key가 겹치면 깨진 것이다.
function fold(
  lines: Line[],
  at: number,
  indent: number,
): Result<YamlMap, ParseFailure> {
  const map: YamlMap = {};
  let index = at;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) return err({ kind: "broken" });
    if (line.key in map) return err({ kind: "broken" });
    if (line.value !== null) {
      map[line.key] = line.value;
      index += 1;
    } else {
      const nested = fold(lines, index + 1, indent + 2);
      if (!nested.ok) return nested;
      map[line.key] = nested.value;
      index = skip(lines, index + 1, indent + 2);
    }
  }
  return ok(map);
}

function skip(lines: Line[], at: number, indent: number): number {
  let index = at;
  while (index < lines.length && lines[index].indent >= indent) index += 1;
  return index;
}

export function parseYaml(text: string): Result<YamlMap, ParseFailure> {
  const lines = linesOf(text);
  if (!lines.ok) return lines;
  return fold(lines.value, 0, 0);
}

function emit(map: YamlMap, indent: number): string[] {
  const pad = " ".repeat(indent);
  const out: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string") out.push(`${pad}${key}: ${quote(value)}`);
    else {
      out.push(`${pad}${key}:`);
      out.push(...emit(value, indent + 2));
    }
  }
  return out;
}

function at(document: YamlMap, key: string): YamlValue | undefined {
  const segments = segmentsOf(key);
  if (segments === null) return undefined;
  let cursor: YamlValue = document;
  for (const segment of segments) {
    if (typeof cursor === "string") return undefined;
    const next: YamlValue | undefined = cursor[segment];
    if (next === undefined) return undefined;
    cursor = next;
  }
  return cursor;
}

function same(left: YamlValue | undefined, right: YamlMap): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// 소유 최하위 조각의 블록 줄이다(T30). `lophn:` 헤더와 그 몸을 둔다. 다른
// key의 바이트는 흉내 내지 않는다.
function blockLines(key: string, value: YamlMap): string[] {
  const segments = segmentsOf(key);
  if (segments === null) return emit(value, 0);
  const leaf = segments[segments.length - 1];
  return [`${leaf}:`, ...emit(value, 2)];
}

// 소유 key 블록을 줄 위치로 찾는다(T30). 마지막 조각 이름이 맞는, 소유
// 블록 depth의 key 줄이다. 상위 블록 안에서 찾는다.
function findSegment(
  lines: readonly string[],
  from: number,
  to: number,
  indent: number,
  name: string,
): number | null {
  for (let index = from; index < to; index++) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const lineIndent = line.match(/^ */)?.[0].length ?? 0;
    if (lineIndent < indent) break;
    if (lineIndent !== indent) continue;
    const match = line.slice(indent).match(/^([A-Za-z0-9_-]+):($| |$)/);
    if (match === null) continue;
    if (match[1] === name) return index;
  }
  return null;
}

// 소유 최하위 조각의 블록 범위를 찾는다(T30). 상위 조각을 따라 내려간다.
// 중간 조각이 없으면(새 블록) null이다.
function findOwnedRange(
  lines: readonly string[],
  key: string,
): { start: number; end: number } | null {
  const segments = segmentsOf(key);
  if (segments === null) return null;
  let from = 0;
  let to = lines.length;
  let indent = 0;
  for (let depth = 0; depth < segments.length - 1; depth++) {
    const parent = findSegment(lines, from, to, indent, segments[depth]);
    if (parent === null) return null;
    const childIndent = indent + 2;
    const parentEnd = blockEnd(lines, parent);
    // 상위 블록 몸 안에서 다음 조각을 찾는다. 다음 key는 있던 것이다(R8은
    // 상위 블록을 보존하므로 parentEnd까지 본다).
    const child = findSegment(
      lines,
      parent + 1,
      parentEnd,
      childIndent,
      segments[depth + 1],
    );
    if (child === null) return null;
    from = child;
    to = parentEnd;
    indent = childIndent;
  }
  const leaf = findSegment(
    lines,
    from,
    to,
    indent,
    segments[segments.length - 1],
  );
  if (leaf === null) return null;
  return { start: leaf, end: blockEnd(lines, leaf) };
}

// 없는 소유 블록을 더한다(T30). 있는 가장 깊은 상위 조각 몸 끝의 childIndent에
// 더한다. 상위가 하나도 없으면 파일 끝 top-level에 더한다.
function insertNewBlock(
  lines: readonly string[],
  segments: readonly string[],
  replacement: readonly string[],
): string[] {
  let anchor: number | null = null;
  let indent = 0;
  for (let depth = 0; depth < segments.length - 1; depth++) {
    const found = findSegment(lines, 0, lines.length, indent, segments[depth]);
    if (found === null) break;
    anchor = found;
    indent += 2;
  }
  if (anchor === null) {
    // 상위가 하나도 없다. 파일 끝에 빈 줄 한 개 뒤 top-level로 더한다.
    const last = lines.length > 0 && lines[lines.length - 1].trim() === ""
      ? lines.length - 1
      : lines.length;
    return [...lines.slice(0, last), "", ...replacement, ...lines.slice(last)];
  }
  const at = blockEnd(lines, anchor);
  const pad = " ".repeat(indent);
  const shifted = replacement.map((line) => `${pad}${line}`);
  return [...lines.slice(0, at), ...shifted, ...lines.slice(at)];
}

// 소유 블록의 몸이 끝나는 줄이다. 같은 depth 이상의 줄이 끝날 때까지다.
function blockEnd(lines: readonly string[], start: number): number {
  const startIndent = lines[start].match(/^ */)?.[0].length ?? 0;
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      // 빈 줄·주석은 블록 몸 포함이다. 다음 실제 줄이 같은 depth면 계속 본다.
      index += 1;
      continue;
    }
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent <= startIndent) break;
    index += 1;
  }
  // 끝의 빈 줄·주석은 블록 몸이 아니므로 되돌린다.
  while (index > start + 1) {
    const line = lines[index - 1];
    if (line.trim() === "" || line.trimStart().startsWith("#")) index -= 1;
    else break;
  }
  return index;
}

function rendered(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

// 소유 key만 넣는다(R8). 같은 값이면 파일을 바꾸지 않는다. 다른 key의
// 바이트는 하나도 가리지 않는다(T30). 빈 문서·`{}` 한 줄도 새 블록의 base다.
export function setOwned(
  text: string,
  key: string,
  value: YamlMap,
): SetOutcome {
  const trimmed = text.trim();
  const empty = trimmed === "" || trimmed === "{}";
  if (!empty) {
    const parsed = parseYaml(text);
    if (!parsed.ok) return parsed.error;
    if (same(at(parsed.value, key), value)) return { kind: "unchanged" };
  }
  const lines = text.split("\n");
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  const body = trailing ? lines.slice(0, -1) : [...lines];
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  // 패치 행은 소유 최하위 조각의 블록이다(T29). 상위 조각은 보존 대상이라
  // 패치에 넣지 않는다.
  const replacement = blockLines(key, value);
  const range = findOwnedRange(body, key);
  if (range !== null) {
    const end = range.end;
    // 소유 최하위 조각 블록을 최소 표기로 바꾼다. emit의 들여쓰기는 소유
    // 조각 줄의 depth에 상대적이다(T30).
    const pad = " ".repeat(body[range.start].match(/^ */)?.[0].length ?? 0);
    const shifted = replacement.map((line) => `${pad}${line}`);
    const patched = [
      ...body.slice(0, range.start),
      ...shifted,
      ...body.slice(end),
    ];
    return { kind: "changed", text: rendered(patched) };
  }
  // 소유 블록이 없으면 상위 블록 몸 끝에 더한다(T30). 상위 블록이 있으면
  // 그 안의 childIndent에, 없으면 파일 끝 top-level에 더한다.
  const added = insertNewBlock(body, segments, replacement);
  return { kind: "changed", text: rendered(added) };
}

// 소유 key만 지운다(R8 제거). 없으면 무변경이다. 다른 key와 그 사이 빈 줄도
// 그대로 둔다.
export function removeOwned(text: string, key: string): SetOutcome {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  let cursor: YamlMap = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === undefined) return { kind: "unchanged" };
    if (typeof next === "string") return { kind: "broken" };
    cursor = next;
  }
  const leaf = segments[segments.length - 1];
  if (!(leaf in cursor)) return { kind: "unchanged" };
  const lines = text.split("\n");
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  const body = trailing ? lines.slice(0, -1) : [...lines];
  const range = findOwnedRange(body, key);
  if (range === null) return { kind: "changed", text: rendered(body) };
  const patched = [
    ...body.slice(0, range.start),
    ...body.slice(range.end),
  ];
  return { kind: "changed", text: rendered(patched) };
}

export function ownedFragment(
  text: string,
  key: string,
): Result<YamlValue | null, ParseFailure> {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  return ok(at(parsed.value, key) ?? null);
}
