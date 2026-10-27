import { isFieldPath } from "./model.ts";

// 소유 concern이 선언한 경로만 남긴다.
// 필드명 변경은 익명화가 아니다. 가명 비교는 같은 자료 안으로 한정한다.

// 필드명을 바꿔도 이름·연락처·이메일·경로는 안전 필드가 아니다.
const PERSONAL_KEY =
  /(?:^|[._-])(?:name|full_name|display_name|alias|email|e_mail|phone|tel|mobile|contact|path|home)(?:$|[._-])/i;

function personalKey(key: string): boolean {
  return PERSONAL_KEY.test(key);
}

type FieldSelection = {
  value: unknown;
  dropped: string[];
};

type Segment = { key: string; index?: number };

function segmentsOf(path: string): Segment[] | undefined {
  if (!isFieldPath(path)) return undefined;
  const parts = path.split(".");
  const segments: Segment[] = [];
  for (const part of parts) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([0-9]+)\])?$/.exec(part);
    if (!match) return undefined;
    const segment: Segment = { key: match[1] };
    if (match[2] !== undefined) segment.index = Number(match[2]);
    segments.push(segment);
  }
  return segments;
}

function childAt(value: unknown, segment: Segment): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, segment.key)) return undefined;
  const child = record[segment.key];
  if (segment.index === undefined) return child;
  if (!Array.isArray(child) || segment.index >= child.length) return undefined;
  return child[segment.index];
}

function writeAt(
  root: Record<string, unknown>,
  segments: Segment[],
  leaf: unknown,
): void {
  let cursor: Record<string, unknown> = root;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const last = index === segments.length - 1;
    if (last && segment.index === undefined) {
      cursor[segment.key] = leaf;
      return;
    }
    if (segment.index === undefined) {
      const next = cursor[segment.key];
      if (next === null || typeof next !== "object" || Array.isArray(next)) {
        cursor[segment.key] = {};
      }
      cursor = cursor[segment.key] as Record<string, unknown>;
      continue;
    }
    const existing = cursor[segment.key];
    const list = Array.isArray(existing) ? existing.slice() : [];
    if (last) {
      list[segment.index] = leaf;
      cursor[segment.key] = list;
      return;
    }
    const nested = list[segment.index];
    if (
      nested === null ||
      typeof nested !== "object" ||
      Array.isArray(nested)
    ) {
      list[segment.index] = {};
    }
    cursor[segment.key] = list;
    cursor = list[segment.index] as Record<string, unknown>;
  }
}

// 선언 모양을 검사한다. 모르는 key, 틀린 경로, 중복 경로, 안전·private 겹침은 받지 않는다.

function subtreeHasPrivate(
  value: unknown,
  privateFields: ReadonlySet<string>,
  location: string,
): boolean {
  if (privateFields.has(location)) return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item, index) =>
      subtreeHasPrivate(item, privateFields, `${location}[${index}]`),
    );
  }
  return Object.keys(value).some((key) =>
    subtreeHasPrivate(
      (value as Record<string, unknown>)[key],
      privateFields,
      location === "" ? key : `${location}.${key}`,
    ),
  );
}

export function selectSafeFields(
  value: unknown,
  safeFields: readonly string[],
  privateFields: readonly string[],
): FieldSelection | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const blocked = new Set(privateFields);
  const kept = new Set<string>();
  const next: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const path of safeFields) {
    if (blocked.has(path)) {
      dropped.push(path);
      continue;
    }
    const segments = segmentsOf(path);
    if (!segments) return undefined;
    const leaf = segments.reduce<unknown>(
      (cursor, segment) => childAt(cursor, segment),
      value,
    );
    if (leaf === undefined) continue;
    const key = segments[segments.length - 1].key;
    if (personalKey(key) || subtreeHasPrivate(leaf, blocked, path)) {
      dropped.push(path);
      continue;
    }
    writeAt(next, segments, leaf);
    kept.add(path);
  }
  for (const path of privateFields) {
    if (!kept.has(path) && !dropped.includes(path)) dropped.push(path);
  }
  return { value: next, dropped };
}

// 가명 표식. 비교는 PSEUDONYM_SCOPE(같은 자료) 안에서만 통한다.
// 원문 길이·type은 표식에 넣지 않는다.
