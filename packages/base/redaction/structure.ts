import { REDACTION_REPLACEMENT } from "./model.ts";

// 구조로 식별하는 인증 값. 원문 일치와 무관하게 지운다.

const SENSITIVE_KEYS =
  /^(?:secret|token|password|credential|authorization|cookie)$/i;
const AUTH_QUERY =
  /^(?:token|access_token|api_key|apikey|key|password|secret|auth|credential|sig|signature)$/i;

export type StructureOutcome =
  | { ok: true; value: unknown; redacted: string[] }
  | { ok: false; reason: "limit_exceeded" | "uncertain"; location: string };

export type StructureLimits = {
  maxDepth: number;
  maxItems: number;
};

function redactString(
  value: string,
  location: string,
  redacted: string[],
): string {
  let next = value;
  next = next.replace(
    /(^|\n)([^\n]*\b(?:authorization|cookie)\s*:[^\n]*)/gi,
    (_line, lead: string) => {
      redacted.push(location);
      return lead + REDACTION_REPLACEMENT;
    },
  );
  next = redactUrls(next, location, redacted);
  return next;
}

function redactUrls(
  value: string,
  location: string,
  redacted: string[],
): string {
  return value.replace(
    /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi,
    (url) => {
      let changed = false;
      let rewritten = url.replace(
        /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/i,
        (_match, scheme: string) => {
          changed = true;
          return `${scheme}${REDACTION_REPLACEMENT}@`;
        },
      );
      rewritten = rewritten.replace(
        /([?&])([^=&#]+)=([^&#]*)/g,
        (pair, sep: string, name: string) => {
          if (!AUTH_QUERY.test(name)) return pair;
          changed = true;
          return `${sep}${name}=${REDACTION_REPLACEMENT}`;
        },
      );
      if (changed) redacted.push(location);
      return rewritten;
    },
  );
}

function walk(
  value: unknown,
  location: string,
  depth: number,
  state: { items: number },
  limits: StructureLimits,
  redacted: string[],
): StructureOutcome {
  if (state.items >= limits.maxItems) {
    return { ok: false, reason: "limit_exceeded", location };
  }
  state.items += 1;
  if (depth > limits.maxDepth) {
    return { ok: false, reason: "limit_exceeded", location };
  }
  if (
    value === null || typeof value === "boolean" || typeof value === "number"
  ) {
    return { ok: true, value, redacted };
  }
  if (typeof value === "string") {
    // 중첩 문자열 안의 header·URL 인증도 구조 위치에서 지운다.
    return {
      ok: true,
      value: redactString(value, location, redacted),
      redacted,
    };
  }
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const child = walk(
        value[index],
        `${location}[${index}]`,
        depth + 1,
        state,
        limits,
        redacted,
      );
      if (!child.ok) return child;
      next.push(child.value);
    }
    return { ok: true, value: next, redacted };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      const childLocation = location === "$" ? key : `${location}.${key}`;
      if (SENSITIVE_KEYS.test(key)) {
        redacted.push(childLocation);
        next[key] = REDACTION_REPLACEMENT;
        continue;
      }
      const child = walk(
        record[key],
        childLocation,
        depth + 1,
        state,
        limits,
        redacted,
      );
      if (!child.ok) return child;
      next[key] = child.value;
    }
    return { ok: true, value: next, redacted };
  }
  return { ok: false, reason: "uncertain", location };
}

export function redactStructure(
  value: unknown,
  limits: StructureLimits,
): StructureOutcome {
  const redacted: string[] = [];
  const outcome = walk(value, "$", 0, { items: 0 }, limits, redacted);
  if (!outcome.ok) return outcome;
  return { ok: true, value: outcome.value, redacted };
}

export function redactStructuredText(
  text: string,
  location: string,
  redacted: string[],
): string {
  return redactString(text, location, redacted);
}
