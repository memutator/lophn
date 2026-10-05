// YAML 설정 merge다(coding-agent/harnesses#R8, T29). lophn이 쓰는 설정은
// 들여쓰기 map, scalar, scalar 목록(`args`의 block sequence)뿐이라(Hermes
// `mcp_servers.lophn`의 command·args·env, 조사 9.1) 그 부분집합만 읽고 쓴다. anchor·tag·flow 표기·여러 줄 문자는
// 쓰지 않으므로 만나면 깨진 설정으로 보고 무변경이다(R8). 의존성을 더하지
// 않는다(stack).
import { err, ok, type Result } from "../../../base/mod.ts";

export type YamlValue = string | string[] | YamlMap;

export type YamlMap = { [key: string]: YamlValue };

export type ParseFailure = { kind: "broken" };

export type SetOutcome =
  | { kind: "unchanged" }
  | { kind: "changed"; text: string }
  | ParseFailure;

type Line = {
  indent: number;
  key: string;
  value: string | null;
  item: boolean;
};

const UNSUPPORTED = /[&*!|>%@`[\]]/;

function segmentsOf(key: string): string[] | null {
  const segments = key.split(".");
  if (segments.some((segment) => segment === "")) return null;
  return segments;
}

function isQuoted(value: string): boolean {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"');
}

// 따옴표 scalar는 quote()가 쓴 모양이라 특수 문자를 허용한다.
function scalarOf(rest: string): string | null {
  if (isQuoted(rest)) return unquote(rest);
  if (UNSUPPORTED.test(rest) || rest.startsWith("{")) return null;
  return rest;
}

function linesOf(text: string): Result<Line[], ParseFailure> {
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    if (indent % 2 !== 0) return err({ kind: "broken" });
    const body = raw.slice(indent);
    if (body === "-" || body.startsWith("- ")) {
      const rest = body.slice(1).trim();
      const value = rest === "" ? null : scalarOf(rest);
      // 목록 항목은 scalar뿐이다. `- a: b` 같은 map 항목은 쓰지 않는다.
      if (value === null || (!isQuoted(rest) && /:(\s|$)/.test(rest))) {
        return err({ kind: "broken" });
      }
      lines.push({ indent, key: "", value, item: true });
      continue;
    }
    const colon = body.indexOf(":");
    if (colon <= 0) return err({ kind: "broken" });
    const key = body.slice(0, colon);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return err({ kind: "broken" });
    const rest = body.slice(colon + 1).trim();
    if (rest === "") lines.push({ indent, key, value: null, item: false });
    else {
      const value = scalarOf(rest);
      if (value === null) return err({ kind: "broken" });
      lines.push({ indent, key, value, item: false });
    }
  }
  return ok(lines);
}

function unquote(value: string): string {
  if (isQuoted(value)) {
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return value;
}

function quote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value) && !value.startsWith("-")) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

// 들여쓰기 줄을 중첩 map으로 접는다. 같은 깊이에서 key가 겹치면 깨진 것이다.
// key 아래 목록은 key보다 2칸 깊거나 같은 들여쓰기의 `- ` 항목이다.
function fold(
  lines: Line[],
  at: number,
  indent: number,
): Result<{ map: YamlMap; next: number }, ParseFailure> {
  const map: YamlMap = {};
  let index = at;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent || line.item) return err({ kind: "broken" });
    if (line.key in map) return err({ kind: "broken" });
    if (line.value !== null) {
      map[line.key] = line.value;
      index += 1;
      continue;
    }
    const following = lines[index + 1];
    if (following?.item && following.indent >= indent) {
      if (following.indent !== indent && following.indent !== indent + 2) {
        return err({ kind: "broken" });
      }
      const items: string[] = [];
      let cursor = index + 1;
      while (
        cursor < lines.length && lines[cursor].item &&
        lines[cursor].indent === following.indent
      ) {
        items.push(lines[cursor].value ?? "");
        cursor += 1;
      }
      map[line.key] = items;
      index = cursor;
      continue;
    }
    const nested = fold(lines, index + 1, indent + 2);
    if (!nested.ok) return nested;
    map[line.key] = nested.value.map;
    index = nested.value.next;
  }
  return ok({ map, next: index });
}

export function parseYaml(text: string): Result<YamlMap, ParseFailure> {
  const lines = linesOf(text);
  if (!lines.ok) return lines;
  const folded = fold(lines.value, 0, 0);
  if (!folded.ok) return folded;
  if (folded.value.next < lines.value.length) return err({ kind: "broken" });
  return ok(folded.value.map);
}

function emit(map: YamlMap, indent: number): string[] {
  const pad = " ".repeat(indent);
  const out: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string") out.push(`${pad}${key}: ${quote(value)}`);
    else if (Array.isArray(value)) {
      out.push(`${pad}${key}:`);
      for (const item of value) out.push(`${pad}  - ${quote(item)}`);
    } else {
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
    if (typeof cursor === "string" || Array.isArray(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function same(left: YamlValue | undefined, right: YamlMap): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function setOwned(
  text: string,
  key: string,
  value: YamlMap,
): SetOutcome {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  if (same(at(parsed.value, key), value)) return { kind: "unchanged" };
  let cursor: YamlMap = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === undefined) {
      const created: YamlMap = {};
      cursor[segment] = created;
      cursor = created;
    } else if (typeof next !== "string" && !Array.isArray(next)) cursor = next;
    else return { kind: "broken" };
  }
  cursor[segments[segments.length - 1]] = value;
  return { kind: "changed", text: `${emit(parsed.value, 0).join("\n")}\n` };
}

export function removeOwned(text: string, key: string): SetOutcome {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed.error;
  const segments = segmentsOf(key);
  if (segments === null) return { kind: "broken" };
  let cursor: YamlMap = parsed.value;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === undefined) return { kind: "unchanged" };
    if (typeof next === "string" || Array.isArray(next)) {
      return { kind: "broken" };
    }
    cursor = next;
  }
  const leaf = segments[segments.length - 1];
  if (!(leaf in cursor)) return { kind: "unchanged" };
  delete cursor[leaf];
  return { kind: "changed", text: `${emit(parsed.value, 0).join("\n")}\n` };
}

export function ownedFragment(
  text: string,
  key: string,
): Result<YamlValue | null, ParseFailure> {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  return ok(at(parsed.value, key) ?? null);
}
