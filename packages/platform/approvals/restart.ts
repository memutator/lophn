// 재시작 점검의 approval 대기 관측(platform#T22가 이어받은 platform#T43 연결, b&m#R16).
// 결정은 ledger의 request·사용 기록에 남으므로 재시작은 대기를 잃지 않는다. 이 함수는 그 표를 실제로
// 읽어 아직 끝나지 않은 대기를 관측으로 내놓는다. 응답이 없다는 이유로 미실행을 추정하지 않는다:
// 관측은 현재 표의 상태이고, 읽지 못하면 unknown과 안전한 이유다.
// 미결정 대기와 허락됐지만 아직 적용되지 않은 request만 낸다. 끝난 결정·적용된 사용은 끝난 일이다.
import type { RestartObservation } from "../backup-and-migration/mod.ts";
import type { Sql } from "../../protocol/platform/mod.ts";
import { deadlineReached } from "./model.ts";

// 허락됐지만 적용되지 않은 request는 가장 최근 것부터 이만큼만 본다. 전체 표 scan을 기다리지 않는다(R15).
export const RESTART_GRANTED_LIMIT = 200;

function seqText(value: unknown): string {
  return typeof value === "bigint" || typeof value === "number"
    ? String(value)
    : "0";
}

export function observeApprovals(
  sql: Pick<Sql, "all">,
  now: string,
): RestartObservation[] {
  try {
    const pending = sql.all(
      `select id, created_seq, expires_at from approval_requests
        where status = 'pending' order by created_seq`,
      [],
    );
    const granted = sql.all(
      `select r.id, r.closed_seq from approval_requests r
        where r.status = 'granted'
          and not exists (select 1 from approval_uses u where u.approval = r.id)
        order by r.closed_seq desc limit ?`,
      [RESTART_GRANTED_LIMIT],
    );
    return [
      ...pending.map((row): RestartObservation => {
        const id = String(row["id"]);
        const expires = row["expires_at"] === null
          ? null
          : String(row["expires_at"]);
        return {
          target: id,
          baseSeq: seqText(row["created_seq"]),
          // 결정이 아직 없다. 기한이 지났다면 새 결정·사용은 거절되고 만료는 machine이 낸다.
          outcome: "not_started",
          evidence: [
            `approval_requests:${id}:pending`,
            ...(deadlineReached(expires, now) ? ["deadline_reached"] : []),
          ],
        };
      }),
      ...granted.map((row): RestartObservation => {
        const id = String(row["id"]);
        return {
          target: id,
          baseSeq: seqText(row["closed_seq"]),
          // 허락은 저장됐지만 소유 접수·변경이 아직 없다. 적용 성공으로 보지 않는다(R9).
          outcome: "not_started",
          evidence: [
            `approval_requests:${id}:granted`,
            `approval_uses:${id}:none`,
          ],
        };
      }),
    ];
  } catch {
    return [{
      target: "approvals",
      baseSeq: "0",
      outcome: "unknown",
      evidence: [],
      reason: "approval_tables_unreadable",
    }];
  }
}
