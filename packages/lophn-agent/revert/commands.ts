import { err, ok, type Result } from "../../base/mod.ts";
import {
  amendRevertInstall,
  type checkpointRevert,
  type finishRevert,
  type recordRewindFile,
  redo,
  revertAmended,
  revertApplied,
  revertBlocked,
  type RevertItem,
  revertRedone,
  rewind,
  undoEdit,
} from "../../protocol/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  type Output,
  parseActor,
  type RequestContext,
  type Sql,
  type Tx,
} from "../../protocol/platform/mod.ts";
import {
  createAppStepCommands,
  hasAppSteps,
  startApplying,
} from "./app-commands.ts";
import type { FileStat } from "./judge.ts";
import {
  type PlanDeps,
  planRewind,
  type PreviewFact,
  type RewindPlan,
  type RewindTarget,
} from "./preview.ts";
import { assertCheckpointVisible, hiddenRanges } from "./hidden.ts";
import { createRecordRewindFile } from "./record.ts";
import {
  countsOf,
  insertItems,
  leftSomething,
  markReverted,
  observedOf,
  releaseReverted,
  type SettledItem,
  settleItems,
} from "./settle.ts";

// 되돌리기 command들(lophn-agent/revert). Rewind·UndoEdit·Redo·AmendRevertInstall은 문서 파일까지 여기서
// 확정한다. 앱 단계가 있는 Rewind와 CheckpointRevert·FinishRevert는 app-commands.ts다. 이미 숨긴
// 구간의 checkpoint는 invalid_input이고(hidden.ts) summarize는 숨긴 메시지를 품은 구간을 접지 않는다.
// RecordRewindFile은 record.ts다.
//
// 규칙(시험 rewind_test·rewind_effects_test가 정한다). Rewind·UndoEdit·Redo는 사람만 부른다(그 밖은
// forbidden). 같은 id를 다시 보내면 저장된 결과를 replayed=true로 돌려주고 아무것도 다시 하지 않는다. 파일
// 복원은 command 안에서 하지 않는다: core가 observeFiles → planRewind → prepareRestore → command →
// installRestore 순서로 잇고, command는 input.files의 관측으로 다시 판정해 같은 transaction에서 기록만
// 확정한다. 준비가 받쳐 주지 않는 복원은 restored로 쓰지 않는다.
//
// Rewind: 앱 복원 단계가 있으면 applying으로 접수만 하고(app-commands.ts) 앱 호출 뒤 FinishRevert가 끝낸다.
//   없는 session은 not_found, 닫혔으면 forbidden, 끝나지 않은 run이나 applying revert가 있으면
//   conflict. choice=summarize인데 effects.summaryOk가 아니면 invalid_input이고 아무것도 바뀌지 않는다.
//   preview_hash가 다르거나 건너뜀·남는 영향이 있는데 accept_remaining이 아니면 blocked(항목 없음)로 기록한다.
//   아니면 restore_all·messages_only는 effects.cancelWaiting과 resetReadState를 부르고(실패하면 command 전체가
//   되돌려진다) applied로 확정한다. restore_all은 복원한 항목의 기록에 reverted_by를 표시한다.
// UndoEdit: preview_hash가 다르거나 복원 대상이 없으면 blocked. 아니면 reverted_by를 표시하고 사실 메시지
//   ("Undid edit to <경로>")를 같은 transaction에서 남긴다. redo는 없다.
// Redo: redo=available이고 사람이 본 결과 event일 때만. 복원했던 파일 중 지금 hash가 복원한 내용과 같은 것만
//   기록의 reverted_by를 풀어 다시 rewind할 수 있게 한다.
// AmendRevertInstall(machine): 설치가 hash 불일치로 건너뛴 문서 파일 항목을 skipped(edited_outside)로 한 번
//   고치고 그 기록의 reverted_by를 풀며 redo 근거에서 뺀다.
// CheckpointRevert·FinishRevert(machine)는 app-commands.ts다.

// 대화 쪽 효과를 core 조립이 주입하는 port다. 시험은 가짜로 대신한다.
export type RewindEffects = {
  // 같은 session의 완전 성공한 요약 model call인가(choice=summarize의 근거).
  summaryOk(
    lookup: { sql: Pick<Sql, "get" | "all"> },
    input: { session: string; call: string },
  ): boolean;
  // 숨김 시작 이후에 기다리던 질문 묶음·approval request를 취소한다.
  cancelWaiting(
    tx: Tx,
    input: { session: string; from_seq: string },
  ): Result<{ questions: number; approvals: number }>;
  // harness가 읽은 문서의 상태(읽은 hash 등)를 숨김 시작 이전 기준으로 다시 잡는다.
  resetReadState(
    tx: Tx,
    input: { session: string; before_seq: string },
  ): Result<void>;
};

export type RevertDeps = {
  // 경로마다 지금 파일 상태를 동기로 읽는다(preview 읽기가 쓴다). command는 읽지 않고 준비한 관측으로
  // 판정하므로 command만 올리는 쪽은 주지 않는다. 없으면 preview 읽기는 unavailable이다.
  observe?(root: string, paths: readonly string[]): Map<string, FileStat>;
  // session 자리의 project 폴더(절대 경로).
  rootOf(lookup: { sql: Pick<Sql, "get" | "all"> }, session: string): string;
  // 앱의 지금 revision. 앱이 없거나 알 수 없으면 null이다(apps 소유 CAS의 읽기 통로).
  appRevision(
    app: string,
    lookup: { sql: Pick<Sql, "get" | "all"> },
  ): string | null;
  // 되돌려지지 않는 질문 답·승인 결정(answered_fact)을 숨김 시작 이후에서 모은다. 질문과 approval의 표는
  // 다른 concern의 것이라 core 조립이 읽어 준다. 없으면 이 사실을 알리지 않는다.
  answeredFacts?(
    lookup: { sql: Pick<Sql, "get" | "all"> },
    input: { session: string; from_seq: string },
  ): PreviewFact[];
  // 숨김 구간의 대화 효과. 없으면 Rewind는 unavailable이다(숨기지 못하는 rewind를 적용됐다고 하지 않는다).
  effects?: RewindEffects;
  // Undo가 session에 사실 메시지를 남긴다("Undid edit to <경로>", machine 메시지). principal은 본문
  // blob을 준비한 사람의 자격이다.
  recordFact(
    tx: Tx,
    input: { session: string; text: string; principal: string },
  ): Result<string>;
};

type Header = Output<typeof rewind>;
type RevertRow = {
  id: string;
  session: string;
  kind: "rewind" | "undo";
  choice: string | null;
  checkpoint: string | null;
  tool_call: string | null;
  boundary_seq: string | null;
  outcome: Header["outcome"];
  redo: Header["redo"];
  result_seq: string | null;
};

function reject(
  code:
    | "invalid_input"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "unavailable",
  message: string,
): Result<never> {
  return err({ code, message });
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user"
    ? ok(undefined)
    : reject("forbidden", "only a person rewinds or undoes");
}

function loadRevert(tx: Tx, id: string): RevertRow | undefined {
  const row = tx.sql.get(
    `select id, session, kind, choice, checkpoint, tool_call,
            cast(boundary_seq as text) as boundary_seq, outcome, redo,
            cast(result_seq as text) as result_seq
       from reverts where id = ?`,
    [id],
  );
  if (row === undefined) return undefined;
  const text = (value: unknown) => value === null ? null : String(value);
  return {
    id: String(row["id"]),
    session: String(row["session"]),
    kind: String(row["kind"]) as RevertRow["kind"],
    choice: text(row["choice"]),
    checkpoint: text(row["checkpoint"]),
    tool_call: text(row["tool_call"]),
    boundary_seq: text(row["boundary_seq"]),
    outcome: String(row["outcome"]) as RevertRow["outcome"],
    redo: String(row["redo"]) as RevertRow["redo"],
    result_seq: text(row["result_seq"]),
  };
}

function headerOf(row: RevertRow, replayed: boolean): Header {
  return {
    id: row.id,
    session: row.session,
    kind: row.kind,
    outcome: row.outcome,
    redo: row.redo,
    result_seq: row.result_seq,
    replayed,
  };
}

// 같은 id의 재전송: 같은 요청이면 저장된 결과, 다르면 conflict다(R8).
function replayOf(
  row: RevertRow,
  same: boolean,
): Result<Header> {
  return same
    ? ok(headerOf(row, true))
    : reject("conflict", "revert id already used for other input");
}

// session이 열려 있는지 본다. 끝나지 않은 run이 있으면 시작하지 않는다(R15).
function requireIdleSession(tx: Tx, session: string): Result<void> {
  const found = tx.sql.get("select state from sessions where id = ?", [
    session,
  ]);
  if (found === undefined) return reject("not_found", "session not found");
  if (found["state"] !== "open") {
    return reject("forbidden", "a closed session cannot be rewound");
  }
  if (
    tx.sql.get(
      "select 1 as found from reverts where session = ? and outcome = 'applying'",
      [session],
    ) !== undefined
  ) return reject("conflict", "a revert is already applying");
  return ok(undefined);
}

function hasActiveRun(tx: Tx, session: string): boolean {
  return tx.sql.get(
    "select 1 as found from runs where session = ? and state != 'finished' limit 1",
    [session],
  ) !== undefined;
}

type NewRevert = {
  id: string;
  session: string;
  target: RewindTarget;
  preview_hash: string;
  summary_call: string | null;
  boundary_seq: string | null;
  outcome: "applied" | "blocked";
  redo: Header["redo"];
  result_seq: string;
};

function insertRevert(tx: Tx, revert: NewRevert): RevertRow {
  const rewound = revert.target.kind === "rewind";
  tx.sql.run(
    `insert into reverts
       (id, session, kind, choice, checkpoint, tool_call, boundary_seq, summary_call,
        outcome, redo, preview_hash, result_seq)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      revert.id,
      revert.session,
      revert.target.kind,
      revert.target.kind === "rewind" ? revert.target.choice : null,
      revert.target.kind === "rewind" ? revert.target.checkpoint : null,
      revert.target.kind === "undo" ? revert.target.tool_call : null,
      rewound && revert.boundary_seq !== null
        ? Number(revert.boundary_seq)
        : null,
      revert.summary_call,
      revert.outcome,
      revert.redo,
      revert.preview_hash,
      Number(revert.result_seq),
    ],
  );
  return loadRevert(tx, revert.id)!;
}

// 아무것도 복원하지 않은 결과를 확정한다. 항목은 남기지 않고 현재 판정의 수만 event에 싣는다.
function block(
  tx: Tx,
  input: {
    id: string;
    session: string;
    target: RewindTarget;
    preview_hash: string;
    summary_call: string | null;
  },
  plan: RewindPlan,
): Result<Header> {
  const results = countsOf([
    ...plan.preview.restore.map(() => "unchanged" as const),
    ...plan.preview.skip.map(() => "skipped" as const),
    ...plan.preview.remain.map(() => "remained" as const),
  ]);
  const seq = tx.emit(revertBlocked, input.id, {
    session: input.session,
    results,
  });
  const row = insertRevert(tx, {
    ...input,
    boundary_seq: boundaryOf(tx, input.target),
    outcome: "blocked",
    redo: "none",
    result_seq: seq,
  });
  return ok(headerOf(row, false));
}

// 접는 구간(고른 메시지부터 지금까지)에 이미 숨긴 메시지가 있으면 요약이 숨긴 내용을 품지 않으므로 접지 못한다.
// 숨김을 풀거나(redo) 그 뒤의 메시지부터 접는다.
function foldable(tx: Tx, session: string, checkpoint: string): Result<void> {
  const boundary = tx.sql.get(
    "select created_seq from messages where id = ? and session = ?",
    [checkpoint, session],
  );
  if (boundary === undefined) return ok(undefined);
  const from = Number(boundary["created_seq"]);
  return hiddenRanges(tx, session).some((range) =>
      Number(range.through_seq) >= from
    )
    ? reject("invalid_input", "the range to fold holds hidden messages")
    : ok(undefined);
}

function boundaryOf(tx: Tx, target: RewindTarget): string | null {
  if (target.kind !== "rewind") return null;
  const found = tx.sql.get(
    "select created_seq from messages where id = ?",
    [target.checkpoint],
  );
  return found === undefined ? null : String(found["created_seq"]);
}

function needsAccept(plan: RewindPlan): boolean {
  return plan.preview.skip.length > 0 || plan.preview.remain.length > 0;
}

// 항목을 쓰고 복원한 기록에 표시한 뒤 applied 결과를 확정한다.
function apply(
  tx: Tx,
  input: {
    id: string;
    session: string;
    target: RewindTarget;
    preview_hash: string;
    summary_call: string | null;
    redo: Header["redo"];
  },
  settled: readonly SettledItem[],
): Header {
  const counts = countsOf(settled.map((entry) => entry.result));
  const boundary_seq = boundaryOf(tx, input.target);
  const seq = tx.emit(revertApplied, input.id, {
    session: input.session,
    kind: input.target.kind,
    choice: input.target.kind === "rewind" ? input.target.choice : null,
    partial: leftSomething(counts),
    results: counts,
    boundary_seq,
    redo: input.redo,
  });
  const row = insertRevert(tx, {
    ...input,
    boundary_seq,
    outcome: "applied",
    result_seq: seq,
  });
  insertItems(tx, input.id, settled);
  for (const entry of settled) {
    if (entry.restored !== null) markReverted(tx, input.id, entry.restored);
  }
  return headerOf(row, false);
}

export function createRevertCommands(deps: RevertDeps): {
  record: CommandDefinition<typeof recordRewindFile>;
  rewind: CommandDefinition<typeof rewind>;
  undo: CommandDefinition<typeof undoEdit>;
  redo: CommandDefinition<typeof redo>;
  checkpoint: CommandDefinition<typeof checkpointRevert>;
  finish: CommandDefinition<typeof finishRevert>;
  amend: CommandDefinition<typeof amendRevertInstall>;
} {
  const planDeps: PlanDeps = deps;
  const appSteps = createAppStepCommands(deps);

  function handleRewind(
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof rewind>,
  ): Result<Header> {
    const user = requireUser(ctx);
    if (!user.ok) return user;
    const existing = loadRevert(tx, input.id);
    if (existing !== undefined) {
      return replayOf(
        existing,
        existing.kind === "rewind" && existing.session === input.session &&
          existing.checkpoint === input.checkpoint &&
          existing.choice === input.choice,
      );
    }
    const idle = requireIdleSession(tx, input.session);
    if (!idle.ok) return idle;
    if (hasActiveRun(tx, input.session)) {
      return reject("conflict", "stop the running work before rewinding");
    }
    const visible = assertCheckpointVisible(
      tx,
      input.session,
      input.checkpoint,
    );
    if (!visible.ok) return visible;
    if (input.choice === "summarize") {
      const folding = foldable(tx, input.session, input.checkpoint);
      if (!folding.ok) return folding;
    }
    const effects = deps.effects;
    if (effects === undefined) {
      return reject("unavailable", "rewind is not available yet");
    }
    if (
      input.choice === "summarize" &&
      !effects.summaryOk(tx, {
        session: input.session,
        call: input.summary_call!,
      })
    ) {
      return reject("invalid_input", "the summary did not fully succeed");
    }
    const target: RewindTarget = {
      kind: "rewind",
      session: input.session,
      checkpoint: input.checkpoint,
      choice: input.choice,
    };
    const planned = planRewind(tx, planDeps, target, {
      observed: observedOf(input.files),
      revert: input.id,
    });
    if (!planned.ok) return planned;
    const plan = planned.value;
    const request = {
      id: input.id,
      session: input.session,
      target,
      preview_hash: input.preview_hash,
      summary_call: input.summary_call,
    };
    if (
      plan.preview.preview_hash !== input.preview_hash ||
      (needsAccept(plan) && !input.accept_remaining)
    ) return block(tx, request, plan);
    const boundary = boundaryOf(tx, target)!;
    // 앱 복원이 있으면 접수만 한다. 대화 효과와 문서 파일은 앱 단계가 끝난 뒤 FinishRevert가 한다.
    if (hasAppSteps(plan)) {
      return ok(startApplying(tx, {
        id: input.id,
        session: input.session,
        checkpoint: input.checkpoint,
        choice: "restore_all",
        preview_hash: input.preview_hash,
        boundary_seq: boundary,
      }, plan));
    }
    if (input.choice !== "summarize") {
      const cancelled = effects.cancelWaiting(tx, {
        session: input.session,
        from_seq: boundary,
      });
      if (!cancelled.ok) return cancelled;
      const reset = effects.resetReadState(tx, {
        session: input.session,
        before_seq: boundary,
      });
      if (!reset.ok) return reset;
    }
    const settled = settleItems(plan, input.files, true);
    return ok(apply(tx, {
      ...request,
      redo: input.choice === "summarize" ? "none" : "available",
    }, settled));
  }

  function handleUndo(
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof undoEdit>,
  ): Result<Header> {
    const user = requireUser(ctx);
    if (!user.ok) return user;
    const existing = loadRevert(tx, input.id);
    if (existing !== undefined) {
      return replayOf(
        existing,
        existing.kind === "undo" && existing.session === input.session &&
          existing.tool_call === input.tool_call,
      );
    }
    const idle = requireIdleSession(tx, input.session);
    if (!idle.ok) return idle;
    const target: RewindTarget = {
      kind: "undo",
      session: input.session,
      tool_call: input.tool_call,
    };
    const planned = planRewind(tx, planDeps, target, {
      observed: observedOf(input.files),
    });
    if (!planned.ok) return planned;
    const plan = planned.value;
    if (writingNow(tx, input.session, plan)) {
      return reject("conflict", "a running run is writing this file");
    }
    const request = {
      id: input.id,
      session: input.session,
      target,
      preview_hash: input.preview_hash,
      summary_call: null,
    };
    const settled = settleItems(plan, input.files, false);
    if (
      plan.preview.preview_hash !== input.preview_hash ||
      !settled.some((entry) => entry.restored !== null)
    ) return block(tx, request, plan);
    for (const entry of settled) {
      if (entry.restored === null) continue;
      const fact = deps.recordFact(tx, {
        session: input.session,
        text: `Undid edit to ${entry.restored.path}`,
        principal: ctx.principal,
      });
      if (!fact.ok) return fact;
    }
    return ok(apply(tx, { ...request, redo: "none" }, settled));
  }

  function handleRedo(
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof redo>,
  ): Result<Header> {
    const user = requireUser(ctx);
    if (!user.ok) return user;
    const row = loadRevert(tx, input.revert);
    if (row === undefined) return reject("not_found", "revert not found");
    if (row.redo !== "available") {
      return reject("conflict", "there is nothing to redo");
    }
    if (row.result_seq !== input.result_seq) {
      return reject("conflict", "the revert changed since it was shown");
    }
    const open = tx.sql.get("select state from sessions where id = ?", [
      row.session,
    ]);
    if (open?.["state"] !== "open") {
      return reject("forbidden", "a closed session cannot redo");
    }
    const observed = observedOf(input.files);
    let files = 0;
    for (
      const item of tx.sql.all(
        `select target, source, restored_sha256 from revert_items
          where revert = ? and class = 'file' and result = 'restored'`,
        [row.id],
      )
    ) {
      const now = observed.get(String(item["target"]));
      const restored = item["restored_sha256"] === null
        ? null
        : String(item["restored_sha256"]);
      if (now === undefined || now.link || now.sha256 !== restored) continue;
      releaseReverted(
        tx,
        row.id,
        JSON.parse(String(item["source"])) as string[],
        String(item["target"]),
      );
      files += 1;
    }
    const messages = Number(
      tx.sql.get(
        `select count(*) as n from messages
          where session = ? and created_seq >= ? and created_seq <= ?`,
        [row.session, Number(row.boundary_seq), Number(row.result_seq)],
      )!["n"],
    );
    tx.sql.run("update reverts set redo = 'done' where id = ?", [row.id]);
    tx.emit(revertRedone, row.id, { session: row.session, messages, files });
    return ok(headerOf({ ...row, redo: "done" }, false));
  }

  function handleAmend(
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof amendRevertInstall>,
  ): Result<Header> {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return reject("forbidden", "only the runtime amends an install");
    }
    const row = loadRevert(tx, input.revert);
    if (row === undefined) return reject("not_found", "revert not found");
    if (row.outcome !== "applied") {
      return reject("conflict", "only an applied revert is amended");
    }
    const amended: { ordinal: number; source: string[]; path: string }[] = [];
    for (const path of input.paths) {
      const item = tx.sql.get(
        `select ordinal, source from revert_items
          where revert = ? and class = 'file' and target = ?
            and plan = 'restore' and result = 'restored'`,
        [row.id, path],
      );
      if (item === undefined) {
        return reject("conflict", "the path was not restored by this revert");
      }
      amended.push({
        ordinal: Number(item["ordinal"]),
        source: JSON.parse(String(item["source"])) as string[],
        path,
      });
    }
    for (const entry of amended) {
      tx.sql.run(
        `update revert_items
            set result = 'skipped', reason = 'edited_outside',
                restored_sha256 = null, redo_ref = null
          where revert = ? and ordinal = ?`,
        [row.id, entry.ordinal],
      );
      releaseReverted(tx, row.id, entry.source, entry.path);
    }
    const results = countsOf(
      tx.sql.all("select result from revert_items where revert = ?", [row.id])
        .map((item) => String(item["result"]) as RevertItem["result"]),
    );
    tx.emit(revertAmended, row.id, {
      session: row.session,
      amended: amended.length,
      results,
    });
    return ok(headerOf(row, false));
  }

  return {
    record: createRecordRewindFile(),
    rewind: {
      route: rewind,
      handle: (tx, ctx, input) => handleRewind(tx, ctx, input),
    },
    undo: {
      route: undoEdit,
      handle: (tx, ctx, input) => handleUndo(tx, ctx, input),
    },
    redo: {
      route: redo,
      handle: (tx, ctx, input) => handleRedo(tx, ctx, input),
    },
    checkpoint: appSteps.checkpoint,
    finish: appSteps.finish,
    amend: {
      route: amendRevertInstall,
      handle: (tx, ctx, input) => handleAmend(tx, ctx, input),
    },
  };
}

// 끝나지 않은 run이 이 경로를 쓴 기록이 있으면 Undo가 그 run과 겹친다.
function writingNow(tx: Tx, session: string, plan: RewindPlan): boolean {
  return plan.judged.some((file) =>
    tx.sql.get(
      `select 1 as found
         from rewind_files f
         join tool_calls t on t.id = f.tool_call
         join runs r on r.id = t.run
        where r.session = ? and r.state != 'finished' and f.path = ? limit 1`,
      [session, file.path],
    ) !== undefined
  );
}
