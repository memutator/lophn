// 화면 상태에서 민감한 칸을 제거하고 요약을 2048byte로 맞춘다.
// release bundle에 들어가는 플랫폼 진입 파일이라 의존성이 없다(Zod·npm 금지).
//
// sensitive_paths는 AppScreenContext 값 `{summary, data}`를 가리키는 JSON Pointer다
// (`/data/private_note`, `/data/attempts/0/note`, `/summary`). 상위 path는 하위 전체를 제거한다.
// 안전성을 확인할 수 없으면 값을 보내지 않고 생략 사실만 `redacted`에 남긴다.
//   - data가 plain JSON이 아니거나 너무 깊다.
//   - sensitive path가 summary·data 밖을 가리켜 무엇을 가리는지 알 수 없다.
//   - 제거한 값이 summary나 남은 data에 그대로 들어 있다(요약에 옮겨 쓴 민감 값).
// 이 검사는 platform/redaction을 대신하지 않는다. model 전달 경계가 platform/redaction을 다시 쓴다.
import {
  isPointer,
  pointerOf,
  pointerTokens,
  SUMMARY_MAX_BYTES,
  utf8Length,
} from "./schema.ts";

export type PrepareInput = {
  summary: unknown;
  data?: unknown;
  // 상세 조회(detail=true)에서만 data를 내보낸다.
  detail: boolean;
  sensitive_paths: readonly string[];
};

export type PreparedContext = {
  summary: string;
  // detail=false면 없다. detail=true인데 data를 내보낼 수 없으면 null이다.
  data?: Record<string, unknown> | null;
  redacted: string[];
};

// 이보다 짧은 값은 우연히 겹칠 수 있어 문자열 일치 검사 대상에서 뺀다.
export const LEAK_MIN_CHARS = 4;
export const DATA_MAX_DEPTH = 32;
const ELLIPSIS = "…";

type Slot = { parent: unknown; key: string };

class Unverifiable extends Error {}

function own(copy: Record<string, unknown>, key: string, value: unknown) {
  // __proto__ 같은 key도 자기 key로 둔다(조용히 지우거나 prototype을 바꾸지 않는다).
  Object.defineProperty(copy, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function clone(value: unknown, depth: number, seen: Set<object>): unknown {
  if (depth > DATA_MAX_DEPTH) throw new Unverifiable();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Unverifiable();
    return value;
  }
  if (typeof value !== "object") throw new Unverifiable();
  if (seen.has(value)) throw new Unverifiable();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      // JSON과 같이 배열 안 undefined는 null이고 객체의 undefined 칸은 없는 칸이다.
      return value.map((item) =>
        item === undefined ? null : clone(item, depth + 1, seen)
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Unverifiable();
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) own(copy, key, clone(item, depth + 1, seen));
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

function child(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) {
    return /^(0|[1-9]\d*)$/.test(key) ? parent[Number(key)] : undefined;
  }
  if (parent !== null && typeof parent === "object") {
    return Object.hasOwn(parent, key)
      ? (parent as Record<string, unknown>)[key]
      : undefined;
  }
  return undefined;
}

function locate(root: unknown, tokens: readonly string[]): Slot | undefined {
  let parent = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    parent = child(parent, tokens[index]);
    if (parent === undefined) return;
  }
  const key = tokens[tokens.length - 1];
  if (child(parent, key) === undefined) return;
  return { parent, key };
}

function strings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    if (value.length >= LEAK_MIN_CHARS) into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) strings(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      strings((value as Record<string, unknown>)[key], into);
    }
  }
}

function leaks(text: string, secrets: readonly string[]): boolean {
  return secrets.some((secret) => text.includes(secret));
}

// 남은 data의 문자열 칸 중 제거한 값을 담은 것을 지운다. 지운 칸의 path는 removed에 쌓는다.
function sweep(
  value: unknown,
  tokens: string[],
  secrets: readonly string[],
  removed: string[],
): unknown {
  if (typeof value === "string") {
    if (leaks(value, secrets)) {
      removed.push(pointerOf(tokens));
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    value.forEach((item, index) => {
      const next = sweep(item, [...tokens, String(index)], secrets, removed);
      if (next !== undefined) kept.push(next);
    });
    return kept;
  }
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const next = sweep(
        (value as Record<string, unknown>)[key],
        [...tokens, key],
        secrets,
        removed,
      );
      if (next !== undefined) own(copy, key, next);
    }
    return copy;
  }
  return value;
}

// UTF-8 byte 수가 한도 안이 되도록 code point 경계에서 자르고 줄임표를 붙인다.
export function limitSummary(text: string): string {
  if (utf8Length(text) <= SUMMARY_MAX_BYTES) return text;
  const room = SUMMARY_MAX_BYTES - utf8Length(ELLIPSIS);
  let out = "";
  let bytes = 0;
  for (const character of text) {
    const size = utf8Length(character);
    if (bytes + size > room) break;
    out += character;
    bytes += size;
  }
  return out + ELLIPSIS;
}

function withheld(detail: boolean, redacted: string[]): PreparedContext {
  return {
    summary: "",
    ...(detail ? { data: null } : {}),
    redacted: [...new Set(redacted)].sort(),
  };
}

export function prepareScreenContext(input: PrepareInput): PreparedContext {
  const redacted: string[] = [];
  const paths = [...new Set(input.sensitive_paths)];
  // 무엇을 가리는지 확인되지 않는 선언은 아무것도 보내지 않는다.
  for (const path of paths) {
    if (!isPointer(path) || path === "") return withheld(input.detail, [path]);
    const head = pointerTokens(path)[0];
    if (head !== "summary" && head !== "data") {
      return withheld(input.detail, [path]);
    }
  }

  let summary = typeof input.summary === "string" ? input.summary : "";
  if (typeof input.summary !== "string") redacted.push("/summary");
  let data: unknown;
  let dataKnown = false;
  if (input.data !== undefined && input.data !== null) {
    try {
      data = clone(input.data, 0, new Set());
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new Unverifiable();
      }
      dataKnown = true;
    } catch {
      data = undefined;
      redacted.push("/data");
    }
  }

  const secrets: string[] = [];
  const tombstones = new Map<unknown[], Set<number>>();
  let dataRemoved = false;
  for (const path of paths) {
    const tokens = pointerTokens(path);
    if (tokens[0] === "summary") {
      // 문자열인 summary는 아래 칸이 없다. 통째로 가리는 path만 뜻이 있다.
      if (tokens.length === 1) {
        strings(summary, secrets);
        summary = "";
        redacted.push("/summary");
      }
      continue;
    }
    if (tokens.length === 1) {
      if (dataKnown) strings(data, secrets);
      dataRemoved = true;
      redacted.push("/data");
      continue;
    }
    if (!dataKnown) continue;
    const slot = locate(data, tokens.slice(1));
    if (!slot) continue;
    strings(child(slot.parent, slot.key), secrets);
    if (Array.isArray(slot.parent)) {
      const set = tombstones.get(slot.parent) ?? new Set<number>();
      set.add(Number(slot.key));
      tombstones.set(slot.parent, set);
    } else {
      delete (slot.parent as Record<string, unknown>)[slot.key];
    }
    redacted.push(path);
  }
  for (const [array, indexes] of tombstones) {
    for (const index of [...indexes].sort((a, b) => b - a)) {
      array.splice(index, 1);
    }
  }

  if (summary !== "" && leaks(summary, secrets)) {
    summary = "";
    redacted.push("/summary");
  }
  let kept: Record<string, unknown> | null = null;
  if (dataKnown && !dataRemoved) {
    const swept: string[] = [];
    kept = sweep(data, [], secrets, swept) as Record<string, unknown>;
    for (const path of swept) redacted.push("/data" + path);
  }

  return {
    summary: limitSummary(summary),
    ...(input.detail ? { data: kept } : {}),
    redacted: [...new Set(redacted)].sort(),
  };
}
