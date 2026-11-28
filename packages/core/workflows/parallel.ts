import { err, ok, type Result } from "../../base/mod.ts";
import type {
  ActiveStep,
  InstanceStep,
  NewStep,
  StepJoinMode,
  WorkflowInstance,
  WorkflowLine,
} from "../../protocol/workflows/mod.ts";

// instance의 현재 활성 step 목록. 옛 행(active_steps 미저장)은 current에서 유도한다.
export function activeStepsOf(
  instance: Pick<WorkflowInstance, "current" | "active_steps">,
): ActiveStep[] {
  const raw =
    instance.active_steps !== undefined
      ? instance.active_steps
      : instance.current === null
        ? []
        : [instance.current];
  const seen = new Set<string>();
  const out: ActiveStep[] = [];
  for (const item of raw) {
    if (seen.has(item.step)) continue;
    seen.add(item.step);
    out.push({ step: item.step, human_turn: item.human_turn });
  }
  return out;
}

export function reportTargetsOf(line: {
  readonly next: string | null;
  readonly next_steps?: readonly string[];
}): string[] {
  if (line.next_steps !== undefined && line.next_steps.length > 0) {
    return [...line.next_steps];
  }
  return line.next !== null ? [line.next] : [];
}

export function normalizeNewStep(
  step: NewStep,
  fallbackNext: string[],
): InstanceStep {
  return {
    name: step.name,
    by: step.by,
    with: step.with ?? null,
    prompt: step.prompt,
    in: step.in ?? "",
    out: step.out ?? "",
    next:
      step.next !== undefined && step.next.length > 0
        ? [...step.next]
        : fallbackNext,
    ...(step.parallel !== undefined ? { parallel: step.parallel } : {}),
    ...(step.needs !== undefined ? { needs: [...step.needs] } : {}),
    ...(step.join !== undefined ? { join: step.join } : {}),
    ...(step.open !== undefined ? { open: step.open } : {}),
    ...(step.worktree !== undefined ? { worktree: step.worktree } : {}),
  };
}

// 단일 또는 병렬 동적 step 묶음을 기존 steps 안에 끼워 넣고(then·join 연결 포함) 새 steps 배열을 돌려준다.
export function insertStepsInto(
  existingSteps: readonly InstanceStep[],
  input: {
    readonly steps: readonly NewStep[];
    readonly after?: string;
    readonly sourceStep?: string;
    readonly thenStep?: string;
    readonly join?: StepJoinMode;
  },
): Result<{ steps: InstanceStep[]; inserted: string[] }> {
  const next = existingSteps.map((s) => ({
    ...s,
    next: [...s.next],
    ...(s.needs !== undefined ? { needs: [...s.needs] } : {}),
  }));
  const existingNames = new Set(next.map((s) => s.name));
  const insertedNames: string[] = [];
  for (const step of input.steps) {
    if (existingNames.has(step.name) || insertedNames.includes(step.name)) {
      return err({
        code: "conflict",
        message: `step '${step.name}' already exists`,
      });
    }
    insertedNames.push(step.name);
  }

  let insertAt = next.length;
  const anchor = input.after ?? input.sourceStep;
  if (anchor !== undefined) {
    const anchorIdx = next.findIndex((s) => s.name === anchor);
    if (anchorIdx < 0) {
      if (input.after !== undefined) {
        return err({
          code: "not_found",
          message: `step '${input.after}' not found`,
        });
      }
    } else {
      insertAt = anchorIdx + 1;
    }
  }

  const sourceDef =
    input.sourceStep !== undefined
      ? next.find((s) => s.name === input.sourceStep)
      : undefined;
  const fallbackNext =
    input.thenStep !== undefined
      ? [input.thenStep]
      : sourceDef !== undefined && sourceDef.next.length > 0
        ? [...sourceDef.next]
        : [];

  const created = input.steps.map((s) => normalizeNewStep(s, fallbackNext));
  next.splice(insertAt, 0, ...created);

  // 끼워 넣은 step들이 합류하는 then_step 대상 step의 needs·join을 이번 물결에 맞춘다.
  const joinTarget =
    input.thenStep !== undefined && input.thenStep !== "end"
      ? input.thenStep
      : fallbackNext.length === 1 && fallbackNext[0] !== "end"
        ? fallbackNext[0]
        : undefined;
  if (joinTarget !== undefined) {
    const targetIdx = next.findIndex((s) => s.name === joinTarget);
    if (targetIdx >= 0) {
      const target = { ...next[targetIdx]! };
      if (insertedNames.length > 1) {
        target.needs = [...insertedNames];
        target.join = input.join ?? target.join ?? "all";
      } else {
        // 이전 라운드의 병렬 needs가 남아 단일 동적 step 합류를 막지 않도록 정리한다.
        delete target.needs;
        if (input.join !== undefined) target.join = input.join;
        else delete target.join;
      }
      next[targetIdx] = target;
    }
  }

  return ok({ steps: next, inserted: insertedNames });
}

export type ParallelTransitionResult = {
  readonly handoffs: Array<{
    readonly step: string;
    readonly received: string;
  }>;
  readonly cancelSteps: string[];
  readonly shouldEnd: boolean;
};

function formatCombinedReports(
  entries: ReadonlyArray<{ readonly step: string; readonly text: string }>,
): string {
  if (entries.length === 1) return entries[0]!.text;
  return entries.map((e) => `### ${e.step}\n${e.text}`).join("\n\n");
}

// report 완료(또는 활성 step 제거) 시 병렬 fan-out 및 join(all | any) 규칙을 평가한다.
export function evaluateParallelTransition(input: {
  readonly instance: Pick<
    WorkflowInstance,
    "steps" | "current" | "active_steps"
  >;
  readonly lines: readonly WorkflowLine[];
  readonly completedStep: string;
  readonly completedText: string | null;
  readonly targets: readonly string[];
}): ParallelTransitionResult {
  const { instance, lines, completedStep, completedText, targets } = input;
  const activeBefore = activeStepsOf(instance);
  const wasActive = activeBefore.some((a) => a.step === completedStep);
  const remainingActive = activeBefore.filter((a) => a.step !== completedStep);
  const remainingSet = new Set(remainingActive.map((a) => a.step));
  const stepMap = new Map(instance.steps.map((s) => [s.name, s]));

  if (targets.length === 0) {
    return { handoffs: [], cancelSteps: [], shouldEnd: false };
  }
  if (targets.length === 1 && targets[0] === "end") {
    return {
      handoffs: [],
      cancelSteps: [],
      shouldEnd: remainingActive.length === 0,
    };
  }

  const handoffs: Array<{ step: string; received: string }> = [];
  const cancelSet = new Set<string>();
  const lastCompletedHandedIdx = lines.findLastIndex(
    (l) => l.kind === "handed" && l.step === completedStep,
  );

  for (const target of targets) {
    if (target === "end") continue;
    const targetDef = stepMap.get(target);
    const lastTargetHandedIdx = lines.findLastIndex(
      (l) => l.kind === "handed" && l.step === target,
    );

    // join: any로 이미 취소·합류된 형제 step이 늦게 report를 내도 대상 step을 다시 넘기지 않는다.
    if (
      !wasActive &&
      completedText !== null &&
      lastCompletedHandedIdx >= 0 &&
      lastTargetHandedIdx > lastCompletedHandedIdx
    ) {
      continue;
    }

    // 이번 물결(대상 step의 마지막 handed 이후)에 target으로 report를 낸 선행 step들을 모은다.
    const reportedMap = new Map<string, string>();
    const afterTarget =
      lastTargetHandedIdx >= 0 ? lines.slice(lastTargetHandedIdx + 1) : lines;
    for (const line of afterTarget) {
      if (line.kind !== "report") continue;
      if (reportTargetsOf(line).includes(target)) {
        reportedMap.set(line.step, line.text);
      }
    }
    if (completedText !== null) {
      reportedMap.set(completedStep, completedText);
    }

    // 합류 대상이 기다려야 하는 선행 step 집합을 구한다.
    let required: string[];
    if (targetDef?.needs !== undefined && targetDef.needs.length > 0) {
      const existingNeeds = targetDef.needs.filter((name) => stepMap.has(name));
      required =
        existingNeeds.length > 0
          ? existingNeeds
          : completedText !== null
            ? [completedStep]
            : [];
    } else {
      const siblingActive = remainingActive
        .map((a) => a.step)
        .filter((name) => stepMap.get(name)?.next.includes(target));
      const reportedSiblings = [...reportedMap.keys()].filter(
        (name) => name !== completedStep && stepMap.has(name),
      );
      if (siblingActive.length > 0 || reportedSiblings.length > 0) {
        const set = new Set<string>();
        if (completedText !== null) set.add(completedStep);
        for (const s of reportedSiblings) set.add(s);
        for (const s of siblingActive) set.add(s);
        required = [...set];
      } else {
        required = completedText !== null ? [completedStep] : [];
      }
    }

    if (required.length === 0) continue;

    const joinMode: StepJoinMode = targetDef?.join ?? "all";
    if (joinMode === "any") {
      if (completedText === null) {
        // step 제거로만 들어온 경우: 이미 완료된 report가 있으면 합류한다.
        const firstReady = required.find(
          (name) => reportedMap.has(name) && !remainingSet.has(name),
        );
        if (firstReady === undefined) continue;
        handoffs.push({ step: target, received: reportedMap.get(firstReady)! });
      } else {
        handoffs.push({ step: target, received: completedText });
      }
      for (const name of required) {
        if (remainingSet.has(name)) cancelSet.add(name);
      }
      continue;
    }

    // join: all — 필요한 모든 선행 step이 완료 report를 냈고 아직 실행 중이 아니어야 합류한다.
    const allReady = required.every(
      (name) => reportedMap.has(name) && !remainingSet.has(name),
    );
    if (!allReady) continue;
    const entries = required.map((name) => ({
      step: name,
      text: reportedMap.get(name)!,
    }));
    handoffs.push({
      step: target,
      received: formatCombinedReports(entries),
    });
  }

  return {
    handoffs,
    cancelSteps: [...cancelSet],
    shouldEnd: false,
  };
}
