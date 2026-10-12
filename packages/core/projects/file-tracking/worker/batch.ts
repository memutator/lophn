// 후보 배분 묶음의 준비 worker 요청·응답(architecture/documents 2.3). coordinator의 배분 루프가
// root별 후보 묶음(최대 128)을 이 요청으로 준비 worker에 보내면, worker는 후보마다 안정 읽기를
// 하고 hash·크기(또는 unverified 이유)를 후보 순서대로 돌려준다. 본문은 응답에 싣지 않는다.
// 준비 worker가 답하지 못한 배분은 unavailable이고 제출하지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import { type Candidate, PREPARATION_OPS, type PrepareSlot } from "../mod.ts";
import type { PreparationPool } from "./pool.ts";

// 후보 하나의 안정 읽기 결과. worker가 hash와 같은 읽기 stream에서 크기를 낸다.
export type BatchOutcome =
  | {
    path: string;
    kind: "stable";
    hash: string;
    size: number;
    real_path: string;
  }
  | { path: string; kind: "unverified"; reason: string };

export function createBatchDispatch(
  pool: Pick<PreparationPool, "request">,
): (
  slot: PrepareSlot,
  scheduled: { root: string; batch: readonly Candidate[] },
) => Promise<Result<readonly unknown[], LophnError>> {
  return async (_slot, scheduled) => {
    const answered = await pool.request({
      op: PREPARATION_OPS.hashBatch,
      payload: {
        root: scheduled.root,
        batch: scheduled.batch.map((candidate) => ({
          path: candidate.path,
          observedAt: candidate.observedAt,
        })),
      },
      priority: "background",
    });
    if (!answered.ok) return answered;
    const results = (answered.value as { results?: unknown }).results;
    return Array.isArray(results) && results.length === scheduled.batch.length
      ? ok(results)
      : err({ code: "unavailable", message: "batch result is invalid" });
  };
}
