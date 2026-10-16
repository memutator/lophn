// activation 단계의 port와 한 단계씩의 일. 이 모듈은 supervisor·
// data worker·core command를 직접 부르지 않고 port로만 부른다. 조립(assembly.ts)이 실제 구현을
// 끼우고 시험은 같은 port의 대역을 끼운다. port는 던지지 않고 Result를 낸다: 던지는 것은 부른 쪽 process가
// 끊긴 것이라 이 모듈이 삼키지 않는다(끊긴 시도는 `recoverActivation`이 ledger와 실제 관측으로 잇는다).
import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  ActivationDataResult,
  ActivationFailure,
  ActivationStep,
  DataChange,
  ReadyAttestation,
  ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";

// 한 activation 시도의 고정 입력이다. `activation.start`가 확정한 값만 담는다.
export type Attempt = {
  app: string;
  release: string;
  attempt: string;
  previousRelease: string | null;
  targetSchema: number;
  bundleHash: string;
  dataChanges: readonly DataChange[];
};

// 종료를 확인한 뒤 읽은 실제 DB의 schema를 출발점으로 가진 시도다. migration과 복구본의 기준이다.
export type StartedAttempt = Attempt & { startSchema: number };

export function attemptOf(release: ReleaseRecord): Attempt | undefined {
  if (release.status !== "activating" || release.activation === null) {
    return undefined;
  }
  return {
    app: release.app,
    release: release.id,
    attempt: release.activation.attempt,
    previousRelease: release.activation.previous_release,
    targetSchema: release.data_schema,
    bundleHash: release.bundle_hash,
    dataChanges: release.data_changes,
  };
}

type BackupOutcome = {
  result: ActivationDataResult;
  backup_hash: string;
};

type Candidate = { attestation: ReadyAttestation; nonce: string };

// 실패의 code와 summary. `restored`는 fail을 낼 때 정한다.
export type FailureReason = Pick<ActivationFailure, "code" | "summary">;

// 새 호출 접수를 닫은 동안의 drain. 닫힌 동안 온 호출은 붙잡아 두었다가 열 때 그때의 활성 release로 넘긴다.
export interface ActivationIntake {
  close(app: string): void;
  whenIdle(app: string, graceMs: number): Promise<{ idle: boolean }>;
  // 끝나지 않은 호출을 결과 모름으로 닫는다(유예 뒤 강제 정지).
  abandon(app: string): Promise<void>;
  open(app: string): void;
}

export interface ActivationPorts {
  intake: ActivationIntake;
  supervisor: {
    // 이전 자식의 OS 종료를 확인한다. true만 확인이다. 자식이 없으면 곧바로 true다.
    stopCurrent(app: string): Promise<boolean>;
    // 준비 중인 후보 자식의 종료를 확인한다. 후보가 없으면 true다.
    stopCandidate(app: string): Promise<boolean>;
    // 후보를 준비 모드로 띄워 hash·handler·schema·직접 연결 검사까지만 한다. 업무 통로는 열지 않는다.
    startCandidate(attempt: Attempt): Promise<Result<Candidate>>;
    // 성공 commit 뒤에만 부른다. 후보의 업무 통로와 clock을 연다.
    openCandidate(attempt: Attempt): Promise<Result<void>>;
    // release를 준비해서 연다(이전 release 재준비, commit된 release 재시작). 종료 확인 뒤에만 부른다.
    run(app: string, release: string): Promise<Result<void>>;
  };
  data: {
    // 종료를 확인한 뒤 실제 앱 DB의 schema와 무결성이다.
    inspect(
      attempt: Attempt,
    ): Promise<Result<{ data_schema: number; integrity_ok: boolean }>>;
    backup(attempt: StartedAttempt): Promise<Result<BackupOutcome>>;
    // 연속 경로를 순서대로 적용한다. 중간 단계 실패의 결과는 err이거나 목표가 아닌 schema의 결과다.
    migrate(
      attempt: StartedAttempt,
      invocation: string,
    ): Promise<Result<ActivationDataResult>>;
    restore(
      attempt: Attempt,
      backupHash: string,
    ): Promise<Result<ActivationDataResult>>;
  };
  core: {
    release(id: string): Promise<Result<ReleaseRecord | null>>;
    recordBackup(input: {
      release: string;
      attempt: string;
      backup_hash: string;
      data_schema: number;
    }): Promise<Result<void>>;
    recordDataChange(result: ActivationDataResult): Promise<Result<void>>;
    recordDataRestore(
      result: ActivationDataResult,
      backupHash: string,
    ): Promise<Result<void>>;
    completeActivation(input: {
      release: string;
      attempt: string;
      result: ActivationDataResult;
      attestation: ReadyAttestation;
    }): Promise<Result<void>>;
    failActivation(input: {
      release: string;
      attempt: string;
      failure: ActivationFailure;
      invocation?: string | null;
    }): Promise<Result<void>>;
    // 되돌리기에 실패했거나 확인하지 못해 앱을 사용할 수 없는 상태로 둔다.
    markUnavailable(
      app: string,
      release: string,
      reason: { code: string; summary: string },
    ): Promise<void>;
  };
  // 끝난 뒤에 얹는 일.
  after: {
    // 이전 release의 changeset을 지운다.
    pruneChangesets(app: string, keepRelease: string): Promise<void>;
    // 열린 앱 view가 다시 그리게 남지 않는 event를 낸다.
    viewChanged(app: string): void;
  };
  // 지금 하는 단계를 알린다(`activations.queue`가 읽는다). migrate는 적용할 단계 수를 싣는다.
  progress(app: string, step: ActivationStep, migrationSteps?: number): void;
  newInvocation(): string;
}

export type ActivationOutcome =
  | { status: "active"; opened: boolean }
  | {
    status: "failed";
    code: string;
    // 이전 release를 다시 준비해 열었는지. 이전 release가 없으면 null이다.
    previous: "started" | "not_started" | null;
  }
  | { status: "unavailable"; code: string }
  | { status: "none" };

export function unavailable(code: string): ActivationOutcome {
  return { status: "unavailable", code };
}

// 앱 자식이 이전 것도 후보도 남아 있지 않다는 확인이다. 하나라도 확인하지 못하면 데이터 작업을 시작하지 않는다.
export async function quiesce(
  ports: ActivationPorts,
  app: string,
): Promise<boolean> {
  const current = await ports.supervisor.stopCurrent(app);
  if (!current) return false;
  return await ports.supervisor.stopCandidate(app);
}

// 변경 전 보호 backup을 만들고 그 참조를 ledger에 확정한다. 확정이 끝나야 migration을 시작한다.
// 확정 여부를 모르는 실패는 호출한 쪽이 ledger를 다시 읽어 판단한다.
type Protected =
  | { stage: "done"; backup: BackupOutcome }
  // backup을 만들지 못했다. 데이터는 바뀌지 않았다.
  | { stage: "not_made" }
  // backup은 있으나 ledger에 확정됐는지 모른다. 응답을 잃었을 수 있다.
  | { stage: "not_recorded" };

export async function protectData(
  ports: ActivationPorts,
  attempt: StartedAttempt,
): Promise<Protected> {
  const made = await ports.data.backup(attempt);
  if (
    !made.ok || !made.value.result.integrity_ok ||
    made.value.result.data_schema !== attempt.startSchema
  ) {
    return { stage: "not_made" };
  }
  const recorded = await ports.core.recordBackup({
    release: attempt.release,
    attempt: attempt.attempt,
    backup_hash: made.value.backup_hash,
    data_schema: made.value.result.data_schema,
  });
  return recorded.ok
    ? { stage: "done", backup: made.value }
    : { stage: "not_recorded" };
}

// migration을 적용하고 실제 결과를 ledger에 확정한다. 목표가 아닌 schema의 결과는 실패다.
export async function changeData(
  ports: ActivationPorts,
  attempt: StartedAttempt,
): Promise<Result<ActivationDataResult>> {
  const invocation = ports.newInvocation();
  const changed = await ports.data.migrate(attempt, invocation);
  if (
    !changed.ok || !changed.value.integrity_ok ||
    changed.value.data_schema !== attempt.targetSchema
  ) {
    return err({ code: "unavailable", message: "data change failed" });
  }
  const result: ActivationDataResult = {
    ...changed.value,
    invocation: invocation as ActivationDataResult["invocation"],
  };
  const recorded = await ports.core.recordDataChange(result);
  if (!recorded.ok) {
    return err({ code: "unavailable", message: "data change not recorded" });
  }
  return ok(result);
}

// 변경이 없는 시도의 결과다. 실제 확인한 schema와 무결성을 그대로 낸다.
export function unchangedResult(
  attempt: StartedAttempt,
): ActivationDataResult {
  return {
    release: attempt.release as ActivationDataResult["release"],
    attempt: attempt.attempt as ActivationDataResult["attempt"],
    invocation: null,
    data_schema: attempt.startSchema,
    integrity_ok: true,
  };
}
