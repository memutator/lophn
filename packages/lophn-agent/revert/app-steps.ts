import type { Result } from "../../base/mod.ts";
import type {
  AppRevertBinding,
  PreparedFile,
} from "../../contracts/lophn-agent/mod.ts";

// 앱 되돌림 단계를 실제로 부르는 쪽(machine runtime)의 순서 규칙이다(lophn-agent/revert R10·R11).
// Rewind가 applying으로 저장한 revert의 앱 단계를 원래 호출 역순으로 앱의 선언된 revert command에
// 직접 부르고, 단계마다 CheckpointRevert로 실제 결과를 남기고, 끝나면 FinishRevert를 부른다.
// 네트워크 호출은 ledger transaction 밖이고 한 transaction으로 묶지 않는다. 읽기·호출·기록은 모두
// port로 받는다. 구현은 agent-RW3c가 채운다.

// 호출 결과. restored는 앱이 되돌렸다고 답했고, failure는 앱이 하지 않았다고 답했거나(새 충돌
// 포함) 닿지 않았다. uncertain은 보냈으나 응답을 잃어 되돌렸는지 모른다(result query 말고 다시
// 보내지 않는다).
export type AppStepCall = "restored" | "failure" | "uncertain";

export type AppStepResult = {
  result: AppStepCall;
  invocation: string | null;
};

export type StoredStep = {
  binding: AppRevertBinding;
  // 이미 기록한 결과다. unchanged면 아직 부르지 않았다.
  result: "restored" | "failure" | "uncertain" | "unchanged";
};

export type StoredRevert = {
  outcome: string;
  // 저장한 앱 단계를 원래 호출 순서(ordinal)대로 둔다. 실행은 이 역순이다.
  steps: StoredStep[];
};

export type AppStepPorts = {
  stored(revert: string): Promise<Result<StoredRevert>>;
  // 저장한 invocation·receipt·expected_revision으로 revert command를 한 번 직접 부른다. 돌려주는
  // invocation은 그 호출이 남긴 실제 Invocation이다(앱에 닿지 않았거나 응답을 잃으면 null).
  call(binding: AppRevertBinding): Promise<AppStepResult>;
  checkpoint(input: {
    revert: string;
    step_key: string;
    invocation: string | null;
    result: AppStepCall;
  }): Promise<Result<unknown>>;
  // 앱 단계가 모두 복원됐을 때만 부른다. 문서 파일 복원 준비(관측·redo 복사)를 돌려준다.
  prepareFiles(revert: string): Promise<Result<PreparedFile[]>>;
  finish(input: {
    revert: string;
    step_keys: string[];
    files: PreparedFile[];
  }): Promise<Result<unknown>>;
};

export type AppStepsRun = {
  // 이번에 부른 단계(실행 순서)의 step_key다. 이미 기록한 단계는 부르지 않는다.
  called: string[];
  // 앞 단계가 복원되지 않아 멈춘 자리의 step_key다. 멈추지 않았으면 null이다.
  stopped_at: string | null;
};

// 규칙:
//   applying이 아닌 revert는 conflict, 저장한 근거가 이 revert의 것(step_key가 `${revert}:`로 시작)이
//   아니면 invalid_input이고 어떤 호출도 하지 않는다.
//   단계는 호출 순서의 역순으로 한 번씩 부른다. 기록된 단계(result≠unchanged)는 다시 부르지 않고,
//   restored가 아닌 기록이 있으면 그 자리에서 멈춘다.
//   부른 단계는 곧바로 checkpoint하고, restored가 아니면 뒤 단계를 더 부르지 않는다.
//   끝에 finish를 한 번 부른다. files는 모든 단계가 restored일 때만 prepareFiles의 결과이고 아니면 [].
export function runAppSteps(
  ports: AppStepPorts,
  revert: string,
): Promise<Result<AppStepsRun>> {
  void ports;
  void revert;
  throw new Error("not implemented: agent-RW3c");
}
