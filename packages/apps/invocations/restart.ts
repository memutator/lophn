// 재시작 점검에서 apps/invocations가 내는 관측(platform/backup-and-migration#R16, apps/invocations#R9, R10).
// core를 다시 띄운 뒤 접수(accepted)나 실행 중(running)으로 남은 invocation은 실제 시작이나 결과를
// 본 근거가 없다. 접수가 있었다고 시작했다고, 시작을 알렸다고 끝났다고 추정하지 않으므로 둘 다
// unknown과 근거로 남기고 같은 일을 다시 부르지 않는다(R12). 읽기 전용 SQL만 쓴다.

// platform의 RestartObservation과 같은 모양이다. 최상위 사이는 contract로만 부르므로 여기서 따로 쓴다.
export type InvocationRestartObservation = {
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

function seqText(value: unknown): string {
  return typeof value === "bigint" || typeof value === "number"
    ? String(value)
    : "0";
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
      `select i.id, i.status, i.started_at,
              (select max(seq) from events where subject = i.id) as seq
         from invocations i
        where i.status in ('accepted', 'running')
        order by i.id`,
      [],
    );
    return rows.map((row): InvocationRestartObservation => {
      const id = String(row["id"]);
      const accepted = row["status"] === "accepted";
      return {
        target: id,
        baseSeq: seqText(row["seq"]),
        outcome: "unknown",
        evidence: [
          `invocations:${id}:${accepted ? "accepted" : "running"}`,
          ...(accepted || row["started_at"] === null
            ? [`invocations:${id}:started_at:none`]
            : [`invocations:${id}:started_at:${String(row["started_at"])}`]),
        ],
        reason: accepted ? "start_not_observed" : "result_not_observed",
      };
    });
  } catch {
    return [{
      target: "invocations",
      baseSeq: "0",
      outcome: "unknown",
      evidence: [],
      reason: "invocation_tables_unreadable",
    }];
  }
}
