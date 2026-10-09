import { err, ok, type Result } from "../../base/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";
import type { ProblemTestFact } from "../../contracts/problems/mod.ts";
import { loadRecords } from "./records.ts";

// 문제 상세가 읽는 테스트 사실이다(problems/tests#R5, problems#T22). core 조립이
// `ProblemTestPort`로 reader에 등록한다. 결과 없는 요청은 접수만 됨 → pending, 실제 시작 뒤 →
// running이고, 기록된 Verification은 pass·fail·inconclusive → pass·fail·unconfirmed다. 종류마다
// 지금 값 하나만 준다: 결과를 기다리는 요청이 있으면 그 요청이, 없으면 마지막 Verification이다.
// 준비에 실패한 요청은 결과가 아니므로 싣지 않는다. 종료 시각은 그 Verification을 남긴 실행
// 증거의 가장 늦은 `ended_at`이고, 증거가 없으면 null이다(지어내지 않는다).
type Kind = ProblemTestFact["kind"];
const KINDS: readonly Kind[] = ["reproduction", "app_test", "test_command"];
const RESULT: Record<string, ProblemTestFact["state"]> = {
  pass: "pass",
  fail: "fail",
  inconclusive: "unconfirmed",
};

export function problemTestLookup(
  sql: Pick<Sql, "get" | "all">,
  problem: string,
): Result<ProblemTestFact[]> {
  try {
    const current = new Map<Kind, ProblemTestFact>();
    const verifications = sql.all(
      `select kind, result, request_principal, request_key, recorded_seq,
              verification_canonical
       from verifications where problem = ?`,
      [problem],
    ).sort((left, right) =>
      Number(
        BigInt(String(left.recorded_seq)) -
          BigInt(String(right.recorded_seq)),
      )
    );
    for (const row of verifications) {
      const kind = kindOf(row.kind);
      const state = RESULT[String(row.result)];
      if (kind === undefined || state === undefined) return unreadable();
      current.set(kind, {
        kind,
        state,
        ended_at: endedAt(
          sql,
          String(row.request_principal),
          String(row.request_key),
          String(row.verification_canonical),
        ),
      });
    }
    const requests = sql.all(
      `select request_principal, request_key from test_requests
       where phase = 'accepted' and json_extract(payload, '$.problem') = ?
       order by seq`,
      [problem],
    );
    for (const request of requests) {
      const records = loadRecords(
        sql,
        String(request.request_principal),
        String(request.request_key),
      );
      if (
        records.some((record) =>
          record.phase === "result_ref" || record.phase === "preparation_failed"
        )
      ) continue;
      const accepted = records.find((record) => record.phase === "accepted");
      const kind = kindOf(accepted?.payload.kind);
      if (kind === undefined) return unreadable();
      current.set(kind, {
        kind,
        state: records.some((record) => record.phase === "actual_started")
          ? "running"
          : "pending",
        ended_at: null,
      });
    }
    return ok(KINDS.flatMap((kind) => {
      const fact = current.get(kind);
      return fact === undefined ? [] : [fact];
    }));
  } catch {
    return unreadable();
  }
}

function kindOf(value: unknown): Kind | undefined {
  return KINDS.find((kind) => kind === value);
}

function endedAt(
  sql: Pick<Sql, "all">,
  principal: string,
  key: string,
  canonical: string,
): string | null {
  let latest: string | null = null;
  for (
    const row of sql.all(
      `select evidence from test_evidence
       where request_principal = ? and request_key = ?`,
      [principal, key],
    )
  ) {
    const evidence = JSON.parse(String(row.evidence)) as {
      verification_canonical?: unknown;
      execution_evidence?: unknown;
    };
    if (
      evidence.verification_canonical !== canonical ||
      !Array.isArray(evidence.execution_evidence)
    ) continue;
    for (const item of evidence.execution_evidence) {
      const ended = (item as { ended_at?: unknown })?.ended_at;
      if (typeof ended === "string" && (latest === null || ended > latest)) {
        latest = ended;
      }
    }
  }
  return latest;
}

const unreadable = (): Result<never> =>
  err({ code: "unavailable", message: "problem tests could not be read" });
