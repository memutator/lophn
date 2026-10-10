// snapshot 로그 조각의 허용된 진단 조회(snapshots#R13, R14, R16, R17). 앱 프로세스는
// snapshot 첨부를 직접 읽지 못한다. 고정한 조각은 앱의 임시 log buffer와 독립이라
// buffer를 비운 뒤에도 같은 blob에서 읽힌다.
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import { parseActor } from "../../contracts/platform/mod.ts";
import type {
  ApiReadDefinition,
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  type getSnapshot,
  getSnapshotLogs,
  getSnapshotLogsInputSchema,
  type LogEvidence,
  type LogFragment,
  type MissingReason,
} from "../../contracts/problems/mod.ts";

export type SnapshotBlobRead =
  | { status: "available"; bytes: Uint8Array }
  | { status: "unavailable"; reason: "pruned" | "missing" | "corrupt" };

// blob 읽기 통로. hash만으로는 읽을 수 없고 호출자가 허용 owner·field에서 시작한다.
export type SnapshotBlobReader = (hash: string) => Promise<SnapshotBlobRead>;

export type LogFragmentRead = LogFragment;

const UNAVAILABLE_REASONS = {
  pruned: "용량 상한을 넘어 오래된 로그 조각이 정리되었다",
  missing: "로그 조각 blob이 저장소에 없다",
  corrupt: "로그 조각 blob의 내용이 등록된 hash와 다르다",
} as const;

// GetSnapshot이 사람에게 보이는 정리 부재. 로그 조각 조회의 긴 문장은 위의 pruned다.
export const PRUNED_ABSENCE_REASON = "정리됨";

const BLOB_STATUS = ["pruned", "missing", "corrupt"] as const;
export type SnapshotBlobReason = (typeof BLOB_STATUS)[number];

function knownBlobReason(value: unknown): SnapshotBlobReason | undefined {
  for (const reason of BLOB_STATUS) {
    if (value === reason) return reason;
  }
  return undefined;
}

// blob 바이트 읽기 오류에서 store가 구별한 이유를 고른다. 표시가 없으면 부재다.
export function snapshotBlobStatus(error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): SnapshotBlobReason {
  return knownBlobReason(error.details?.["reason"]) ??
    knownBlobReason(error.message) ??
    "missing";
}

export type PrunedAttachments = {
  stack: boolean;
  logs: boolean;
  screenshot: boolean;
};

// 용량 정리로 사라진 첨부만 항목 부재를 "정리됨"으로 바꾼다(snapshots#R17).
// blobs의 hash 참조는 남긴다. 저장돼 있던 다른 부재 이유는 그대로다.
export function applyPrunedSnapshotAbsence(
  value: Output<typeof getSnapshot>,
  pruned: PrunedAttachments,
  item: Input<typeof getSnapshot>["item"],
): Output<typeof getSnapshot> {
  const next = structuredClone(value);
  const snapshot = next.snapshot;
  const error = snapshot.error;
  if (pruned.stack && error !== null && error.stack !== null) {
    snapshot.error = {
      ...error,
      stack: null,
      stack_missing_reason: { reason: PRUNED_ABSENCE_REASON },
    };
  }
  if (pruned.logs && snapshot.logs !== null) {
    snapshot.logs = null;
    snapshot.logs_missing_reason = { reason: PRUNED_ABSENCE_REASON };
  }
  const screen = snapshot.screen;
  if (pruned.screenshot && screen !== null && screen.screenshot !== null) {
    snapshot.screen = {
      ...screen,
      screenshot: null,
      screenshot_missing_reason: { reason: PRUNED_ABSENCE_REASON },
    };
  }
  if (item === "error" && pruned.stack && snapshot.error !== null) {
    next.item = snapshot.error;
    next.missing = { reason: PRUNED_ABSENCE_REASON };
  } else if (item === "logs" && pruned.logs) {
    next.item = null;
    next.missing = { reason: PRUNED_ABSENCE_REASON };
  } else if (
    item === "screen" && pruned.screenshot && snapshot.screen !== null
  ) {
    next.item = snapshot.screen;
    next.missing = { reason: PRUNED_ABSENCE_REASON };
  }
  return next;
}

// core가 GetSnapshot 응답에 정리 부재를 얹을 때 넘기는 ledger snapshot.
export type SnapshotViewRequest = {
  snapshot: ReadSnapshot;
  ctx: RequestContext;
  input: Input<typeof getSnapshot>;
};

// 앱·알 수 없는 actor는 snapshot 첨부를 읽을 수 없고 없는 것과 같은 답을 받는다.
function mayRead(actor: string): boolean {
  const parts = parseActor(actor);
  return parts !== undefined && parts.kind !== "app";
}

export async function readLogFragment(input: {
  actor: string;
  snapshot: {
    logs: LogEvidence | null;
    logs_missing_reason: MissingReason | null;
  };
  read: SnapshotBlobReader;
}): Promise<Result<LogFragmentRead>> {
  if (!mayRead(input.actor)) {
    return err({ code: "not_found", message: "Snapshot이 없다" });
  }
  const logs = input.snapshot.logs;
  if (logs === null) {
    return ok({
      kind: "absent",
      reason: input.snapshot.logs_missing_reason?.reason ?? "이유가 없다",
    });
  }
  const blob = await input.read(logs.blob);
  if (blob.status === "unavailable") {
    return ok({
      kind: "unavailable",
      reason: UNAVAILABLE_REASONS[blob.reason],
      scope: logs.scope,
      collected_at: logs.collected_at,
      truncated: logs.truncated,
    });
  }
  // 읽은 바이트가 고정한 hash와 같은지 다시 본다. 다르면 빈 성공으로 채우지 않는다.
  if (await sha256Hex(blob.bytes) !== logs.blob) {
    return ok({
      kind: "unavailable",
      reason: UNAVAILABLE_REASONS.corrupt,
      scope: logs.scope,
      collected_at: logs.collected_at,
      truncated: logs.truncated,
    });
  }
  return ok({
    kind: "fragment",
    lines: new TextDecoder().decode(blob.bytes).split("\n"),
    line_count: logs.line_count,
    truncated: logs.truncated,
    scope: logs.scope,
    from_at: logs.from_at,
    to_at: logs.to_at,
    collected_at: logs.collected_at,
    observation: logs.truncated
      ? "잘린 조각이다. 범위 밖은 알 수 없고 조각만으로 전체 비율을 계산하지 않는다"
      : "범위 안의 조각이다. 범위 밖은 발생 없음이 아니다",
  });
}

// 고정한 snapshot의 로그 증거 행. 없는 snapshot은 undefined다.
export type SnapshotLogsRow = {
  as_of_seq: string;
  logs: LogEvidence | null;
  logs_missing_reason: MissingReason | null;
};

// core가 기동 때 넣는 읽기 통로: 증거 행은 ledger에서, 바이트는 blob store에서 온다.
export type SnapshotLogsEnvironment = {
  evidence(snapshot: string): Result<SnapshotLogsRow | undefined>;
  blobs: SnapshotBlobReader;
  // 붙어 있으면 GetSnapshot이 정리된 첨부를 "정리됨"으로 답한다.
  view?(
    ctx: RequestContext,
    input: unknown,
  ): Promise<Result<Output<typeof getSnapshot>>>;
};

const LOGS_COLUMNS = `logs_blob, logs_line_count, logs_truncated, logs_scope,
  logs_from_at, logs_to_at, logs_collected_at, logs_missing_reason`;

// snapshots 표의 로그 열을 LogEvidence로 읽는다.
export function logsRowOf(
  sql: {
    get(query: string, params: string[]): Record<string, unknown> | undefined;
  },
  snapshot: string,
  asOfSeq: string,
): SnapshotLogsRow | undefined {
  const row = sql.get(`select ${LOGS_COLUMNS} from snapshots where id = ?`, [
    snapshot,
  ]);
  if (row === undefined) return undefined;
  const text = (value: unknown) =>
    value === null || value === undefined ? null : String(value);
  const missing = text(row["logs_missing_reason"]);
  return {
    as_of_seq: asOfSeq,
    logs: row["logs_blob"] === null ? null : {
      blob: String(row["logs_blob"]),
      line_count: Number(row["logs_line_count"]),
      truncated: Number(row["logs_truncated"]) === 1,
      scope: String(row["logs_scope"]),
      from_at: text(row["logs_from_at"]),
      to_at: text(row["logs_to_at"]),
      collected_at: String(row["logs_collected_at"]),
    },
    logs_missing_reason: missing === null ? null : { reason: missing },
  };
}

// GetSnapshotLogs: 사람(user)만 고정한 로그 조각을 읽는다. 앱·없는 snapshot은 같은
// not_found다. 평소 read처럼 ledger snapshot에 묶지 않고 바이트를 기다린다.
export function snapshotLogsRead(
  environment: SnapshotLogsEnvironment,
): ApiReadDefinition<typeof getSnapshotLogs> {
  return {
    route: getSnapshotLogs,
    async handle(ctx, input) {
      const absent = err({
        code: "not_found" as const,
        message: "Snapshot이 없다",
      });
      const parsed = getSnapshotLogsInputSchema.safeParse(input);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "snapshot log input is invalid",
        });
      }
      if (parseActor(ctx.actor)?.kind !== "user") return absent;
      const found = environment.evidence(parsed.data.snapshot);
      if (!found.ok) return found;
      if (found.value === undefined) return absent;
      const read = await readLogFragment({
        actor: ctx.actor,
        snapshot: found.value,
        read: environment.blobs,
      });
      if (!read.ok) return read;
      return ok({
        fragment: read.value,
        as_of_seq: found.value.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
