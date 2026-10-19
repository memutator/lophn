// 순수 판정. 표와 blob은 ledger.ts가 만진다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  REDACTION_MAX_DEPTH,
  REDACTION_REPLACEMENT,
} from "../../../base/redaction/mod.ts";
import { type AppInvocation } from "../../../protocol/apps/calls/mod.ts";
import { INVOCATION_SUMMARY_MAX_BYTES } from "../../../protocol/apps/mod.ts";
import {
  CHANGESET_MAX_BYTES,
  RELEASE_CHANGESET_MAX_BYTES,
} from "./changesets.ts";

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 시작을 미리 남길 호출: write·external tool과 앱 시작. 읽기는 실패했을 때 끝에서 한 번에 남기고,
// data_change는 이미 일어난 일이라 끝에서 한 번에 남긴다.

// `running`만 종료 상태로 간다. 종료 상태는 바뀌지 않는다.
export function finishable(current: AppInvocation): Result<void> {
  return current.status === "running"
    ? ok(undefined)
    : conflict("invocation is already finished");
}

// 끝에서 한 번에 남기는 행. 종료 상태이고 changeset과 되돌림 표시가 없어야 한다.
export function recordableOnce(input: AppInvocation): Result<void> {
  if (input.status === "running") return invalid("a running invocation");
  if (input.changeset !== null || input.reverted_by !== null) {
    return invalid("a recorded-once invocation has no changeset or rewind");
  }
  return ok(undefined);
}

type ChangesetVerdict = "fits" | "too_large" | "release_full";

// changeset을 붙일 수 있는지. 못 붙이면 그 invocation은 changeset 없이 닫힌다.
export function changesetVerdict(
  size: number,
  releaseBytes: number,
): ChangesetVerdict {
  if (size > CHANGESET_MAX_BYTES) return "too_large";
  if (releaseBytes + size > RELEASE_CHANGESET_MAX_BYTES) return "release_full";
  return "fits";
}

// summary의 민감 key를 구조로 지운다. 원문 일치와 무관하다.
const SENSITIVE_KEYS =
  /^(?:secret|token|password|credential|authorization|cookie)$/i;

export function redactSummary(
  summary: AppInvocation["summary"],
): AppInvocation["summary"] {
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > REDACTION_MAX_DEPTH) return value;
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, depth + 1));
    }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        next[key] = SENSITIVE_KEYS.test(key)
          ? REDACTION_REPLACEMENT
          : walk(record[key], depth + 1);
      }
      return next;
    }
    return value;
  };
  return walk(summary, 0) as AppInvocation["summary"];
}

// 요약 상한은 redaction 뒤 UTF-8 크기로 본다.
export function checkSummary(summary: AppInvocation["summary"]): Result<void> {
  return new TextEncoder().encode(JSON.stringify(summary)).length <=
      INVOCATION_SUMMARY_MAX_BYTES
    ? ok(undefined)
    : invalid("invocation summary exceeds the limit");
}
