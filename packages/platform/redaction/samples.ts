import {
  fieldPathSchema,
  REDACTION_REPLACEMENT,
  REDACTION_SAMPLE_MAX_BYTES,
  REDACTION_SAMPLE_MAX_CHARS,
} from "../../contracts/platform/mod.ts";
import { pseudonym, selectSafeFields } from "./fields.ts";
import { matchCredential } from "./patterns.ts";
import type { KnownSecretRegistry } from "./registry.ts";

// 표본 원값은 명시 경로만 secret 처리 뒤 남긴다(platform/redaction#R10, R11).
// ID형 문자열은 그 표본 안에서만 통하는 가명이다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{16,}$/i;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type SampleOutcome =
  | { ok: true; value: unknown; bytes: number }
  | { ok: false; reason: "invalid_input" | "limit_exceeded" };

function looksLikeId(value: string): boolean {
  return UUID.test(value) || HEX.test(value) || ULID.test(value);
}

function joinPath(location: string, key: string): string {
  return location === "" ? key : `${location}.${key}`;
}

function secretText(value: string, registry?: KnownSecretRegistry): string {
  // 알려진 secret을 긴 값부터 지운 뒤 패턴을 지운다(R10). 길이는 남기지 않는다.
  let out = "";
  let rest = value;
  while (rest.length > 0) {
    const known = registry?.match(rest);
    const credential = matchCredential(rest);
    const knownAt = known ? known.index : Number.POSITIVE_INFINITY;
    const patternAt = credential ? credential.index : Number.POSITIVE_INFINITY;
    if (!known && !credential) {
      out += rest;
      break;
    }
    const useKnown = knownAt <= patternAt;
    const index = useKnown ? known!.index : credential!.index;
    const length = useKnown ? known!.length : credential!.length;
    out += rest.slice(0, index) + REDACTION_REPLACEMENT;
    rest = rest.slice(index + length);
  }
  return out;
}

function walk(
  value: unknown,
  location: string,
  allowed: ReadonlySet<string>,
  ids: Map<string, string>,
  registry?: KnownSecretRegistry,
): unknown {
  if (typeof value === "string") {
    if (looksLikeId(value)) {
      const known = ids.get(value);
      if (known) return known;
      const mark = pseudonym(ids.size + 1);
      ids.set(value, mark);
      return mark;
    }
    const cleaned = secretText(value, registry);
    if (!allowed.has(location)) return REDACTION_REPLACEMENT;
    if (cleaned.length <= REDACTION_SAMPLE_MAX_CHARS) return cleaned;
    return cleaned.slice(0, REDACTION_SAMPLE_MAX_CHARS);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      walk(item, `${location}[${index}]`, allowed, ids, registry)
    );
  }
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      next[key] = walk(
        (value as Record<string, unknown>)[key],
        joinPath(location, key),
        allowed,
        ids,
        registry,
      );
    }
    return next;
  }
  return value;
}

export function samplePathsAllowed(
  paths: readonly string[],
): boolean {
  return paths.every((path) => fieldPathSchema.safeParse(path).success);
}

export function redactSample(
  value: unknown,
  samplePaths: readonly string[],
  safeFields: readonly string[] = [],
  privateFields: readonly string[] = [],
  registry?: KnownSecretRegistry,
): SampleOutcome {
  if (!samplePathsAllowed(samplePaths)) {
    return { ok: false, reason: "invalid_input" };
  }
  const selected = safeFields.length === 0 && privateFields.length === 0
    ? { value, dropped: [] as string[] }
    : selectSafeFields(value, safeFields, privateFields);
  if (!selected) return { ok: false, reason: "invalid_input" };
  const sampled = walk(
    selected.value,
    "",
    new Set(samplePaths),
    new Map(),
    registry,
  );
  const bytes = new TextEncoder().encode(JSON.stringify(sampled)).length;
  if (bytes > REDACTION_SAMPLE_MAX_BYTES) {
    return { ok: false, reason: "limit_exceeded" };
  }
  return { ok: true, value: sampled, bytes };
}
