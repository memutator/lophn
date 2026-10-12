// activation 단계의 port와 한 단계씩의 일. 이 모듈은 supervisor·
// data worker·core command를 직접 부르지 않고 port로만 부른다. 조립(apps/app-supervisor)이 실제 구현을
// 끼우고 시험은 같은 port의 대역을 끼운다. port는 던지지 않고 Result를 낸다: 던지는 것은 부른 쪽 process가
// 끊긴 것이라 이 모듈이 삼키지 않는다(끊긴 시도는 `recoverActivation`이 ledger와 실제 관측으로 잇는다).
import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  DataChange,
  DataResult,
  ReadyAttestation,
  Release,
} from "../../../../protocol/apps/mod.ts";

// 한 activation 시도의 고정 입력이다. ReleaseActivationStarted가 확정한 값만 담는다.
export type Attempt = {
  app: string;
  release: string;
  startedSeq: string;
  previousRelease: string | null;
  expectedSchema: number;
  targetSchema: number;
  bundleHash: string;
  dataChanges: readonly DataChange[];
};

export function attemptOf(release: Release): Attempt | undefined {
  if (release.status !== "activating" || release.activation === null) {
    return undefined;
  }
  return {
    app: release.app,
    release: release.id,
    startedSeq: release.activation.started_seq,
    previousRelease: release.activation.previous_release,
    expectedSchema: release.activation.expected_schema,
    targetSchema: release.data_schema,
    bundleHash: release.bundle_hash,
    dataChanges: release.data_changes,
  };
}

export function needsMigration(attempt: Attempt): boolean {
  return attempt.targetSchema !== attempt.expectedSchema;
}

export type BackupOutcome = { result: DataResult; backup_hash: string };

export type Candidate = { attestation: ReadyAttestation; nonce: string };

export type ActivationFailure = { code: string; summary: string };

// 사람에게 알릴 문제다(problems/reporting). 복원 실패나 확인 불가처럼 앱을 사용할 수 없게 둔 이유다.
export type ActivationProblem = {
  app: string;
  release: string;
  started_seq: string;
  code: string;
  summary: string;
};

export interface ActivationPorts {
  supervisor: {
    // 새 호출·automation clock을 닫고 의도된 종료로 표시한 뒤 이전 자식의 OS 종료를 확인한다. true만 확인이다.
    // 자식이 없으면 곧바로 true다.
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
    // 실제 앱 DB의 schema와 무결성이다. 종료를 확인한 뒤의 값이다.
    inspect(
      app: string,
    ): Promise<Result<{ data_schema: number; integrity_ok: boolean }>>;
    backup(attempt: Attempt): Promise<Result<BackupOutcome>>;
    // 연속 경로를 순서대로 적용한다. 중간 단계 실패의 결과는 err이거나 목표가 아닌 schema의 결과다.
    migrate(attempt: Attempt, invocation: string): Promise<Result<DataResult>>;
    restore(attempt: Attempt, backupHash: string): Promise<Result<DataResult>>;
  };
  core: {
    release(id: string): Promise<Result<Release | null>>;
    recordBackup(input: {
      release: string;
      activation_seq: string;
      backup_hash: string;
      data_schema: number;
    }): Promise<Result<void>>;
    recordDataChange(result: DataResult): Promise<Result<void>>;
    recordDataRestore(
      result: DataResult,
      backupHash: string,
    ): Promise<Result<void>>;
    completeActivation(input: {
      release: string;
      started_seq: string;
      result: DataResult;
      attestation: ReadyAttestation;
    }): Promise<Result<void>>;
    failActivation(input: {
      release: string;
      started_seq: string;
      failure: ActivationFailure;
      invocation?: string | null;
    }): Promise<Result<void>>;
  };
  report(problem: ActivationProblem): Promise<void>;
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

// 종료를 확인한 앱 DB가 시작 때의 schema 그대로이고 온전한지 본다.
export async function schemaIsExpected(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<boolean> {
  const actual = await ports.data.inspect(attempt.app);
  return actual.ok && actual.value.integrity_ok &&
    actual.value.data_schema === attempt.expectedSchema;
}

// 변경 전 보호 backup을 만들고 그 참조를 ledger에 확정한다. 확정이 끝나야 migration을 시작한다
// (apps/data#R4). 확정 여부를 모르는 실패는 호출한 쪽이 ledger를 다시 읽어 판단한다.
export type Protected =
  | { stage: "done"; backup: BackupOutcome }
  // backup을 만들지 못했다. 데이터는 바뀌지 않았다.
  | { stage: "not_made" }
  // backup은 있으나 ledger에 확정됐는지 모른다. 응답을 잃었을 수 있다.
  | { stage: "not_recorded" };

export async function protectData(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<Protected> {
  const made = await ports.data.backup(attempt);
  if (
    !made.ok || !made.value.result.integrity_ok ||
    made.value.result.data_schema !== attempt.expectedSchema
  ) {
    return { stage: "not_made" };
  }
  const recorded = await ports.core.recordBackup({
    release: attempt.release,
    activation_seq: attempt.startedSeq,
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
  attempt: Attempt,
): Promise<Result<DataResult>> {
  const invocation = ports.newInvocation();
  const changed = await ports.data.migrate(attempt, invocation);
  if (
    !changed.ok || !changed.value.integrity_ok ||
    changed.value.data_schema !== attempt.targetSchema
  ) {
    return err({ code: "unavailable", message: "data change failed" });
  }
  const result: DataResult = { ...changed.value, invocation };
  const recorded = await ports.core.recordDataChange(result);
  if (!recorded.ok) {
    return err({ code: "unavailable", message: "data change not recorded" });
  }
  return ok(result);
}

// 변경이 없는 시도의 결과다. 실제 확인한 schema와 무결성을 그대로 낸다.
export async function unchangedResult(
  ports: ActivationPorts,
  attempt: Attempt,
): Promise<Result<DataResult>> {
  const actual = await ports.data.inspect(attempt.app);
  if (!actual.ok || !actual.value.integrity_ok) {
    return err({ code: "unavailable", message: "data was not inspected" });
  }
  return ok({
    release: attempt.release,
    activation_seq: attempt.startedSeq,
    invocation: null,
    data_schema: actual.value.data_schema,
    integrity_ok: true,
  });
}
