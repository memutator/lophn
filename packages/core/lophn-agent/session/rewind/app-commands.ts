import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type AppRevertBinding,
  checkpointRevert,
  finishRevert,
  type PreviewItem,
  revertApplied,
  revertFinished,
  type RevertItem,
  revertStarted,
  type rewind,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  type Output,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../../../protocol/platform/mod.ts";
import type { RevertDeps } from "./commands.ts";
import { planRewind, type RewindPlan } from "./preview.ts";
import { restorable } from "./restore.ts";
import {
  countsOf,
  insertItems,
  leftSomething,
  markReverted,
  observedOf,
} from "./settle.ts";

// 앱 단계가 있는 Rewind의 접수(applying)와 그 단계 기록(CheckpointRevert), 끝내기(FinishRevert)다
// (lophn-agent/revert 앱 복원 실행 경계, R10·R11). 앱 호출은 transaction 밖에서 core의 runtime이 하고
// 여기는 그 결과를 기록만 한다. 규칙:
//   접수: 사전 검사를 통과한 plan의 모든 항목을 쓴다. 복원할 항목(앱·파일)은 아직 하지 않아 unchanged이고
//     이유가 없다. 건너뜀·남는 영향은 그 결과로 굳는다. 대화 효과(숨김)는 끝낼 때 한다.
//   CheckpointRevert(machine): 앞 단계가 모두 복원돼야 다음 단계를 기록한다. 같은 단계의 같은 결과는
//     다시 기록하지 않고(recorded=false), 다른 결과는 conflict다. 결과는 한 번만 설정된다.
//   FinishRevert(machine): 모든 단계가 기록됐거나 앞 단계의 실패·불명으로 나머지가 시작되지 않았을 때만
//     끝낸다. 모든 앱 단계가 복원됐으면 문서 파일을 판정해 복원하고 applied, 아니면 문서 파일은
//     unchanged(app_not_settled)로 두고 partial(실패) 또는 uncertain(불명)이다.

type Header = Output<typeof rewind>;
type StepResult = Input<typeof checkpointRevert>["result"];

function reject(
  code: "forbidden" | "conflict" | "unavailable",
  message: string,
): Result<never> {
  return err({ code, message });
}

function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine"
    ? ok(undefined)
    : reject("forbidden", "only the runtime records an app revert step");
}

export function hasAppSteps(plan: RewindPlan): boolean {
  return plan.preview.restore.some((item) => item.class === "app");
}

// 접수 때 굳는 결과. 복원할 항목은 아직 하지 않았다.
function initialResult(item: PreviewItem): RevertItem["result"] {
  if (item.plan === "restore") return "unchanged";
  if (item.plan === "remain") return "remained";
  return item.reason === "already_reverted" ? "unchanged" : "skipped";
}

// 사전 검사를 통과한 Rewind를 applying으로 접수한다. 단계의 step_key는 이 revert의 ID로 정해진 plan에서
// 온다.
export function startApplying(
  tx: Tx,
  input: {
    id: string;
    session: string;
    checkpoint: string;
    choice: "restore_all";
    preview_hash: string;
    boundary_seq: string;
  },
  plan: RewindPlan,
): Header {
  tx.sql.run(
    `insert into reverts
       (id, session, kind, choice, checkpoint, tool_call, boundary_seq, summary_call,
        outcome, redo, preview_hash, result_seq)
     values (?, ?, 'rewind', ?, ?, null, ?, null, 'applying', 'none', ?, null)`,
    [
      input.id,
      input.session,
      input.choice,
      input.checkpoint,
      Number(input.boundary_seq),
      input.preview_hash,
    ],
  );
  const items = [
    ...plan.preview.restore,
    ...plan.preview.skip,
    ...plan.preview.remain,
  ].sort((left, right) => left.ordinal - right.ordinal);
  insertItems(
    tx,
    input.id,
    items.map((item) => ({
      item,
      result: initialResult(item),
      restored_sha256: null,
      redo_ref: null,
      restored: null,
    })),
  );
  tx.emit(revertStarted, input.id, {
    session: input.session,
    kind: "rewind",
    choice: input.choice,
    preview_hash: input.preview_hash,
    steps: plan.preview.restore.filter((item) => item.class === "app").map((
      item,
    ) => item.app_revert!.step_key),
  });
  return {
    id: input.id,
    session: input.session,
    kind: "rewind",
    outcome: "applying",
    redo: "none",
    result_seq: null,
    replayed: false,
  };
}

type Applying = {
  id: string;
  session: string;
  checkpoint: string;
  boundary_seq: string;
};

function loadApplying(tx: Tx, id: string): Result<Applying> {
  const row = tx.sql.get(
    `select session, checkpoint, cast(boundary_seq as text) as boundary_seq, outcome
       from reverts where id = ?`,
    [id],
  );
  if (row === undefined) return reject("conflict", "revert not found");
  if (row["outcome"] !== "applying") {
    return reject("conflict", "the revert is not applying");
  }
  return ok({
    id,
    session: String(row["session"]),
    checkpoint: String(row["checkpoint"]),
    boundary_seq: String(row["boundary_seq"]),
  });
}

type StepRow = {
  ordinal: number;
  result: RevertItem["result"];
  binding: AppRevertBinding;
};

// 복원할 앱 단계를 실행 순서(ordinal)대로 읽는다.
function loadSteps(tx: Tx, revert: string): StepRow[] {
  return tx.sql.all(
    `select ordinal, result, app_revert from revert_items
      where revert = ? and class = 'app' and plan = 'restore' order by ordinal`,
    [revert],
  ).map((row) => ({
    ordinal: Number(row["ordinal"]),
    result: String(row["result"]) as RevertItem["result"],
    binding: JSON.parse(String(row["app_revert"])) as AppRevertBinding,
  }));
}

const STEP_REASON: Partial<Record<StepResult, RevertItem["reason"]>> = {
  failure: "app_failed",
  uncertain: "app_uncertain",
};

function handleCheckpoint(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof checkpointRevert>,
): Result<Output<typeof checkpointRevert>> {
  const trusted = requireMachine(ctx);
  if (!trusted.ok) return trusted;
  const applying = loadApplying(tx, input.revert);
  if (!applying.ok) return applying;
  const steps = loadSteps(tx, input.revert);
  const index = steps.findIndex((step) =>
    step.binding.step_key === input.step_key
  );
  if (index < 0) return reject("conflict", "unknown app revert step");
  if (input.result === "unchanged") {
    return reject("conflict", "a step is recorded by what it did");
  }
  const step = steps[index]!;
  const done = { revert: input.revert, step_key: input.step_key };
  if (step.result !== "unchanged") {
    return step.result === input.result
      ? ok({ ...done, recorded: false })
      : reject("conflict", "the step was already recorded differently");
  }
  // 앞 단계가 복원돼야 다음 단계를 부른다(원래 호출 역순, 같은 앱의 앞 단계는 뒤 단계 다음).
  if (steps.slice(0, index).some((before) => before.result !== "restored")) {
    return reject("conflict", "an earlier app step is not restored");
  }
  const binding: AppRevertBinding = {
    ...step.binding,
    revert_invocation: input.invocation,
  };
  tx.sql.run(
    `update revert_items set result = ?, reason = ?, app_revert = ?
      where revert = ? and ordinal = ?`,
    [
      input.result,
      STEP_REASON[input.result] ?? null,
      JSON.stringify(binding),
      input.revert,
      step.ordinal,
    ],
  );
  return ok({ ...done, recorded: true });
}

type FileRow = { ordinal: number; target: string };

function handleFinish(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof finishRevert>,
  deps: Pick<RevertDeps, "observe" | "rootOf" | "appRevision" | "effects">,
): Result<Header> {
  const trusted = requireMachine(ctx);
  if (!trusted.ok) return trusted;
  const applying = loadApplying(tx, input.revert);
  if (!applying.ok) return applying;
  const steps = loadSteps(tx, input.revert);
  const known = new Set(steps.map((step) => step.binding.step_key));
  if (
    input.step_keys.length !== known.size ||
    !input.step_keys.every((key) => known.has(key))
  ) return reject("conflict", "the steps do not match the stored plan");
  // 모든 단계가 기록됐거나, 복원되지 않은 단계 뒤에서만 기록이 비어 있다.
  let stopped = false;
  for (const step of steps) {
    if (step.result === "unchanged") {
      if (!stopped) return reject("conflict", "an app step is not recorded");
    } else if (step.result !== "restored") stopped = true;
  }
  const allRestored = !stopped;
  const effects = deps.effects;
  if (effects === undefined) {
    return reject("unavailable", "rewind is not available yet");
  }
  const cancelled = effects.cancelWaiting(tx, {
    session: applying.value.session,
    from_seq: applying.value.boundary_seq,
  });
  if (!cancelled.ok) return cancelled;
  const reset = effects.resetReadState(tx, {
    session: applying.value.session,
    before_seq: applying.value.boundary_seq,
  });
  if (!reset.ok) return reset;

  // 시작하지 않은 앱 단계는 이유를 달아 굳힌다.
  for (const step of steps) {
    if (step.result !== "unchanged") continue;
    tx.sql.run(
      `update revert_items set reason = 'app_not_started'
        where revert = ? and ordinal = ?`,
      [input.revert, step.ordinal],
    );
  }
  const files: FileRow[] = tx.sql.all(
    `select ordinal, target from revert_items
      where revert = ? and class = 'file' and plan = 'restore' and result = 'unchanged'
      order by ordinal`,
    [input.revert],
  ).map((row) => ({
    ordinal: Number(row["ordinal"]),
    target: String(row["target"]),
  }));
  if (!allRestored) {
    for (const file of files) {
      tx.sql.run(
        `update revert_items set reason = 'app_not_settled'
          where revert = ? and ordinal = ?`,
        [input.revert, file.ordinal],
      );
    }
  } else if (files.length > 0) {
    const planned = planRewind(
      tx,
      deps,
      {
        kind: "rewind",
        session: applying.value.session,
        checkpoint: applying.value.checkpoint,
        choice: "restore_all",
      },
      { observed: observedOf(input.files), revert: input.revert },
    );
    if (!planned.ok) return planned;
    const units = new Map(
      planned.value.judged.map((unit) => [unit.path, unit]),
    );
    const prepared = new Map(input.files.map((file) => [file.path, file]));
    for (const file of files) {
      const unit = units.get(file.target);
      if (unit !== undefined && restorable(unit, prepared)) {
        tx.sql.run(
          `update revert_items set result = 'restored', restored_sha256 = ?
            where revert = ? and ordinal = ?`,
          [unit.restored_sha256, input.revert, file.ordinal],
        );
        markReverted(tx, input.revert, unit);
      } else {
        // 준비가 받쳐 주지 않으면 복원했다고 쓰지 않는다(설치가 건너뛴 것과 같은 모양).
        tx.sql.run(
          `update revert_items set result = 'skipped', reason = 'edited_outside'
            where revert = ? and ordinal = ?`,
          [input.revert, file.ordinal],
        );
      }
    }
  }
  const results = countsOf(
    tx.sql.all("select result from revert_items where revert = ?", [
      input.revert,
    ]).map((row) => String(row["result"]) as RevertItem["result"]),
  );
  const outcome = allRestored
    ? "applied"
    : steps.some((step) => step.result === "uncertain")
    ? "uncertain"
    : "partial";
  const session = applying.value.session;
  const seq = outcome === "applied"
    ? tx.emit(revertApplied, input.revert, {
      session,
      kind: "rewind",
      choice: "restore_all",
      partial: leftSomething(results),
      results,
      boundary_seq: applying.value.boundary_seq,
      redo: "none",
    })
    : tx.emit(revertFinished, input.revert, { session, outcome, results });
  tx.sql.run(
    "update reverts set outcome = ?, result_seq = ? where id = ?",
    [outcome, Number(seq), input.revert],
  );
  return ok({
    id: input.revert,
    session,
    kind: "rewind",
    outcome,
    redo: "none",
    result_seq: seq,
    replayed: false,
  });
}

export function createAppStepCommands(
  deps: Pick<RevertDeps, "observe" | "rootOf" | "appRevision" | "effects">,
): {
  checkpoint: CommandDefinition<typeof checkpointRevert>;
  finish: CommandDefinition<typeof finishRevert>;
} {
  return {
    checkpoint: {
      route: checkpointRevert,
      handle: (tx, ctx, input) => handleCheckpoint(tx, ctx, input),
    },
    finish: {
      route: finishRevert,
      handle: (tx, ctx, input) => handleFinish(tx, ctx, input, deps),
    },
  };
}
