// activation 한 시도를 순서대로 진행한다(apps/releases#R13, R14, apps/data#R4, architecture/apps 7.4).
// ReleaseActivationStarted 뒤에 supervisor가 부르고 순서는 이전 자식 종료 확인 → 실제 schema 확인 → (필요하면)
// 보호 backup 확정 → migration → 새 앱 준비 확인(probe) → complete_activation commit → 업무 통로 open이다.
// 앞 단계가 확인되지 않으면 뒤 단계를 시작하지 않고, commit 전 실패는 복원·fail_activation·이전 release
// 재준비로 닫는다(recovery.ts). 응답을 잃었을 수 있는 core 호출 뒤에는 ledger를 다시 읽어 이어받는다.
import type { Release } from "../../../../protocol/apps/mod.ts";
import {
  type ActivationOutcome,
  type ActivationPorts,
  type Attempt,
  attemptOf,
  changeData,
  needsMigration,
  protectData,
  schemaIsExpected,
  unavailable,
  unchangedResult,
} from "./steps.ts";
import { recoverActivation, rollback } from "./recovery.ts";

// 새 업무 통로를 열고(commit 뒤에만) 열지 못하면 같은 release를 다시 준비해 연다. 이때 옛 backup은
// 어떤 경우에도 쓰지 않는다: ledger가 이미 새 release를 채택했다(apps/data#R12).
async function openAfterCommit(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<ActivationOutcome> {
  const opened = await ports.supervisor.openCandidate(attempt);
  if (opened.ok) return { status: "active", opened: true };
  const started = await ports.supervisor.run(attempt.app, attempt.release);
  return { status: "active", opened: started.ok };
}

export async function runActivation(
  ports: ActivationPorts,
  release: Release,
): Promise<ActivationOutcome> {
  const attempt = attemptOf(release);
  if (attempt === undefined) return { status: "none" };

  // 1. 이전 자식의 종료를 확인한다. 확인 전에는 데이터 작업도 새 자식도 없다(apps/releases#R13).
  if (!await ports.supervisor.stopCurrent(attempt.app)) {
    return unavailable("termination_unconfirmed");
  }
  // 2. 종료한 앱 DB의 실제 schema가 시작 때의 값 그대로인지 확인한다(apps/releases#R12).
  if (!await schemaIsExpected(ports, attempt)) {
    return await rollback(
      ports,
      attempt,
      { code: "schema_changed", summary: "the app data schema changed" },
      null,
    );
  }

  // 3. 변경이 필요하면 보호 backup 참조를 ledger에 확정한 뒤에만 migration을 시작한다(apps/data#R4).
  let backupHash: string | null = null;
  let result;
  if (needsMigration(attempt)) {
    const protectedData = await protectData(ports, attempt);
    if (protectedData.stage === "not_made") {
      return await rollback(
        ports,
        attempt,
        { code: "backup_failed", summary: "the data backup was not made" },
        null,
      );
    }
    // 확정 응답을 잃었을 수 있다. ledger가 아는 것을 보고 이어받는다.
    if (protectedData.stage === "not_recorded") {
      return await recoverActivation(ports, attempt.release);
    }
    backupHash = protectedData.backup.backup_hash;
    const changed = await changeData(ports, attempt);
    if (!changed.ok) {
      return await rollback(
        ports,
        attempt,
        { code: "migration_failed", summary: "the data change failed" },
        backupHash,
      );
    }
    result = changed.value;
  } else {
    const same = await unchangedResult(ports, attempt);
    if (!same.ok) {
      return await rollback(
        ports,
        attempt,
        { code: "schema_changed", summary: "the app data was not inspected" },
        null,
      );
    }
    result = same.value;
  }

  // 4. 새 앱을 준비 모드로 시작해 hash·handler·schema·직접 연결을 확인한다. 업무 통로는 아직 닫혀 있다.
  const candidate = await ports.supervisor.startCandidate(attempt);
  if (!candidate.ok) {
    return await rollback(
      ports,
      attempt,
      { code: "start_failed", summary: "the new app did not become ready" },
      backupHash,
    );
  }

  // 5. 활성 참조 commit. core가 같은 시도·CAS·실제 결과·준비 확인을 다시 검사한다.
  const completed = await ports.core.completeActivation({
    release: attempt.release,
    started_seq: attempt.startedSeq,
    result,
    attestation: candidate.value.attestation,
  });
  if (completed.ok) return await openAfterCommit(ports, attempt);
  // 거절(근거가 맞지 않음)이든 응답 유실이든 ledger가 말하는 대로 이어받는다. 채택됐으면 복원하지 않고
  // 새 release를 다시 준비하며, 아직 진행 중이면 복원해서 닫는다.
  return await recoverActivation(ports, attempt.release, {
    code: "commit_rejected",
    summary: "the new release was not adopted",
  });
}
