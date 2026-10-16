import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  amendRevertInstall,
  recordRewindApps,
  type recordRewindFile,
  revertAmended,
  revertApplied,
  revertBlocked,
  type RevertItem,
} from "../../../../protocol/lophn-agent/mod.ts";
import { sessionRewind } from "../../../../protocol/lophn-agent/session-rewinds.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  RequestContext,
  Sql,
  Tx,
} from "../../../../protocol/server/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import {
  type PlanDeps,
  planRewind,
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

// session rewind command들(lophn-agent/revert). Rewind는 대화와 파일까지 여기서 확정한다. 이미 숨긴
// 구간의 checkpoint는 invalid_input이고(hidden.ts) summarize는 숨긴 메시지를 품은 구간을 접지 않는다.
// RecordRewindFile은 record.ts다.
//
// 규칙(rewind_test가 정한다). Rewind는 사람만 부른다(그 밖은 forbidden). 같은 id를 다시 보내면 저장된
// 결과를 replayed=true로 돌려주고 아무것도 다시 하지 않는다. 파일 복원은 command 안에서 하지 않는다: core가
// observeFiles → planRewind → prepareRestore → command → installRestore 순서로 잇고, command는 input.files의
// 관측으로 다시 판정해 같은 transaction에서 기록만 확정한다. 준비가 받쳐 주지 않는 복원은 restored로 쓰지
// 않는다. 앱 data는 여기서 되돌리지 않는다: 사람이 고른 앱(`apps`)은 command가 확정된 뒤 core가 앱 rewind에
// 요청하고(files.ts) 그 결과는 RecordRewindApps로 남는다.
//
// Rewind: 없는 session은 not_found, 닫혔으면 forbidden, 도는 turn이 있으면 conflict. choice=summarize인데
//   effects.summaryOk가 아니면 invalid_input이고 아무것도 바뀌지 않는다. 앱은 restore_all에서만 고른다.
//   preview_hash가 다르거나 건너뜀·남는 영향이 있는데 accept_remaining이 아니면 blocked(항목 없음)로 기록한다.
//   아니면 restore_all·messages_only는 effects.cancelWaiting을 부르고(실패하면 command 전체가 되돌려진다)
//   applied로 확정한다. restore_all은 복원한 항목의 기록에 reverted_by를 표시한다.
// AmendRevertInstall(machine): 설치가 hash 불일치로 건너뛴 파일 항목을 skipped(edited_outside)로 한 번 고치고
//   그 기록의 reverted_by를 푼다.

// 대화 쪽 효과를 core 조립이 주입하는 port다. 시험은 가짜로 대신한다.
export type RewindEffects = {
  // 같은 session의 완전 성공한 요약 model call인가(choice=summarize의 근거).
  summaryOk(
    lookup: { sql: Pick<Sql, "get" | "all"> },
    input: { session: string; call: string },
  ): boolean;
  // 이 session의 대기 중인 권한 요청과 질문을 취소한다.
  cancelWaiting(tx: Tx, input: { session: string }): Result<void>;
};

export type RevertDeps = PlanDeps & {
  // 숨김 구간의 대화 효과. 없으면 Rewind는 unavailable이다(숨기지 못하는 rewind를 적용됐다고 하지 않는다).
  effects?: RewindEffects;
};

type Header = Output<typeof sessionRewind>;
type RevertRow = {
  id: string;
  session: string;
  choice: string;
  checkpoint: string;
  boundary_seq: string;
  outcome: Header["outcome"];
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
    : reject("forbidden", "only a person rewinds");
}

function loadRevert(tx: Tx, id: string): RevertRow | undefined {
  const row = tx.sql.get(
    `select id, session, choice, checkpoint, cast(boundary_seq as text) as boundary_seq,
            outcome, cast(result_seq as text) as result_seq
       from reverts where id = ?`,
    [id],
  );
  if (row === undefined) return undefined;
  return {
    id: String(row["id"]),
    session: String(row["session"]),
    choice: String(row["choice"]),
    checkpoint: String(row["checkpoint"]),
    boundary_seq: String(row["boundary_seq"]),
    outcome: String(row["outcome"]) as RevertRow["outcome"],
    result_seq: row["result_seq"] === null ? null : String(row["result_seq"]),
  };
}

function headerOf(row: RevertRow, replayed: boolean): Header {
  return {
    id: row.id,
    session: row.session,
    outcome: row.outcome,
    result_seq: row.result_seq,
    replayed,
  };
}

// session이 열려 있고 도는 turn이 없는지 본다. 도는 turn은 먼저 멈춘 뒤에만 되돌린다.
function requireIdleSession(tx: Tx, session: string): Result<void> {
  const found = tx.sql.get("select lifecycle from sessions where id = ?", [
    session,
  ]);
  if (found === undefined) return reject("not_found", "session not found");
  if (found["lifecycle"] !== "open") {
    return reject("forbidden", "a closed session cannot be rewound");
  }
  if (
    tx.sql.get(
      "select 1 as found from turns where session = ? and state = 'running' limit 1",
      [session],
    ) !== undefined
  ) return reject("conflict", "stop the running work before rewinding");
  return ok(undefined);
}

type NewRevert = {
  id: string;
  session: string;
  target: RewindTarget;
  preview_hash: string;
  summary_call: string | null;
  boundary_seq: string;
  outcome: "applied" | "blocked";
};

// 결과를 확정한 때 session의 마지막 메시지 순번이다. 숨긴 구간은 boundary_seq부터 여기까지다.
function lastMessageSeq(tx: Tx, session: string): string {
  const row = tx.sql.get(
    "select cast(coalesce(max(created_seq), 0) as text) as last from messages where session = ?",
    [session],
  );
  return String(row!["last"]);
}

function insertRevert(tx: Tx, revert: NewRevert): RevertRow {
  tx.sql.run(
    `insert into reverts
       (id, session, choice, checkpoint, boundary_seq, summary_call, outcome, preview_hash, result_seq)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      revert.id,
      revert.session,
      revert.target.choice,
      revert.target.checkpoint,
      Number(revert.boundary_seq),
      revert.summary_call,
      revert.outcome,
      revert.preview_hash,
      Number(lastMessageSeq(tx, revert.session)),
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
  tx.emit(revertBlocked, input.id, { session: input.session, results });
  const row = insertRevert(tx, {
    ...input,
    boundary_seq: boundaryOf(tx, input.target),
    outcome: "blocked",
  });
  return ok(headerOf(row, false));
}

// 접는 구간(고른 메시지부터 지금까지)에 이미 숨긴 메시지가 있으면 요약이 숨긴 내용을 품지 않으므로 접지 못한다.
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

function boundaryOf(tx: Tx, target: RewindTarget): string {
  const found = tx.sql.get(
    "select created_seq from messages where id = ?",
    [target.checkpoint],
  );
  return String(found!["created_seq"]);
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
    apps: number;
  },
  settled: readonly SettledItem[],
): Header {
  const counts = countsOf(settled.map((entry) => entry.result));
  const boundary_seq = boundaryOf(tx, input.target);
  tx.emit(revertApplied, input.id, {
    session: input.session,
    choice: input.target.choice,
    partial: leftSomething(counts),
    results: counts,
    boundary_seq,
    apps: input.apps,
  });
  const row = insertRevert(tx, { ...input, boundary_seq, outcome: "applied" });
  insertItems(tx, input.id, settled);
  for (const entry of settled) {
    if (entry.restored !== null) markReverted(tx, input.id, entry.restored);
  }
  return headerOf(row, false);
}

export function createSessionRewindCommands(deps: RevertDeps): {
  record: CommandDefinition<typeof recordRewindFile>;
  rewind: CommandDefinition<typeof sessionRewind>;
  amend: CommandDefinition<typeof amendRevertInstall>;
  apps: CommandDefinition<typeof recordRewindApps>;
} {
  function handleRewind(
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof sessionRewind>,
  ): Result<Header> {
    const user = requireUser(ctx);
    if (!user.ok) return user;
    const existing = loadRevert(tx, input.id);
    if (existing !== undefined) {
      return existing.session === input.session &&
          existing.checkpoint === input.checkpoint &&
          existing.choice === input.choice
        ? ok(headerOf(existing, true))
        : reject("conflict", "rewind id already used for other input");
    }
    const idle = requireIdleSession(tx, input.session);
    if (!idle.ok) return idle;
    const visible = assertCheckpointVisible(
      tx,
      input.session,
      input.checkpoint,
    );
    if (!visible.ok) return visible;
    if (input.apps.length > 0 && input.choice !== "restore_all") {
      return reject("invalid_input", "only restore_all rewinds apps");
    }
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
      session: input.session,
      checkpoint: input.checkpoint,
      choice: input.choice,
    };
    const planned = planRewind(tx, deps, target, {
      observed: observedOf(input.files),
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
    if (input.choice !== "summarize") {
      const cancelled = effects.cancelWaiting(tx, { session: input.session });
      if (!cancelled.ok) return cancelled;
    }
    const settled = settleItems(plan, input.files);
    return ok(apply(tx, { ...request, apps: input.apps.length }, settled));
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
                restored_sha256 = null
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

  function handleApps(
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof recordRewindApps>,
  ): Result<{ revert: string; recorded: number }> {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return reject("forbidden", "only the runtime records app rewinds");
    }
    const row = loadRevert(tx, input.revert);
    if (row === undefined) return reject("not_found", "revert not found");
    if (row.outcome !== "applied") {
      return reject("conflict", "only an applied revert requests app rewinds");
    }
    let recorded = 0;
    for (const app of input.apps) {
      const known = tx.sql.get(
        "select result from rewind_apps where revert = ? and app = ?",
        [row.id, app.app],
      );
      if (known === undefined) {
        tx.sql.run(
          `insert into rewind_apps (revert, app, from_invocation, result, reason)
           values (?, ?, ?, ?, ?)`,
          [row.id, app.app, app.from_invocation, app.result, app.reason],
        );
      } else if (known["result"] === "accepted") {
        tx.sql.run(
          "update rewind_apps set result = ?, reason = ? where revert = ? and app = ?",
          [app.result, app.reason, row.id, app.app],
        );
      } else continue;
      recorded += 1;
    }
    return ok({ revert: row.id, recorded });
  }

  return {
    record: createRecordRewindFile(),
    rewind: {
      route: sessionRewind,
      handle: (tx, ctx, input) => handleRewind(tx, ctx, input),
    },
    amend: {
      route: amendRevertInstall,
      handle: (tx, ctx, input) => handleAmend(tx, ctx, input),
    },
    apps: {
      route: recordRewindApps,
      handle: (tx, ctx, input) => handleApps(tx, ctx, input),
    },
  };
}
