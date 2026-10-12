// session 관측 entry다. `session observe`가 받은 hook·plugin·extension payload를
// 제품별 normalizer로 정규화한 HarnessSessionObservation으로 바꾼다. 검증하지 않은 제품(Hermes·OpenClaw)은 상태·ID를
// 지어내지 않고 unknown observation이다. 이 entry는 claim·connection·process를 건드리지 않는다.
import type {
  HarnessId,
  HarnessSessionObservation,
} from "../../../protocol/coding-agent/mod.ts";
import { normalizeClaude, normalizeCodex, normalizeGemini } from "./hooks.ts";
import {
  type Evidence,
  type Normalizer,
  observationOf,
  type ObserveContext,
  recordOf,
} from "./model.ts";
import { normalizeOpencode, normalizePi } from "./plugins.ts";

export type { ObserveContext } from "./model.ts";

const NORMALIZERS: Readonly<Partial<Record<HarnessId, Normalizer>>> = {
  claude: normalizeClaude,
  codex: normalizeCodex,
  gemini: normalizeGemini,
  opencode: normalizeOpencode,
  pi: normalizePi,
};

// 검증한 normalizer가 없는 제품이다. payload가 와도 상태를 믿지 않는다.
function unverifiedEvidence(harness: HarnessId): Evidence {
  return {
    state: "unknown",
    source: "hook",
    ref: `${harness}:unverified`,
    session: null,
    cwd: null,
    reason: "이 제품의 관측 event는 검증하지 않아 상태를 알 수 없다",
  };
}

// payload 하나다. 상태 evidence가 아닌 event는 null이다.
export function observationFromPayload(
  harness: HarnessId,
  payload: unknown,
  context: ObserveContext,
): HarnessSessionObservation | null {
  const body = recordOf(payload);
  if (body === null) return null;
  const normalizer = NORMALIZERS[harness];
  const evidence = normalizer === undefined
    ? unverifiedEvidence(harness)
    : normalizer(body);
  return evidence === null ? null : observationOf(harness, evidence, context);
}

export type ObserveOutcome = {
  observations: HarnessSessionObservation[];
  // 상태 evidence가 아니라 버린 event 수다.
  ignored: number;
  // JSON이나 object로 읽지 못한 줄 수다.
  rejected: number;
};

// stdin 전체가 JSON 하나(hook)이면 payload 하나이고, 아니면 줄마다 JSON 하나(NDJSON stream, plugin·extension의
// 긴 pipe)다. 읽지 못한 줄은 버리고 센다.
export function observeStream(
  harness: HarnessId,
  text: string,
  context: ObserveContext,
): ObserveOutcome {
  const outcome: ObserveOutcome = { observations: [], ignored: 0, rejected: 0 };
  const payloads: unknown[] = [];
  try {
    payloads.push(JSON.parse(text));
  } catch {
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        payloads.push(JSON.parse(line));
      } catch {
        outcome.rejected += 1;
      }
    }
  }
  for (const payload of payloads) {
    if (recordOf(payload) === null) {
      outcome.rejected += 1;
      continue;
    }
    const observation = observationFromPayload(harness, payload, context);
    if (observation === null) outcome.ignored += 1;
    else outcome.observations.push(observation);
  }
  return outcome;
}
