// core 재시작 점검에서 apps/invocations가 내는 관측과 닫는 길.
// core를 다시 띄운 뒤 `running`으로 남은 invocation은 결과를 본 근거가 없다. 시작했으니 끝났다고도,
// 실패했다고도 추정하지 않고 unknown과 근거로 닫으며 같은 일을 다시 부르지 않는다.
import { ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { At } from "../../../protocol/base/values.ts";
import type { InvocationLedger } from "../ports.ts";

// platform의 RestartObservation과 같은 모양이다. 최상위 사이는 contract로만 부르므로 여기서 따로 쓴다.
type InvocationRestartObservation = {
  target: string;
  baseSeq: string;
  outcome: "confirmed" | "not_started" | "unknown";
  evidence: readonly string[];
  reason?: string;
};

type Rows = {
  all(
    query: string,
    params: readonly (string | number | bigint | null)[],
  ): readonly Record<string, unknown>[];
};

// 기동이 미확인 확정에 쓰는 core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수 없고,
// 읽기 목록만 닿는다. core가 기동 때 ledger에 기록해 둔다.

const REASON = "result_not_observed";

function evidenceOf(id: string, startedAt: string | null): string[] {
  return [
    `invocations:${id}:running`,
    startedAt === null
      ? `invocations:${id}:started_at:none`
      : `invocations:${id}:started_at:${startedAt}`,
  ];
}

export function observeInvocations(
  sql: Rows,
  _now: string,
): InvocationRestartObservation[] {
  try {
    // apps를 조립하지 않은 ledger에는 점검할 표가 없다. 없는 표를 읽지 못한 것으로 세지 않는다.
    const table = sql.all(
      "select name from sqlite_master where type = 'table' and name = 'invocations'",
      [],
    );
    if (table.length === 0) return [];
    const rows = sql.all(
      "select id, started_at from invocations where status = 'running' order by id",
      [],
    );
    return rows.map((row): InvocationRestartObservation => {
      const id = String(row["id"]);
      return {
        target: id,
        baseSeq: "0",
        outcome: "unknown",
        evidence: evidenceOf(
          id,
          row["started_at"] === null ? null : String(row["started_at"]),
        ),
        reason: REASON,
      };
    });
  } catch {
    return [
      {
        target: "invocations",
        baseSeq: "0",
        outcome: "unknown",
        evidence: [],
        reason: "invocation_tables_unreadable",
      },
    ];
  }
}

// 끝나지 않은 invocation을 결과 모름으로 닫는다. 닫은 개수를 준다. 이전 core의 앱 process는 이미 없어
// 돌아올 결과가 없다. changeset은 받지 못했으므로 붙지 않고, rewind에서 "되돌릴 수 없음"이 된다.
export async function closeUnfinishedInvocations(
  ledger: Pick<InvocationLedger, "unfinished" | "finish">,
  now: At,
): Promise<Result<number>> {
  const open = ledger.unfinished();
  if (!open.ok) return open;
  let closed = 0;
  for (const invocation of open.value) {
    const done = await ledger.finish(invocation.id as Id<"inv">, {
      status: "unknown",
      finished_at: now,
      summary: {
        outcome: "unknown",
        reason: "core_restarted",
        observation: REASON,
        evidence: evidenceOf(invocation.id, invocation.started_at),
      },
      detail_hash: null,
      changeset: null,
    });
    if (done.ok) closed++;
  }
  return ok(closed);
}
