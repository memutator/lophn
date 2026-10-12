import { ok, type Result } from "../../base/mod.ts";
import { bundleContentSchema } from "../../protocol/projects/mod.ts";
import { type CheckInput, type CheckOutcome, runCheck } from "./check/mod.ts";
import { watchFolders } from "./watch/mod.ts";
import type { SnapshotPort, SubmitPort } from "./work-types.ts";

export type CheckJobRequest = {
  context: string;
  // `chk_…`. 임시 snapshot 폴더 이름이기도 하다.
  check: string;
  // submit한 판의 content JSON 그대로(모양 검사는 runCheck 안에서 한다)
  bundle: unknown;
  bundle_hash: string;
  user_saved_views: CheckInput["user_saved_views"];
  env: CheckInput["env"];
  // Project 폴더의 절대 경로. `snapshots`가 이것으로 파일을 복사한다. 어댑터가 따로 알면 비워도 된다.
  roots?: readonly string[];
};

export type CheckJobDeps = {
  snapshots: SnapshotPort;
  submit: Pick<SubmitPort, "finishCheck">;
};

// context.check: 후보 판의 계약이 가리키는 폴더(모양이 틀린 판이면 폴더 없음)를 임시 snapshot으로 복사해
// 고정하고, 그 snapshot에 대해서만 runCheck(app-data는 읽지 않는다)를 돌린 뒤
// `bundle.finish_check({ check, result: status, bundle_hash, snapshot_hash, findings, violation_count })`를
// 낸다. 통과·실패 모두 제출하고, 모양이 틀린 판도 failed finding으로 제출한다. 순서는
// snapshot 만들기 → runCheck → 제출 → snapshot 지우기이며, 제출이 실패해도 snapshot은 지운다.
// - snapshot을 만들지 못하면 `unavailable`을 돌려주고 아무것도 제출하지 않는다(결과 불명을 통과로 꾸미지 않는다).
// - 제출이 오류를 내면 그 오류를 그대로 돌려준다.
// 성공하면 제출한 outcome을 돌려준다.
export async function runCheckJob(
  deps: CheckJobDeps,
  request: CheckJobRequest,
): Promise<Result<CheckOutcome>> {
  const parsed = bundleContentSchema.safeParse(request.bundle);
  const folders = parsed.success ? watchFolders(parsed.data.contract) : [];
  const snapshot = deps.snapshots.create(request.check, folders, request.roots);
  if (!snapshot.ok) return snapshot;
  try {
    const outcome = runCheck({
      bundle: request.bundle,
      files: snapshot.value.files,
      appData: () => undefined,
      env: request.env,
      user_saved_views: request.user_saved_views,
    });
    const submitted = await deps.submit.finishCheck({
      check: request.check,
      result: outcome.status,
      bundle_hash: request.bundle_hash,
      snapshot_hash: outcome.snapshot_hash,
      findings: outcome.findings,
      violation_count: outcome.violation_count,
    });
    if (!submitted.ok) return submitted;
    return ok(outcome);
  } finally {
    snapshot.value.remove();
  }
}
