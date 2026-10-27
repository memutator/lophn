// activation 한 시도를 순서대로 진행한다.
// `activation.start`가 시도를 연 뒤에 driver가 부르고 순서는 새 호출 접수 닫기와 비우기 → 이전 자식 종료 확인 →
// 실제 DB의 schema·무결성 읽기 → (필요하면) 보호 backup 확정 → migration → 새 앱 준비 확인(probe) →
// `activation.complete` commit → 업무 통로 열기 → 붙잡은 호출 넘기기다. 앞 단계가 확인되지 않으면 뒤 단계를
// 시작하지 않고, commit 전 실패는 복원·`activation.fail`·이전 release 재준비로 닫는다(recovery.ts).
// 응답을 잃었을 수 있는 core 호출 뒤에는 ledger를 다시 읽어 이어받는다.
import type { ReleaseRecord } from "../../../../protocol/apps/mod.ts";
import {
  type ActivationOutcome,
  type ActivationPorts,
  type Attempt,
  attemptOf,
  changeData,
  protectData,
  type StartedAttempt,
  unavailable,
  unchangedResult,
} from "./steps.ts";
import { pathFrom } from "./state.ts";
import { continueRecovery, rollback, settle } from "./recovery.ts";

// 도는 호출이 스스로 끝나기를 기다리는 시간. 넘으면 결과 모름으로 닫고 강제로 멈춘다.
const DRAIN_GRACE_MS = 30_000;

// 새 호출 접수를 닫고 도는 호출이 끝나기를 기다린다. 닫힌 동안 온 호출은 붙잡힌다.
async function drain(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<boolean> {
  try {
    ports.progress(attempt.app, "hold");
    ports.intake.close(attempt.app);
    ports.progress(attempt.app, "drain");
    const idle = await ports.intake.whenIdle(attempt.app, DRAIN_GRACE_MS);
    if (!idle.idle) await ports.intake.abandon(attempt.app);
    return true;
  } catch {
    return false;
  }
}

// 새 업무 통로를 열고(commit 뒤에만) 열지 못하면 같은 release를 다시 준비해 연다. 이때 옛 backup은
// 어떤 경우에도 쓰지 않는다: ledger가 이미 새 release를 채택했다.
async function openAfterCommit(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<ActivationOutcome> {
  const opened = await ports.supervisor.openCandidate(attempt);
  if (opened.ok) return { status: "active", opened: true };
  const started = await ports.supervisor.run(attempt.app, attempt.release);
  return { status: "active", opened: started.ok };
}

async function advance(
  ports: ActivationPorts,
  attempt: Attempt,
  release: ReleaseRecord,
): Promise<ActivationOutcome> {
  // 1. 새 호출 접수를 닫고 비운다.
  if (!(await drain(ports, attempt))) {
    return await rollback(
      ports,
      attempt,
      { code: "drain_failed", summary: "the running calls were not drained" },
      null,
      null,
    );
  }
  // 2. 이전 자식의 종료를 확인한다. 확인 전에는 데이터 작업도 새 자식도 없다.
  ports.progress(attempt.app, "stop");
  if (!(await ports.supervisor.stopCurrent(attempt.app))) {
    return unavailable("termination_unconfirmed");
  }
  // 3. 종료한 앱 DB의 실제 schema와 무결성을 읽는다. 이 schema가 migration의 출발점이고 복구본의 기준이다.
  const actual = await ports.data.inspect(attempt);
  if (!actual.ok || !actual.value.integrity_ok) {
    return await rollback(
      ports,
      attempt,
      { code: "schema_changed", summary: "the app data was not inspected" },
      null,
      null,
    );
  }
  const startSchema = actual.value.data_schema;
  const path = pathFrom(release, startSchema);
  if (!path.ok) {
    return await rollback(
      ports,
      attempt,
      {
        code: "schema_changed",
        summary: "no data change path from the actual schema",
      },
      null,
      startSchema,
    );
  }
  const started: StartedAttempt = { ...attempt, startSchema };

  // 4. 변경이 필요하면 보호 backup 참조를 ledger에 확정한 뒤에만 migration을 시작한다.
  ports.progress(attempt.app, "migrate", path.value.steps);
  let backupHash: string | null = null;
  let result;
  if (path.value.steps > 0) {
    const protectedData = await protectData(ports, started);
    if (protectedData.stage === "not_made") {
      return await rollback(
        ports,
        attempt,
        { code: "backup_failed", summary: "the data backup was not made" },
        null,
        startSchema,
      );
    }
    // 확정 응답을 잃었을 수 있다. ledger가 아는 것을 보고 이어받는다.
    if (protectedData.stage === "not_recorded") {
      return await continueRecovery(ports, attempt.release);
    }
    backupHash = protectedData.backup.backup_hash;
    const changed = await changeData(ports, started);
    if (!changed.ok) {
      return await rollback(
        ports,
        attempt,
        { code: "migration_failed", summary: `the ${changed.error.message}` },
        backupHash,
        startSchema,
      );
    }
    result = changed.value;
  } else {
    result = unchangedResult(started);
  }

  // 5. 새 앱을 준비 모드로 시작해 hash·handler·schema·직접 연결을 확인한다. 업무 통로는 아직 닫혀 있다.
  ports.progress(attempt.app, "start");
  const candidate = await ports.supervisor.startCandidate(attempt);
  if (!candidate.ok) {
    return await rollback(
      ports,
      attempt,
      { code: "start_failed", summary: "the new app did not become ready" },
      backupHash,
      startSchema,
    );
  }

  // 6. 활성 참조 commit. core가 같은 시도·실제 결과·준비 확인을 다시 검사한다.
  const completed = await ports.core.completeActivation({
    release: attempt.release,
    attempt: attempt.attempt,
    result,
    attestation: candidate.value.attestation,
  });
  if (completed.ok) return await openAfterCommit(ports, attempt);
  // 거절(근거가 맞지 않음)이든 응답 유실이든 ledger가 말하는 대로 이어받는다. 채택됐으면 복원하지 않고
  // 새 release를 다시 준비하며, 아직 진행 중이면 복원해서 닫는다.
  return await continueRecovery(ports, attempt.release, {
    code: "commit_rejected",
    summary: "the new release was not adopted",
  });
}

export async function runActivation(
  ports: ActivationPorts,
  release: ReleaseRecord,
): Promise<ActivationOutcome> {
  const attempt = attemptOf(release);
  if (attempt === undefined) return { status: "none" };
  const outcome = await advance(ports, attempt, release);
  await settle(ports, attempt.app, attempt.release, outcome);
  return outcome;
}
