// snapshot 로그 조각의 허용된 진단 조회(snapshots#R13, R14, R16, R17). 앱 프로세스는
// snapshot 첨부를 직접 읽지 못한다. 고정한 조각은 앱의 임시 log buffer와 독립이라
// buffer를 비운 뒤에도 같은 blob에서 읽힌다.
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import { parseActor } from "../../contracts/platform/mod.ts";
import type {
  LogEvidence,
  MissingReason,
} from "../../contracts/problems/mod.ts";

export type SnapshotBlobRead =
  | { status: "available"; bytes: Uint8Array }
  | { status: "unavailable"; reason: "pruned" | "missing" | "corrupt" };

// blob 읽기 통로. hash만으로는 읽을 수 없고 호출자가 허용 owner·field에서 시작한다.
export type SnapshotBlobReader = (hash: string) => Promise<SnapshotBlobRead>;

export type LogFragmentRead =
  | { kind: "absent"; reason: string }
  | {
    kind: "unavailable";
    reason: string;
    scope: string;
    collected_at: string;
    truncated: boolean;
  }
  | {
    kind: "fragment";
    lines: string[];
    line_count: number;
    truncated: boolean;
    scope: string;
    from_at: string | null;
    to_at: string | null;
    collected_at: string;
    // 조각의 범위를 사람이 읽는 말로 고정한다. 비율·합계를 계산하지 않는다(R14).
    observation: string;
  };

const UNAVAILABLE_REASONS = {
  pruned: "용량 상한을 넘어 오래된 로그 조각이 정리되었다",
  missing: "로그 조각 blob이 저장소에 없다",
  corrupt: "로그 조각 blob의 내용이 등록된 hash와 다르다",
} as const;

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
