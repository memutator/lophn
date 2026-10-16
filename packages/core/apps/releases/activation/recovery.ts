// activation의 실패 복원과 끊긴 시도의 이어받기. 새 업무 통로를 열기
// 전의 실패만 backup으로 복원하고, ledger가 이미 새
// release를 채택했으면 옛 backup으로 데이터를 덮지 않는다. 복원이 실패하거나 확인되지 않으면 이전 코드도
// 시작하지 않고 앱을 사용할 수 없는 상태로 둔다.
import type { Sql } from "../../../../protocol/server/mod.ts";
import {
  type ActivationOutcome,
  type ActivationPorts,
  type Attempt,
  attemptOf,
  type FailureReason,
  quiesce,
  unavailable,
} from "./steps.ts";

// 사용할 수 없게 둔 이유를 앱 상태에 남기고 unavailable로 끝낸다. 데이터를 더 덮거나 이전 코드를 시작하지 않는다.
async function stuck(
  ports: ActivationPorts,
  attempt: Attempt,
  code: string,
  summary: string,
): Promise<ActivationOutcome> {
  await ports.core.markUnavailable(attempt.app, attempt.release, {
    code,
    summary,
  });
  return unavailable(code);
}

// 실패한 시도를 닫는다: 자식 종료 확인 → (backup이 있으면) 복원·실제 무결성·schema 확인과 ledger 확정 →
// activation.fail → 이전 release 다시 준비. 앞 단계가 확인되지 않으면 뒤 단계를 하지 않는다.
// startSchema는 종료 뒤 읽은 실제 schema다. 끊긴 시도를 이어받을 때는 모른다(null).
export async function rollback(
  ports: ActivationPorts,
  attempt: Attempt,
  failure: FailureReason,
  backupHash: string | null,
  startSchema: number | null,
): Promise<ActivationOutcome> {
  if (!await quiesce(ports, attempt.app)) {
    return await stuck(
      ports,
      attempt,
      "termination_unconfirmed",
      "the app process exit was not confirmed",
    );
  }
  if (backupHash !== null) {
    const restored = await ports.data.restore(attempt, backupHash);
    if (
      !restored.ok || !restored.value.integrity_ok ||
      (startSchema !== null && restored.value.data_schema !== startSchema)
    ) {
      return await stuck(
        ports,
        attempt,
        "restore_failed",
        "the app data was not restored from the backup",
      );
    }
    // ledger가 복원된 schema가 복구본의 schema인지 한 번 더 확인한다.
    const recorded = await ports.core.recordDataRestore(
      restored.value,
      backupHash,
    );
    if (!recorded.ok) {
      return await stuck(
        ports,
        attempt,
        "restore_not_recorded",
        "the restore result was not confirmed",
      );
    }
  } else {
    // 변경 전에 실패했다. 실제 DB가 온전하고 시작 때와 같은지 확인한다.
    const actual = await ports.data.inspect(attempt);
    if (
      !actual.ok || !actual.value.integrity_ok ||
      (startSchema !== null && actual.value.data_schema !== startSchema)
    ) {
      return await stuck(
        ports,
        attempt,
        "schema_unconfirmed",
        "the app data does not match the schema at the start",
      );
    }
  }
  const failed = await ports.core.failActivation({
    release: attempt.release,
    attempt: attempt.attempt,
    failure: {
      ...failure,
      restored: attempt.previousRelease === null ? null : true,
    },
  });
  // 데이터는 복원됐지만 실패 확정을 모른다. ledger는 아직 진행 중이므로 다시 이어받을 수 있다.
  if (!failed.ok) return unavailable("fail_not_recorded");
  return {
    status: "failed",
    code: failure.code,
    previous: await restartPrevious(ports, attempt),
  };
}

async function restartPrevious(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<"started" | "not_started" | null> {
  if (attempt.previousRelease === null) return null;
  const started = await ports.supervisor.run(
    attempt.app,
    attempt.previousRelease,
  );
  return started.ok ? "started" : "not_started";
}

// 끝난 시도 뒤에 얹는 일. 성공이면 이전 release의 changeset을 지운다. 성공·실패 모두 열린 앱 view를 다시
// 그리게 하고, 새 호출 접수를 다시 열어 붙잡은 호출을 그때의 활성 release로 넘긴다.
export async function settle(
  ports: ActivationPorts,
  app: string,
  release: string,
  outcome: ActivationOutcome,
): Promise<void> {
  if (outcome.status === "active") {
    await ports.after.pruneChangesets(app, release);
  }
  if (outcome.status === "active" || outcome.status === "failed") {
    ports.after.viewChanged(app);
  }
  ports.intake.open(app);
}

// 끊긴 시도를 ledger와 실제 관측으로 잇는다(재시작 점검 뒤, 응답 유실, supervisor·core 재시작).
// ledger가 새 release를 채택했으면 데이터를 복원하지 않고 그 release를 다시 준비한다. 진행 중이면 시도가
// 데이터를 바꿨을 수 있으므로 알려진 backup으로만 복원하고 모르는 script를 다시 적용하지 않는다.
// 새 호출 접수를 열고 후속 일을 하는 settle은 부르는 쪽이 한다.
export async function continueRecovery(
  ports: ActivationPorts,
  releaseId: string,
  // 진행 중인 시도를 닫을 때 남길 실패 근거다. 끊긴 시도를 처음 이어받으면 interrupted다.
  failure: FailureReason = {
    code: "start_failed",
    summary: "the activation was interrupted",
  },
): Promise<ActivationOutcome> {
  const read = await ports.core.release(releaseId);
  if (!read.ok) return unavailable("core_unreachable");
  const release = read.value;
  if (release === null || release.activation === null) {
    return { status: "none" };
  }
  if (release.status === "active") {
    const started = await ports.supervisor.run(release.app, release.id);
    return { status: "active", opened: started.ok };
  }
  if (release.status === "failed") {
    const previous = release.activation.previous_release;
    if (previous === null) {
      return {
        status: "failed",
        code: release.failure?.code ?? "",
        previous: null,
      };
    }
    const started = await ports.supervisor.run(release.app, previous);
    return {
      status: "failed",
      code: release.failure?.code ?? "",
      previous: started.ok ? "started" : "not_started",
    };
  }
  const attempt = attemptOf(release);
  if (attempt === undefined) return { status: "none" };
  ports.intake.close(attempt.app);
  return await rollback(
    ports,
    attempt,
    failure,
    release.activation.backup_hash,
    null,
  );
}

export async function recoverActivation(
  ports: ActivationPorts,
  releaseId: string,
  failure?: FailureReason,
): Promise<ActivationOutcome> {
  const outcome = await continueRecovery(ports, releaseId, failure);
  const read = await ports.core.release(releaseId);
  if (read.ok && read.value !== null) {
    await settle(ports, read.value.app, releaseId, outcome);
  }
  return outcome;
}

// ---- 재시작 점검 ----

type Observation = {
  target: string;
  baseSeq: string;
  outcome: "confirmed" | "not_started" | "unknown";
  evidence: readonly string[];
  reason?: string;
};

// core를 다시 띄운 뒤 진행 중으로 남은 activation이다. 점검은 읽기 전용 SQL만 쓰므로 자식·DB를 실제로
// 보지 못한다. 시작했다고도 끝났다고도 추정하지 않고 unknown과 근거를 남기며 실제 관측으로 확정하는 일은
// `recoverActivation`이 supervisor·data worker 관측으로 한다. 같은 일을 다시 시작하지 않는다.
export function observeReleaseActivations(
  sql: Pick<Sql, "all">,
  _now: string,
): Observation[] {
  try {
    const table = sql.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'releases'",
      [],
    );
    if (table.length === 0) return [];
    return sql.all(
      `SELECT id, app,
              json_extract(activation, '$.attempt') AS attempt,
              json_extract(activation, '$.backup_hash') AS backup_hash
         FROM releases WHERE status = 'activating' ORDER BY id`,
      [],
    ).map((row): Observation => {
      const id = String(row.id);
      return {
        target: id,
        baseSeq: "0",
        outcome: "unknown",
        evidence: [
          `releases:${id}:activating`,
          `releases:${id}:attempt:${String(row.attempt)}`,
          row.backup_hash === null
            ? `releases:${id}:backup:none`
            : `releases:${id}:backup:recorded`,
        ],
        reason: "activation_not_settled",
      };
    });
  } catch {
    return [{
      target: "releases",
      baseSeq: "0",
      outcome: "unknown",
      evidence: [],
      reason: "release_tables_unreadable",
    }];
  }
}

// ---- migration 이력 ----
