// 기한에 도달한 대기 request를 찾는 core 내부 read(platform/approvals#R12, R15).
// 기한 뒤의 결정·사용은 command가 이미 거절하므로 안전은 지켜지지만, pending이 expired로 바뀌려면
// machine이 `expire_approval_request`를 내야 한다. core의 주기 정리(packages/core/main/daemon/runtime.ts)가 이 후보를
// 읽고 command를 제출한다. read는 표를 쓰지 않고 시각은 호출자가 넘기므로 테스트가 시계를 주입한다.
// 후보는 경계에 도달한(`now >= expires_at`) pending request뿐이다. 기한 없는 request는 만료하지 않는다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { defineRead, type ReadDefinition } from "../../protocol/server/mod.ts";
import { deadlineReached } from "./model.ts";

// 한 번의 정리가 다루는 후보 수. 응답 행 한도 안에 두고 나머지는 다음 정리가 이어 만료한다.
export const EXPIRY_SWEEP_BATCH = 100;

export const approvalExpirySweep = defineRead({
  resource: "approvals",
  method: "expiry_sweep",
  name: "ApprovalExpirySweep",
  input: z.strictObject({ now: z.string() }),
  output: z.object({
    approvals: z.array(
      z.object({ approval: z.string(), created_seq: z.string() }),
    ),
    as_of_seq: z.string(),
    next_cursor: z.string().nullable(),
  }),
  actors: ["machine"],
  errors: ["forbidden"],
});

export function approvalExpirySweepRead(): ReadDefinition<
  typeof approvalExpirySweep
> {
  return {
    route: approvalExpirySweep,
    handle(snapshot, _ctx, input) {
      // 기한이 있는 pending만 기한 순으로 읽고 경계는 model의 같은 규칙으로 판단한다.
      const rows = snapshot.sql.all(
        `select id, created_seq, expires_at from approval_requests
          where status = 'pending' and expires_at is not null
          order by expires_at, created_seq`,
        [],
      );
      const approvals: { approval: string; created_seq: string }[] = [];
      for (const row of rows) {
        if (approvals.length >= EXPIRY_SWEEP_BATCH) break;
        if (!deadlineReached(String(row["expires_at"]), input.now)) continue;
        approvals.push({
          approval: String(row["id"]),
          created_seq: String(row["created_seq"]),
        });
      }
      return ok({
        approvals,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
