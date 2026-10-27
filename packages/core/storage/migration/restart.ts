import {
  type Clock,
  err,
  formatSeq,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { openConnection } from "../ledger/mod.ts";

// 재시작 점검 모양.
// 소유 concern의 복구 command가 아직 없는 영역은 이 모양으로 관측값을 남긴다.
// 각 대상의 상태·event는 해당 concern이 소유하고, 이 모듈은 소유 표를 읽지 않는다.
type RestartObservation = {
  // 복구 점검 대상의 실제 record ID · 자연키.
  target: string;
  // 점검 시작에 읽은 관련 변경 위치. 모르는 대상은 "0"이다.
  baseSeq: string;
  // 실제 관측만. 응답 부재로 not_started를 추정하지 않는다.
  outcome: "confirmed" | "not_started" | "unknown";
  // 준비·감사·프로세스 종료 등의 실제 근거. 없으면 빈 목록.
  evidence: readonly string[];
  // unknown이면 원문 없는 이유 필수(safe reason 모양).
  reason?: string;
};

type RestartCheck = {
  // schema 순번과 hash 유효성은 기동의 migration 적용이 이미 검사한다.
  // 여기서는 중단 흔적의 관측만 남긴다. 전역 barrier를 만들지 않는다.
  observations: readonly RestartObservation[];
};

// 소유 concern이 자기 표를 읽어 낸 관측. 이 모듈은 소유 표를 읽지 않으므로 소유 concern이 함수로 준다.
// 읽기 전용 SQL과 점검 시각을 받고, 읽지 못하면 unknown과 안전한 이유를 낸다.
export type RestartOwner = (
  sql: Pick<Sql, "all">,
  now: string,
) => readonly RestartObservation[];

type RestartDeps = {
  clock: Pick<Clock, "now">;
  // 복구 command 없이 표의 실제 상태를 관측할 수 있는 소유 concern.
  owners?: readonly RestartOwner[];
};

// 안전한 이유 모양(safeReason). unknown 관측값의 reason 필수 조건에 맞춘다.
const SAFE_REASON = /^[a-z][a-z0-9_]*$/;

/**
 * 재시작 뒤 중단 작업 점검. ledger 무결성·schema 점검 다음,
 * API 시작 전에 부른다. 소유 concern의 복구 command가 연결되기 전 영역은
 * unknown 관측값과 근거를 남긴다. 어느 관측도 읽기를 막지 않는다.
 */
export function checkRestart(
  ledgerPath: string,
  deps: RestartDeps,
): Promise<Result<RestartCheck>> {
  return Promise.resolve(
    readRestartTrace(ledgerPath, deps.clock.now(), deps.owners ?? []),
  );
}

// ledger 이력의 마지막 event seq를 읽는다. 소유 concern의 표를 다시 쓰지 않고
// 위치 관측만 한다. events 표의 trigger는 위치 읽기를 거르지 않는다.
function readRestartTrace(
  ledgerPath: string,
  at: string,
  owners: readonly RestartOwner[],
): Result<RestartCheck> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  const connection = opened.value;
  try {
    // 무결성·schema 이력은 기동의 migration 적용이 이미 검사했다(앞
    // 단계). 여기서 다시 scan하지 않는다: integrity_check는 전체 file
    // scan이라 기다리지 않는다는 원칙과 충돌한다. 위치 관측만 남긴다.
    const row = sqlGet(
      connection,
      "select seq from events order by seq desc limit 1",
    );
    const raw = row === undefined ? undefined : row["seq"];
    if (row !== undefined && (typeof raw !== "bigint" || raw < 0n)) {
      return err({
        code: "internal",
        message: "event seq를 읽지 못했다",
      });
    }
    const headSeq =
      raw === undefined || typeof raw !== "bigint" ? "0" : formatSeq(raw);
    // 소유 concern의 복구 command(invocation·release activation·turn)가
    // 아직 없어 어느 대상도 실제 관측으로 확정하지 못한다. 대상별
    // 관측 대신 기동 흔적 하나를 unknown으로 남긴다. reason은 안전한
    // 모양이고 근거는 ledger 위치뿐이다.
    const reason = "no_recovery_commands_registered";
    if (!SAFE_REASON.test(reason)) {
      return err({
        code: "internal",
        message: "재시작 점검 reason이 안전한 모양이 아니다",
      });
    }
    return ok({
      observations: [
        {
          target: "ledger-head",
          baseSeq: headSeq,
          outcome: "unknown",
          evidence: [`events:${headSeq} at ${at}`],
          reason,
        },
        ...owners.flatMap((owner) => owner(connection.sql, at)),
      ],
    });
  } finally {
    connection.close();
  }
}

// 위치 읽기가 실패하면(예: events 표가 없는 ledger, 잠깐의 busy) 확정된
// 위치가 없다는 뜻이다. 값은 unknown과 근거로 남기고 기동을 거절하지 않는다.
// 읽기 실패가 not_started의 근거가 아니다(응답 부재로 미실행 추정 불가).
function sqlGet(
  connection: ReturnType<typeof openConnection> extends Result<infer T>
    ? T
    : never,
  query: string,
): Record<string, unknown> | undefined {
  try {
    return connection.sql.get(query, []);
  } catch {
    return undefined;
  }
}
