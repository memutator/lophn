import { err, ok, type Result } from "../../base/mod.ts";
import {
  type AppRevertBinding,
  appRevertBindingSchema,
} from "../../contracts/lophn-agent/mod.ts";

// 앱 되돌림 단계를 실제로 부르는 쪽(machine runtime)의 순서 규칙이다(lophn-agent#T48, R10·R11).
// RevertRun이 applying으로 저장한 revert의 앱 단계를 원래 호출 역순으로 앱의 선언된 revert
// command에 직접 부르고(direct call), 단계마다 CheckpointRevert로 실제 결과를 남기고, 끝나면
// FinishRevert를 부른다. 네트워크 호출은 ledger transaction 밖이고 한 transaction으로 묶지 않는다.
// 읽기·호출·기록은 모두 port로 받는다(앱 통로와 core 호출은 이 leaf가 모른다).

// 호출 결과. restored는 앱이 되돌렸다고 답했고, conflict·failure는 앱이 하지 않았다고 답했거나 닿지
// 않았다. uncertain은 보냈으나 응답을 잃어 되돌렸는지 모른다(result query 말고 다시 보내지 않는다).
export type AppStepCall = "restored" | "failure" | "conflict" | "uncertain";

export type StoredStep = {
  binding: AppRevertBinding;
  // 이미 기록한 결과다. unchanged면 아직 부르지 않았다.
  result: string;
};

export type StoredRevert = {
  outcome: string;
  // 저장한 앱 단계를 원래 호출 순서(ordinal)대로 둔다.
  steps: StoredStep[];
};

export type AppStepPorts = {
  // 저장한 revert를 읽는다.
  stored(revert: string): Promise<Result<StoredRevert>>;
  // 저장한 invocation·receipt·expected_revision으로 revert command를 한 번 직접 부른다.
  call(binding: AppRevertBinding): Promise<AppStepCall>;
  checkpoint(input: {
    revert: string;
    step_key: string;
    invocation: string;
    result: AppStepCall;
  }): Promise<Result<unknown>>;
  finish(input: { revert: string; step_keys: string[] }): Promise<
    Result<unknown>
  >;
};

export type AppStepsRun = {
  // 이번에 부른 단계(역순)다. 이미 기록한 단계는 부르지 않는다.
  called: string[];
  // 앞 단계가 복원되지 않아 멈춘 자리의 step_key다. 멈추지 않았으면 null이다.
  stopped_at: string | null;
};

export async function runAppSteps(
  ports: AppStepPorts,
  revert: string,
): Promise<Result<AppStepsRun>> {
  const read = await ports.stored(revert);
  if (!read.ok) return read;
  // applying이 아니면(시작 전에 막혔거나 이미 끝났다) 어떤 단계도 부르지 않는다.
  if (read.value.outcome !== "applying") {
    return err({ code: "conflict", message: "the revert is not applying" });
  }
  const steps = read.value.steps;
  // 저장한 근거가 이 revert의 것이고 모양이 맞는지 본다. 어긋나면 어떤 호출도 하지 않는다.
  for (const step of steps) {
    const checked = appRevertBindingSchema.safeParse(step.binding);
    if (!checked.success || !step.binding.step_key.startsWith(`${revert}:`)) {
      return err({
        code: "invalid_input",
        message: "a stored step is not a step of this revert",
      });
    }
  }
  const run: AppStepsRun = { called: [], stopped_at: null };
  for (const step of [...steps].reverse()) {
    const key = step.binding.step_key;
    // step_key로 이미 기록한 단계는 다시 부르지 않는다(R8). 기록이 복원이 아니면 멈춘 자리다.
    if (step.result !== "unchanged") {
      if (step.result !== "restored") run.stopped_at = key;
      continue;
    }
    if (run.stopped_at !== null) continue;
    const called = await ports.call(step.binding);
    run.called.push(key);
    const noted = await ports.checkpoint({
      revert,
      step_key: key,
      invocation: step.binding.invocation,
      result: called,
    });
    if (!noted.ok) return noted;
    if (called !== "restored") run.stopped_at = key;
  }
  const done = await ports.finish({
    revert,
    step_keys: steps.map((step) => step.binding.step_key),
  });
  if (!done.ok) return done;
  return ok(run);
}
