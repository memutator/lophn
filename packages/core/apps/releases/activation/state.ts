// activation의 ledger 쪽 공통 규칙. start·complete·fail command와
// record_* 시도 확인이 같은 판정을 쓴다. 동기 함수만 있고 파일·process를 열지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  ActivationAttempt,
  ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { migrationPath } from "../../data/mod.ts";

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

// 시작 schema에서 release의 목표까지의 연속 경로다. schema가 같으면 빈 경로이고 뒤로 가는 release와
// 이어지지 않는 경로는 invalid_input이다. 시작 schema는 종료를 확인한 뒤 읽은 실제 DB의 값이다.
export function pathFrom(
  release: Pick<ReleaseRecord, "data_schema" | "data_changes">,
  startSchema: number,
): Result<{ steps: number }> {
  const path = migrationPath(
    startSchema,
    release.data_schema,
    release.data_changes,
  );
  return path.ok ? ok({ steps: path.value.steps.length }) : path;
}

// 진행 중인 시도의 release다. 같은 시도가 아니면 conflict다. 없는 release·범위 밖 앱·다른
// 시도는 같은 답이다.
export function inProgress(
  release: ReleaseRecord | null,
  attempt: string,
): Result<ReleaseRecord & { activation: ActivationAttempt }> {
  if (
    release === null || release.status !== "activating" ||
    release.activation === null || release.activation.attempt !== attempt
  ) {
    return conflict("no such activation is in progress");
  }
  return ok(release as ReleaseRecord & { activation: ActivationAttempt });
}

// status·activation·failure를 쓴다. activatedAt은 active가 될 때만 준다.
export function storeActivation(
  tx: Pick<Tx, "sql">,
  release: string,
  status: ReleaseRecord["status"],
  activation: ActivationAttempt | null,
  failure: ReleaseRecord["failure"],
  activatedAt?: string,
): void {
  tx.sql.run(
    `UPDATE releases
        SET status = ?, activation = ?, failure = ?,
            activated_at = COALESCE(?, activated_at)
      WHERE id = ?`,
    [
      status,
      activation === null ? null : JSON.stringify(activation),
      failure === null ? null : JSON.stringify(failure),
      activatedAt ?? null,
      release,
    ],
  );
}
