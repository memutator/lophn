import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { createHash } from "node:crypto";
import {
  acceptRun,
  checkpointRun,
  confirmNextRun,
  finishRun,
  registerPreparedBlob,
  RUN_BLOB_PURPOSES,
  runAccepted,
  runFinished,
  runStarted,
  startRun,
  stopRun,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
} from "../../../protocol/storage/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  effectiveRunLimits,
  RUN_LIMIT_SETTING_KEYS,
  type RunLimits,
} from "./limits.ts";
import {
  loadRun,
  predecessorAllows,
  rowOf,
  RUN_COLUMNS,
  type RunRow,
  sameAcceptance,
  sourceColumns,
} from "./model.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다. finished 행은 trigger도 다시 못 바꾼다.

// run 근거와 결과는 영구 참조다(run-loop domain model). 준비한 blob의 hash만 StartRun·FinishRun이 싣는다.
export const runBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: "run",
    field: "basis",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  // 고정한 resolved agent의 전체 값이다. 이어 하기가 이 blob을 그대로 쓴다.
  defineBlobField({
    owner_kind: "run",
    field: "agent",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "run",
    field: "result",
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

export type RunLoopDeps = {
  // 정상 종료를 막는 미반영 steering이 있는지. 입력 표를 소유한 concern
  // (lophn-agent/conversation)이 같은 Tx에서 답한다. 없으면 표가 없는 것이다.
  hasUnappliedSteering?: (tx: Tx, run: string) => boolean;
  // StartRun이 고정할 한도. 없으면 같은 Tx의 공통 설정 선택(setting_choices)에서
  // 읽는다. 호출자가 보낸 한도는 이 값과 같아야 하고 다르면 거절한다.
  runLimits?: (tx: Tx) => Result<RunLimits>;
};

// 공통 설정의 저장 선택과 내장 기본값으로 다음 run의 한도를 정한다. 설정 표를 읽지
// 못하면 한도를 알 수 없으므로 시작하지 않는다(안전하게 닫는다).
function settingsRunLimits(tx: Tx): Result<RunLimits> {
  const keys = Object.values(RUN_LIMIT_SETTING_KEYS);
  try {
    const rows = tx.sql.all(
      `select key, value from setting_choices
       where layer = 'common' and key in (${keys.map(() => "?").join(", ")})`,
      keys,
    );
    return effectiveRunLimits(
      rows.map((row) => ({
        key: String(row["key"]),
        value: JSON.parse(String(row["value"])) as unknown,
      })),
    );
  } catch {
    return err({
      code: "unavailable",
      message: "run limit settings are not readable",
    });
  }
}

type Code = "invalid_input" | "conflict" | "not_found" | "forbidden";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : reject(
    "forbidden",
    "run records are machine only",
  );
}

function notFound(): Result<never> {
  return reject("not_found", "run not found");
}

type AssignmentRef = { role: string; state: string; revision: number };

function loadAssignment(tx: Tx, id: string): AssignmentRef | undefined {
  const row = tx.sql.get(
    "select role, state, revision from assignments where id = ?",
    [id],
  );
  return row === undefined ? undefined : {
    role: String(row["role"]),
    state: String(row["state"]),
    revision: Number(row["revision"]),
  };
}

// event seq는 rowid다. emit 전에 다음 seq를 알아 payload에 싣고 emit 뒤 검증한다.
function nextSeq(tx: Tx): bigint {
  const row = tx.sql.get(
    "select coalesce(max(seq), 0) + 1 as next from events",
    [],
  );
  return BigInt(row === undefined ? 1 : String(row["next"]));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

// 같은 session(session 없는 run은 같은 assignment의 session 없는 run)의 접수 순서상
// 먼저 시작할 수 있는 run이 있는지.
function earlierStartable(tx: Tx, row: RunRow): boolean {
  const earlier = (row.session === null
    ? tx.sql.all(
      `select ${RUN_COLUMNS} from runs
       where assignment = ? and session is null and state = 'accepted'
         and accepted_seq < ?
       order by accepted_seq`,
      [row.assignment, Number(row.accepted_seq)],
    )
    : tx.sql.all(
      `select ${RUN_COLUMNS} from runs
       where session = ? and state = 'accepted' and accepted_seq < ?
       order by accepted_seq`,
      [row.session, Number(row.accepted_seq)],
    )).map(rowOf);
  return earlier.some((candidate) =>
    predecessorAllows(
      candidate,
      candidate.start_after === null
        ? undefined
        : loadRun(tx, candidate.start_after),
    )
  );
}

// 끝내는 쓰기 하나. 정상 종료·멈춤·사람 기다림의 답 없음 종료가 같은 길로 끝난다.
export function finishRow(
  tx: Tx,
  row: RunRow,
  outcome: { kind: string; reason: string },
  result: string,
  facts: string | null,
  stopKey: string | null,
): Result<{ seq: string; finished_at: string }> {
  const predicted = nextSeq(tx);
  const finishedAt = tx.now();
  const seq = tx.emit(runFinished, row.id, {
    assignment: row.assignment,
    started: row.started_at !== null,
    started_at: row.started_at,
    outcome: outcome as never,
    result,
    finished_at: finishedAt,
  });
  if (BigInt(seq) !== predicted) {
    return reject("conflict", "event position moved");
  }
  tx.sql.run(
    `update runs set state = 'finished', waiting_on = null, finished_at = ?,
       outcome_kind = ?, outcome_reason = ?, result = ?, result_facts = ?,
       stop_request_key = ?, state_seq = ?
     where id = ?`,
    [
      finishedAt,
      outcome.kind,
      outcome.reason,
      result,
      facts,
      stopKey,
      Number(seq),
      row.id,
    ],
  );
  return ok({ seq, finished_at: finishedAt });
}

export function createRunCommands(deps: RunLoopDeps = {}): {
  accept: CommandDefinition<typeof acceptRun>;
  start: CommandDefinition<typeof startRun>;
  checkpoint: CommandDefinition<typeof checkpointRun>;
  finish: CommandDefinition<typeof finishRun>;
  stop: CommandDefinition<typeof stopRun>;
  confirmNext: CommandDefinition<typeof confirmNextRun>;
} {
  return {
    accept: {
      route: acceptRun,
      handle(tx, ctx, input: Input<typeof acceptRun>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        // 같은 요청·회차·handoff 재전달은 이전 결과다.
        const existing = loadRun(tx, input.id);
        if (existing !== undefined) {
          if (!sameAcceptance(existing, input)) {
            return reject("conflict", "run id already used for other input");
          }
          return ok({
            id: existing.id,
            state: "accepted" as const,
            accepted_seq: existing.accepted_seq,
            state_seq: existing.accepted_seq,
          });
        }
        const assignment = loadAssignment(tx, input.assignment);
        if (assignment === undefined) {
          return reject("not_found", "assignment not found");
        }
        if (assignment.state !== "enabled") {
          return reject("forbidden", "assignment does not take new runs");
        }
        if (assignment.revision !== compare.assignment_revision) {
          return reject("conflict", "assignment changed");
        }
        const source = input.source;
        if (source.kind === "handoff") {
          if (assignment.role === "operator") {
            return reject("invalid_input", "operators take no handoff");
          }
          const sender = loadRun(tx, source.sender_run);
          if (sender === undefined) return notFound();
          if (sender.assignment === input.assignment) {
            return reject("invalid_input", "handoff must cross assignments");
          }
          const senderSource = JSON.parse(sender.source) as {
            kind: string;
            message?: string;
            original_message?: string;
          };
          const origin = senderSource.kind === "message"
            ? senderSource.message
            : senderSource.kind === "handoff"
            ? senderSource.original_message
            : undefined;
          if (origin !== source.original_message) {
            return reject(
              "invalid_input",
              "handoff original request does not match the sender chain",
            );
          }
        }
        for (const link of [input.continued_from, input.start_after]) {
          if (link === null) continue;
          const linked = loadRun(tx, link);
          if (linked === undefined) return notFound();
          if (linked.assignment !== input.assignment) {
            return reject("invalid_input", "linked run is another assignment");
          }
        }
        const columns = sourceColumns(source);
        const duplicate = source.kind === "message"
          ? tx.sql.get(
            `select ${RUN_COLUMNS} from runs where source_message = ?`,
            [source.message],
          )
          : tx.sql.get(
            `select ${RUN_COLUMNS} from runs
             where source_sender_run = ? and source_dedup_key = ?`,
            [source.sender_run, source.dedup_key],
          );
        if (duplicate !== undefined) {
          const prior = rowOf(duplicate);
          if (!sameAcceptance(prior, input)) {
            return reject("conflict", "the same source key had other content");
          }
          return ok({
            id: prior.id,
            state: "accepted" as const,
            accepted_seq: prior.accepted_seq,
            state_seq: prior.accepted_seq,
          });
        }
        const predicted = nextSeq(tx);
        const seq = tx.emit(runAccepted, input.id, {
          assignment: input.assignment,
          session: input.session,
          source,
          accepted_seq: predicted.toString(),
        });
        if (BigInt(seq) !== predicted) {
          return reject("conflict", "event position moved");
        }
        tx.sql.run(
          `insert into runs (id, assignment, session, source, source_kind,
             source_message, source_sender_run, source_original_message,
             source_dedup_key, continued_from, start_after, state, state_seq,
             accepted_seq)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
          [
            input.id,
            input.assignment,
            input.session,
            JSON.stringify(source),
            source.kind,
            columns.message,
            columns.sender,
            columns.originalMessage,
            columns.dedupKey,
            input.continued_from,
            input.start_after,
            Number(seq),
            Number(seq),
          ],
        );
        return ok({
          id: input.id,
          state: "accepted" as const,
          accepted_seq: seq,
          state_seq: seq,
        });
      },
    },
    start: {
      route: startRun,
      handle(tx, ctx, input: Input<typeof startRun>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const row = loadRun(tx, input.run);
        if (row === undefined) return notFound();
        if (row.state !== "accepted") {
          return reject("conflict", "only an accepted run starts");
        }
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        const assignment = loadAssignment(tx, row.assignment);
        if (assignment === undefined) return notFound();
        if (assignment.state !== "enabled") {
          return reject("forbidden", "assignment is not enabled");
        }
        if (
          input.scope.assignment !== row.assignment ||
          input.scope.role !== assignment.role
        ) {
          return reject("forbidden", "scope does not belong to this run");
        }
        // 한도는 현재 설정이 정한다. machine이 보낸 값을 그대로 받지 않는다.
        const limits = (deps.runLimits ?? settingsRunLimits)(tx);
        if (!limits.ok) {
          return err({
            code: "unavailable",
            message: "run limits cannot be resolved",
          });
        }
        if (canonicalize(limits.value) !== canonicalize(input.limits)) {
          return reject(
            "invalid_input",
            "limits do not match the current run limit settings",
          );
        }
        // 진행 중·사람 기다림 run은 session마다 하나, session 없는 run은 assignment마다 하나다.
        const active = row.session === null
          ? tx.sql.get(
            `select id from runs where assignment = ? and session is null
             and state in ('running', 'waiting_user')`,
            [row.assignment],
          )
          : tx.sql.get(
            `select id from runs where session = ?
             and state in ('running', 'waiting_user')`,
            [row.session],
          );
        if (active !== undefined) {
          return reject(
            "conflict",
            row.session === null
              ? "the assignment already has a live run without a session"
              : "the session already has a live run",
          );
        }
        const predecessor = row.start_after === null
          ? undefined
          : loadRun(tx, row.start_after);
        if (!predecessorAllows(row, predecessor)) {
          return reject(
            "conflict",
            "the preceding run has not allowed a start",
          );
        }
        if (earlierStartable(tx, row)) {
          return reject("conflict", "an earlier accepted run goes first");
        }
        const startedAt = tx.now();
        const seq = tx.emit(runStarted, row.id, {
          basis: input.basis,
          limits: input.limits,
          started_at: startedAt,
          scope: input.scope,
        });
        if (input.basis_size !== undefined) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "run",
            owner_key: row.id,
            field: "basis",
            hash: input.basis,
            size: input.basis_size,
            purpose: RUN_BLOB_PURPOSES.run_basis,
            seq,
          });
          if (!registered.ok) return registered;
        }
        if (input.agent !== undefined && input.agent_size !== undefined) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "run",
            owner_key: row.id,
            field: "agent",
            hash: input.agent,
            size: input.agent_size,
            purpose: RUN_BLOB_PURPOSES.run_agent,
            seq,
          });
          if (!registered.ok) return registered;
        }
        tx.sql.run(
          `update runs set state = 'running', basis = ?, limits = ?,
             started_at = ?, state_seq = ? where id = ?`,
          [
            input.basis,
            JSON.stringify(input.limits),
            startedAt,
            Number(seq),
            row.id,
          ],
        );
        return ok({
          id: row.id,
          state: "running" as const,
          state_seq: seq,
          started_at: startedAt,
          basis: input.basis,
          scope: input.scope,
        });
      },
    },
    checkpoint: {
      route: checkpointRun,
      handle(tx, ctx, input: Input<typeof checkpointRun>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const row = loadRun(tx, input.run);
        if (row === undefined) return notFound();
        if (row.state !== "running") {
          return reject("conflict", "only a running run takes a checkpoint");
        }
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        if (input.elapsed.active_ms < row.elapsed_active_ms) {
          return reject("invalid_input", "active time cannot decrease");
        }
        const previous = row.elapsed_checkpoint_at;
        const at = input.elapsed.checkpoint_at;
        if (previous !== null && (at === null || at < previous)) {
          return reject("invalid_input", "checkpoint time cannot go back");
        }
        tx.sql.run(
          `update runs set elapsed_active_ms = ?, elapsed_stall_ms = ?,
             elapsed_checkpoint_at = ? where id = ?`,
          [
            input.elapsed.active_ms,
            input.elapsed.stall_ms,
            at,
            row.id,
          ],
        );
        return ok({
          id: row.id,
          state: "running" as const,
          state_seq: row.state_seq,
          elapsed: input.elapsed,
        });
      },
    },
    finish: {
      route: finishRun,
      handle(tx, ctx, input: Input<typeof finishRun>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const row = loadRun(tx, input.run);
        if (row === undefined) return notFound();
        // 끝난 run의 늦은 결과는 결과를 덮지 못한다.
        if (row.state === "finished") {
          return reject("conflict", "the run result is already final");
        }
        if (row.state === "waiting_user") {
          return reject("conflict", "resolve the wait before finishing");
        }
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        const { outcome } = input;
        if (outcome.kind === "stopped") {
          return reject("invalid_input", "stops go through StopRun");
        }
        if (row.state === "accepted") {
          // 시작하지 못한 run은 영구 불가 이유로만 끝낸다.
          const permanent = outcome.kind === "failed" &&
            (outcome.reason === "configuration_unavailable" ||
              outcome.reason === "target_unavailable");
          if (!permanent) {
            return reject(
              "invalid_input",
              "an unstarted run ends only for a permanent unavailable reason",
            );
          }
        }
        if (
          outcome.kind === "completed" &&
          deps.hasUnappliedSteering?.(tx, row.id) === true
        ) {
          return reject("conflict", "unapplied steering blocks a normal end");
        }
        const done = finishRow(tx, row, outcome, input.result, null, null);
        if (!done.ok) return done;
        if (input.result_size !== undefined) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "run",
            owner_key: row.id,
            field: "result",
            hash: input.result,
            size: input.result_size,
            purpose: RUN_BLOB_PURPOSES.run_result,
            seq: done.value.seq,
          });
          if (!registered.ok) return registered;
        }
        return ok({
          id: row.id,
          state: "finished" as const,
          state_seq: done.value.seq,
          outcome,
          result: input.result,
          finished_at: done.value.finished_at,
        });
      },
    },
    stop: {
      route: stopRun,
      handle(tx, ctx, input: Input<typeof stopRun>, compare) {
        const kind = parseActor(ctx.actor)?.kind;
        if (kind !== "user" && kind !== "machine") {
          return reject("forbidden", "stopping needs a user or machine");
        }
        if (kind === "user" && input.reason !== "user_stopped") {
          return reject("forbidden", "a user stops with user_stopped");
        }
        const row = loadRun(tx, input.run);
        if (row === undefined) return notFound();
        // 끝난 run은 기존 결과를 돌려준다. 멈춤이 결과를 바꾸지 않는다.
        if (row.state === "finished") {
          return ok({
            id: row.id,
            state: "finished" as const,
            state_seq: row.state_seq,
            outcome: {
              kind: row.outcome_kind,
              reason: row.outcome_reason,
            } as never,
            result: row.result as string,
            finished_at: row.finished_at as string,
            replayed: true,
          });
        }
        if (kind === "machine") {
          const assignment = loadAssignment(tx, row.assignment);
          const wanted = input.reason === "assignment_paused"
            ? "paused"
            : input.reason === "assignment_withdrawn"
            ? "withdrawn"
            : null;
          if (wanted === null || assignment?.state !== wanted) {
            return reject("forbidden", "the assignment is not in that state");
          }
        }
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        const outcome = { kind: "stopped", reason: input.reason };
        // 모델이 쓴 본문이 없으므로 machine이 확정한 사실만 결과로 정리한다.
        const facts = {
          run: row.id,
          assignment: row.assignment,
          started: row.started_at !== null,
          outcome,
        };
        const result = sha256(facts);
        const done = finishRow(
          tx,
          row,
          outcome,
          result,
          canonicalize(facts),
          input.request_key,
        );
        if (!done.ok) return done;
        return ok({
          id: row.id,
          state: "finished" as const,
          state_seq: done.value.seq,
          outcome: outcome as never,
          result,
          finished_at: done.value.finished_at,
          replayed: false,
        });
      },
    },
    confirmNext: {
      route: confirmNextRun,
      handle(tx, ctx, input: Input<typeof confirmNextRun>, compare) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return reject("forbidden", "only a person continues a request");
        }
        const row = loadRun(tx, input.run);
        if (row === undefined) return notFound();
        if (row.state !== "accepted") {
          return reject("conflict", "only an accepted run is confirmed");
        }
        if (row.accepted_seq !== compare.accepted_seq) {
          return reject("conflict", "run changed");
        }
        if (row.start_after !== input.predecessor) {
          return reject("invalid_input", "not the preceding run of this run");
        }
        const predecessor = loadRun(tx, input.predecessor);
        if (predecessor === undefined) return notFound();
        if (predecessor.state_seq !== compare.predecessor_state_seq) {
          return reject("conflict", "preceding run changed");
        }
        if (
          predecessor.state !== "finished" ||
          predecessor.outcome_kind === "completed"
        ) {
          return reject("conflict", "the preceding run needs no confirmation");
        }
        if (row.start_confirmed_seq !== null) {
          return ok({
            id: row.id,
            predecessor: input.predecessor,
            start_confirmed_seq: row.start_confirmed_seq,
            state: "accepted" as const,
          });
        }
        // event 없는 command이므로 확인이 놓인 ledger 위치를 근거로 남긴다.
        const at = String(nextSeq(tx) - 1n);
        tx.sql.run("update runs set start_confirmed_seq = ? where id = ?", [
          Number(at),
          row.id,
        ]);
        return ok({
          id: row.id,
          predecessor: input.predecessor,
          start_confirmed_seq: at,
          state: "accepted" as const,
        });
      },
    },
  };
}
