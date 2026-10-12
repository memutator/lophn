import type { Clock } from "../../base/mod.ts";
import { systemClock } from "../../base/mod.ts";
import {
  type RedactedItem,
  REDACTION_MAX_DEPTH,
  REDACTION_MAX_ITEMS,
  REDACTION_REPLACEMENT,
  REDACTION_TIMEOUT_MS,
  REDACTION_UNIT_MAX_BYTES,
  type RedactionContent,
  type RedactionInput,
  type RedactionOmission,
  type RedactionResult,
} from "../../protocol/platform/mod.ts";
import { matchCredential, patternRevision } from "./patterns.ts";
import type { KnownSecretRegistry } from "./registry.ts";
import { selectSafeFields } from "./fields.ts";
import { redactStructure, redactStructuredText } from "./structure.ts";

// 세션 입력·질문 답은 contract audience에 없다. source.scope로 받는다.
const SESSION_SCOPES = new Set(["session_input", "question_answer"]);
const TEXT_MEDIA = new Set(["text/plain", "application/json"]);
const PROTECTED_INPUT_MESSAGE =
  "Use the protected secret input. This submission was not stored.";

export type RedactionEngine = {
  registry: KnownSecretRegistry;
  redact(
    input: RedactionInput,
    body: string,
  ): Promise<RedactionResult>;
  // 저장 때 redaction한 자료를 현재 규칙으로 다시 검사한다(R16).
  recheck(input: RedactionInput, body: string): Promise<RedactionResult>;
  // 삭제·차단 감사. 값·hash·일부를 남기지 않는다(R17).
  auditBlock(location: string): RedactionOmission;
};

export type RedactionEngineOptions = {
  registry: KnownSecretRegistry;
  clock?: Clock;
  limits?: {
    maxBytes?: number;
    maxDepth?: number;
    maxItems?: number;
    timeoutMs?: number;
  };
};

type Limits = {
  maxBytes: number;
  maxDepth: number;
  maxItems: number;
  timeoutMs: number;
};

function limitsOf(options: RedactionEngineOptions): Limits {
  return {
    maxBytes: options.limits?.maxBytes ?? REDACTION_UNIT_MAX_BYTES,
    maxDepth: options.limits?.maxDepth ?? REDACTION_MAX_DEPTH,
    maxItems: options.limits?.maxItems ?? REDACTION_MAX_ITEMS,
    timeoutMs: options.limits?.timeoutMs ?? REDACTION_TIMEOUT_MS,
  };
}

function omitted(
  revision: string,
  omission: RedactionOmission,
): RedactionResult {
  return {
    rule_revision: revision,
    status: "omitted",
    content: null,
    redacted_items: [],
    omissions: [omission],
  };
}

function blocked(revision: string): RedactionResult {
  // 전체 제출을 막는다. 남는 것은 보호 입력 안내뿐이고 원문은 없다(R4).
  return {
    rule_revision: revision,
    status: "omitted",
    content: null,
    redacted_items: [],
    omissions: [{
      location: "submission",
      reason: "secret_detected",
      message: PROTECTED_INPUT_MESSAGE,
    }],
  };
}

function timedOutResult(revision: string): RedactionResult {
  return omitted(revision, {
    location: "body",
    reason: "redaction_failed",
    message: "Redaction did not finish within the time limit.",
  });
}

function replaceKnownAndPatterns(
  text: string,
  registry: KnownSecretRegistry,
  redacted: string[],
  location: string,
): string {
  let out = "";
  let rest = text;
  while (rest.length > 0) {
    const known = registry.match(rest);
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
    redacted.push(location);
    rest = rest.slice(index + length);
  }
  return out;
}

function unsupported(mediaType: string): boolean {
  return !TEXT_MEDIA.has(mediaType);
}

export function createRedactionEngine(
  options: RedactionEngineOptions,
): RedactionEngine {
  const clock = options.clock ?? systemClock;
  const limits = limitsOf(options);
  const registry = options.registry;

  async function inspect(
    input: RedactionInput,
    body: string,
  ): Promise<RedactionResult> {
    const revision = await patternRevision();
    const started = clock.nowMs();
    const timedOut = () => {
      const elapsed = clock.nowMs() - started;
      return elapsed > limits.timeoutMs;
    };

    if (new TextEncoder().encode(body).length > limits.maxBytes) {
      return omitted(revision, {
        location: "body",
        reason: "limit_exceeded",
        message: "Unit exceeds the redaction size limit.",
      });
    }
    if (unsupported(input.media_type)) {
      return omitted(revision, {
        location: "body",
        reason: "unsupported_media",
        message: "Media type is not supported for redaction.",
      });
    }
    if (timedOut()) return timedOutResult(revision);

    const session = SESSION_SCOPES.has(input.source.scope);
    if (session && (registry.match(body) || matchCredential(body))) {
      return blocked(revision);
    }

    const redactedLocations: string[] = [];
    let value: unknown = body;
    if (input.media_type === "application/json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return omitted(revision, {
          location: "body",
          reason: "uncertain",
          message: "JSON could not be read, so the original was omitted.",
        });
      }
      const structured = redactStructure(parsed, {
        maxDepth: limits.maxDepth,
        maxItems: limits.maxItems,
      });
      if (!structured.ok) {
        return omitted(revision, {
          location: structured.location,
          reason: structured.reason,
          message: structured.reason === "limit_exceeded"
            ? "Structure exceeds the redaction limit."
            : "Structure could not be redacted with certainty.",
        });
      }
      value = structured.value;
      redactedLocations.push(...structured.redacted);
    }

    if (timedOut()) return timedOutResult(revision);

    const textLocations: string[] = [];
    const rendered = typeof value === "string"
      ? redactStructuredText(value, "body", textLocations)
      : JSON.stringify(value);
    const cleaned = replaceKnownAndPatterns(
      rendered,
      registry,
      textLocations,
      "body",
    );
    redactedLocations.push(...textLocations);
    const droppedFields: string[] = [];

    // secret을 지운 뒤에 선언 필드만 남긴다. 미선언·private는 구조째 뺀다(R8).
    if (
      input.media_type === "application/json" &&
      (input.safe_fields.length > 0 || input.private_fields.length > 0)
    ) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return omitted(revision, {
          location: "body",
          reason: "uncertain",
          message: "Declared fields could not be applied.",
        });
      }
      const selected = selectSafeFields(
        parsed,
        input.safe_fields,
        input.private_fields,
      );
      if (!selected) {
        return omitted(revision, {
          location: "body",
          reason: "uncertain",
          message: "Declared fields could not be applied.",
        });
      }
      value = selected.value;
      droppedFields.push(...selected.dropped);
    } else {
      value = cleaned;
    }

    if (timedOut()) return timedOutResult(revision);

    const output = typeof value === "string" ? value : JSON.stringify(value);
    const content: RedactionContent = { kind: "inline", value: output };
    const items: RedactedItem[] = [
      ...new Set([...redactedLocations, ...droppedFields]),
    ].map((location) => ({ location }));
    const omissions: RedactionOmission[] = [...new Set(droppedFields)].map((
      location,
    ) => ({
      location,
      reason: "private",
      message: "A declared private or undeclared field was omitted.",
    }));
    return {
      rule_revision: revision,
      status: omissions.length > 0 ? "partial" : "passed",
      content,
      redacted_items: items,
      omissions,
    };
  }

  return {
    registry,
    redact: inspect,
    recheck: inspect,
    auditBlock(location) {
      return {
        location,
        reason: "secret_detected",
        message: "Blocked material was removed. No value was recorded.",
      };
    },
  };
}
