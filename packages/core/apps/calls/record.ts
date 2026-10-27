import type {
  AppInvocation,
  ProcessCallResponse,
  ToolDenial,
  ToolOutcome,
} from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";

// 한 호출을 기록하는 데 필요한 값. 입력과 출력 본문은 담지 않는다.
export type CallRecordBase = Pick<
  AppInvocation,
  "mode" | "operation" | "caller" | "effect" | "input_hash"
> & {
  id: Id<"inv">;
  app: Id<"app">;
  release: Id<"rel">;
};

export type Settled = {
  status: "succeeded" | "failed" | "unknown";
  summary: AppInvocation["summary"];
  outcome: ToolOutcome;
};

export function deniedOutcome(
  code: ToolDenial["code"],
  message: string,
): ToolOutcome {
  return { status: "denied", denial: { code, message } };
}

export function deniedSummary(code: ToolDenial["code"]) {
  return { outcome: "denied", error_code: code };
}

export function unknownSettled(): Settled {
  return {
    status: "unknown",
    summary: { outcome: "unknown" },
    outcome: { status: "unknown", reason: "connection_lost" },
  };
}

// 앱 process 응답을 기록과 부른 쪽 결과로 옮긴다. 응답이 null이면 보냈는데 답을 못 받은 것이다.
export function settleResponse(response: ProcessCallResponse | null): Settled {
  if (response === null) return unknownSettled();
  const dropped: Record<string, string> = response.changeset_dropped
    ? { changeset_dropped: response.changeset_dropped }
    : {};
  if (response.status === "ok") {
    return {
      status: "succeeded",
      summary: { outcome: "succeeded", ...dropped },
      outcome: { status: "succeeded", result: response.result },
    };
  }
  return {
    status: "failed",
    summary: {
      outcome: "failed",
      error_code: response.error.code,
      ...dropped,
    },
    outcome: { status: "failed", error: response.error },
  };
}

export function decodeChangeset(
  response: ProcessCallResponse | null,
): Uint8Array | null {
  if (response === null || response.changeset === null) return null;
  return Uint8Array.from(atob(response.changeset), (c) => c.charCodeAt(0));
}

// 끝에서 한 번에 남기는 기록. 시작을 미리 남기지 않은 호출(실패한 읽기, 막힌 호출)이 쓴다.
export function closedRow(
  base: CallRecordBase,
  closed: Pick<
    AppInvocation,
    "status" | "started_at" | "finished_at" | "summary"
  >,
): AppInvocation {
  return {
    ...base,
    ...closed,
    detail_hash: null,
    changeset: null,
    reverted_by: null,
  };
}
