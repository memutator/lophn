import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type {
  ProblemTestFact,
  ProblemTestRecord,
} from "../../../protocol/problems/mod.ts";
import type { TestConnection } from "./model.ts";
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

// 지금 값(종류마다 하나)과 따로, 이 문제의 실제 결과를 접지 않고 남긴다(tests#R4, R5).
// reproduction은 문제의 Verification 전부다. app test는 문제 열이 없으므로 마지막
// ProblemFixRecorded의 after release와 같은 bundle만 붙인다. 준비 실패는 Verification이
// 없으므로 not_run이고, 통과로 만들지 않는다. 종료 시각은 실행 증거에서만 온다.
export function problemTestHistory(
  sql: Pick<Sql, "get" | "all">,
  problem: string,
): Result<ProblemTestRecord[]> {
  try {
    const bundle = fixBundle(sql, problem);
    const verifications = sql.all(
      bundle === null
        ? `select kind, result, request_principal, request_key, recorded_seq,
                verification_canonical
           from verifications where problem = ?`
        : `select kind, result, request_principal, request_key, recorded_seq,
                verification_canonical
           from verifications
           where problem = ?
              or (kind = 'app_test' and problem is null and target_bundle_hash = ?)`,
      bundle === null ? [problem] : [problem, bundle],
    ).sort((left, right) =>
      Number(
        BigInt(String(left.recorded_seq)) -
          BigInt(String(right.recorded_seq)),
      )
    );
    const recorded: ProblemTestRecord[] = [];
    const verified = new Set<string>();
    for (const row of verifications) {
      const kind = kindOf(row.kind);
      const state = RESULT[String(row.result)];
      if (kind === undefined || state === undefined) return unreadable();
      const principal = String(row.request_principal);
      const key = String(row.request_key);
      verified.add(`${principal}\0${key}`);
      recorded.push({
        kind,
        state,
        ended_at: endedAt(
          sql,
          principal,
          key,
          String(row.verification_canonical),
        ),
      });
    }
    const failed = sql.all(
      `select request_principal, request_key from test_requests
       where phase = 'preparation_failed' order by seq`,
      [],
    );
    for (const request of failed) {
      const principal = String(request.request_principal);
      const key = String(request.request_key);
      if (verified.has(`${principal}\0${key}`)) continue;
      const records = loadRecords(sql, principal, key);
      if (records.some((record) => record.phase === "result_ref")) continue;
      if (!records.some((record) => record.phase === "preparation_failed")) {
        continue;
      }
      const payload = records.find((record) => record.phase === "accepted")
        ?.payload ?? records[0]?.payload;
      if (payload === undefined || !linked(payload, problem, bundle)) continue;
      const kind = kindOf(payload.kind);
      if (kind === undefined) return unreadable();
      recorded.push({ kind, state: "not_run", ended_at: null });
    }
    return ok(recorded);
  } catch {
    return unreadable();
  }
}

// 마지막 고친 기록의 after release bundle이다. 표가 없거나 기록이 없으면 null이고
// 그때는 문제 열이 없는 app test를 이 문제에 붙이지 않는다.
function fixBundle(
  sql: Pick<Sql, "get">,
  problem: string,
): string | null {
  try {
    const row = sql.get(
      `select json_extract(payload, '$.after') as after from events
       where type = 'ProblemFixRecorded' and subject = ?
       order by seq desc limit 1`,
      [problem],
    );
    if (row === undefined || row.after == null) return null;
    const release = sql.get(
      `select bundle_hash from releases where id = ?`,
      [String(row.after)],
    );
    return release === undefined ? null : String(release.bundle_hash);
  } catch {
    return null;
  }
}

function linked(
  payload: TestConnection,
  problem: string,
  bundle: string | null,
): boolean {
  if (payload.problem === problem) return true;
  return payload.kind === "app_test" && payload.problem === null &&
    bundle !== null && payload.target?.bundle_hash === bundle;
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
