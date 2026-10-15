import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { createHash } from "node:crypto";
import {
  checkpointTurn,
  finishTurn,
  registerPreparedBlob,
  startTurn,
  stopTurn,
  TURN_BLOB_PURPOSES,
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
import type { Id } from "../../../protocol/base/ids.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  effectiveTurnLimits,
  TURN_LIMIT_SETTING_KEYS,
  type TurnLimits,
} from "./limits.ts";
import { publishTurnEnded } from "./turn-events.ts";
import { loadTurn, type TurnRow } from "./model.ts";
import type { CallSignals } from "./ports.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기. 짧은 transaction 하나다. 실패하면 이전 판
// 전체가 유지된다. finished 행은 trigger도 다시 못 바꾼다.

// turn 근거와 결과는 영구 참조다. 준비한 blob의 hash만 StartTurn·FinishTurn이 싣는다.
export const turnBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: "turn",
    field: "basis",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  // 고정한 resolved agent의 전체 값이다.
  defineBlobField({
    owner_kind: "turn",
    field: "resolved",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "turn",
    field: "result",
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

export type TurnCommandDeps = {
  // 정상 종료를 막는 미반영 steering이 있는지.
  hasUnappliedSteering?: (tx: Tx, turn: string) => boolean;
  // StartTurn이 고정할 한도. 없으면 같은 Tx의 공통 설정 선택(setting_choices)에서 읽는다. 호출자가
  // 보낸 한도는 이 값과 같아야 하고 다르면 거절한다.
  turnLimits?: (tx: Tx) => Result<TurnLimits>;
  // turn이 시작하고 끝날 때 `TurnStarted`·`TurnEnded`를 Bus로 낸다. 없으면 버린다.
  publish?: (event: AgentEvent) => void;
  // 시작한 입력이 Router의 call이면 그 call을 가져갔다고 알린다.
  calls?: CallSignals;
};

// 공통 설정의 저장 선택과 내장 기본값으로 다음 turn의 한도를 정한다. 설정 표를 읽지 못하면 한도를
// 알 수 없으므로 시작하지 않는다(안전하게 닫는다).
function settingsTurnLimits(tx: Tx): Result<TurnLimits> {
  const keys = Object.values(TURN_LIMIT_SETTING_KEYS);
  try {
    const rows = tx.sql.all(
      `select key, value from setting_choices
       where layer = 'common' and key in (${keys.map(() => "?").join(", ")})`,
      keys,
    );
    return effectiveTurnLimits(
      rows.map((row) => ({
        key: String(row["key"]),
        value: JSON.parse(String(row["value"])) as unknown,
      })),
    );
  } catch {
    return err({
      code: "unavailable",
      message: "turn limit settings are not readable",
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
    "turn records are machine only",
  );
}

function notFound(): Result<never> {
  return reject("not_found", "turn not found");
}

// ledger 위치. turn의 state_seq와 blob 참조의 기록 위치가 이 값이고 읽기의 as_of_seq와 같은 줄에 놓인다.
function ledgerHead(tx: Tx): number {
  const row = tx.sql.get(
    "select coalesce(max(seq), 0) as head from events",
    [],
  );
  return Math.max(1, row === undefined ? 1 : Number(row["head"]));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

// 끝내는 쓰기 하나. 정상 종료·멈춤이 같은 길로 끝난다.
export function finishRow(
  tx: Tx,
  row: Pick<TurnRow, "id" | "state_seq">,
  outcome: { kind: string; reason: string },
  result: string,
  facts: string | null,
  stopKey: string | null,
): Result<{ seq: string; finished_at: string }> {
  const finishedAt = tx.now();
  const seq = Math.max(ledgerHead(tx), Number(row.state_seq));
  tx.sql.run(
    `update turns set state = 'finished', finished_at = ?, outcome_kind = ?,
       outcome_reason = ?, result = ?, result_facts = ?, stop_request_key = ?,
       state_seq = ?
     where id = ?`,
    [
      finishedAt,
      outcome.kind,
      outcome.reason,
      result,
      facts,
      stopKey,
      seq,
      row.id,
    ],
  );
  return ok({ seq: String(seq), finished_at: finishedAt });
}

export function createTurnCommands(deps: TurnCommandDeps = {}): {
  start: CommandDefinition<typeof startTurn>;
  checkpoint: CommandDefinition<typeof checkpointTurn>;
  finish: CommandDefinition<typeof finishTurn>;
  stop: CommandDefinition<typeof stopTurn>;
} {
  return {
    start: {
      route: startTurn,
      handle(tx, ctx, input: Input<typeof startTurn>) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        // 같은 id의 재전달은 이전 결과다.
        const existing = loadTurn(tx, input.id);
        if (existing !== undefined) {
          if (
            existing.session !== input.session ||
            existing.input_message !== input.input_message
          ) {
            return reject("conflict", "turn id already used for other input");
          }
          return ok({
            id: existing.id,
            state: "running" as const,
            state_seq: existing.state_seq,
            started_at: existing.started_at,
            basis: existing.basis,
          });
        }
        const message = tx.sql.get(
          "select session, turn, call from messages where id = ?",
          [input.input_message],
        );
        if (message === undefined) {
          return reject("not_found", "input message not found");
        }
        if (String(message["session"]) !== input.session) {
          return reject("invalid_input", "the message is of another session");
        }
        if (message["turn"] !== null) {
          return reject("conflict", "the input message already started a turn");
        }
        // 한도는 현재 설정이 정한다. machine이 보낸 값을 그대로 받지 않는다.
        const limits = (deps.turnLimits ?? settingsTurnLimits)(tx);
        if (!limits.ok) {
          return err({
            code: "unavailable",
            message: "turn limits cannot be resolved",
          });
        }
        if (canonicalize(limits.value) !== canonicalize(input.limits)) {
          return reject(
            "invalid_input",
            "limits do not match the current turn limit settings",
          );
        }
        // 진행 중인 turn은 session마다 하나다.
        if (
          tx.sql.get(
            "select id from turns where session = ? and state = 'running'",
            [input.session],
          ) !== undefined
        ) {
          return reject("conflict", "the session already has a running turn");
        }
        const startedAt = tx.now();
        const seq = ledgerHead(tx);
        if (input.basis_size !== undefined) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "turn",
            owner_key: input.id,
            field: "basis",
            hash: input.basis,
            size: input.basis_size,
            purpose: TURN_BLOB_PURPOSES.turn_basis,
            seq: String(seq),
          });
          if (!registered.ok) return registered;
        }
        if (input.resolved !== undefined && input.resolved_size !== undefined) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "turn",
            owner_key: input.id,
            field: "resolved",
            hash: input.resolved,
            size: input.resolved_size,
            purpose: TURN_BLOB_PURPOSES.turn_resolved,
            seq: String(seq),
          });
          if (!registered.ok) return registered;
        }
        tx.sql.run(
          `insert into turns (id, session, input_message, state, basis,
             started_at, limits, state_seq)
           values (?, ?, ?, 'running', ?, ?, ?, ?)`,
          [
            input.id,
            input.session,
            input.input_message,
            input.basis,
            startedAt,
            JSON.stringify(input.limits),
            seq,
          ],
        );
        tx.sql.run("update messages set turn = ? where id = ?", [
          input.id,
          input.input_message,
        ]);
        // call 입력을 가져갔음을 Router에 알린다. 재시작 때 잃어버린 call을 가리는 근거다.
        if (message["call"] !== null && deps.calls !== undefined) {
          const consumed = deps.calls.consumed(
            tx,
            String(message["call"]) as Id<"cal">,
          );
          if (!consumed.ok) return consumed;
        }
        deps.publish?.({
          session: input.session,
          type: "TurnStarted",
          at: startedAt,
          payload: { turn: input.id, input_message: input.input_message },
        } as AgentEvent);
        return ok({
          id: input.id,
          state: "running" as const,
          state_seq: String(seq),
          started_at: startedAt,
          basis: input.basis,
        });
      },
    },
    checkpoint: {
      route: checkpointTurn,
      handle(tx, ctx, input: Input<typeof checkpointTurn>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const row = loadTurn(tx, input.turn);
        if (row === undefined) return notFound();
        if (row.state !== "running") {
          return reject("conflict", "only a running turn takes a checkpoint");
        }
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "turn state changed");
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
          `update turns set elapsed_active_ms = ?, elapsed_stall_ms = ?,
             elapsed_checkpoint_at = ? where id = ?`,
          [input.elapsed.active_ms, input.elapsed.stall_ms, at, row.id],
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
      route: finishTurn,
      handle(tx, ctx, input: Input<typeof finishTurn>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const row = loadTurn(tx, input.turn);
        if (row === undefined) return notFound();
        // 끝난 turn의 늦은 결과는 결과를 덮지 못한다.
        if (row.state === "finished") {
          return reject("conflict", "the turn result is already final");
        }
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "turn state changed");
        }
        const { outcome } = input;
        if (outcome.kind === "interrupted") {
          return reject("invalid_input", "interrupts go through StopTurn");
        }
        if (
          outcome.kind === "completed" &&
          deps.hasUnappliedSteering?.(tx, row.id) === true
        ) {
          return reject("conflict", "unapplied steering blocks a normal end");
        }
        const done = finishRow(tx, row, outcome, input.result, null, null);
        if (!done.ok) return done;
        publishTurnEnded(tx, deps.publish, row, outcome);
        if (input.result_size !== undefined) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "turn",
            owner_key: row.id,
            field: "result",
            hash: input.result,
            size: input.result_size,
            purpose: TURN_BLOB_PURPOSES.turn_result,
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
      route: stopTurn,
      handle(tx, ctx, input: Input<typeof stopTurn>, compare) {
        const kind = parseActor(ctx.actor)?.kind;
        if (kind !== "user" && kind !== "machine") {
          return reject("forbidden", "stopping needs a user or machine");
        }
        const row = loadTurn(tx, input.turn);
        if (row === undefined) return notFound();
        // 끝난 turn은 기존 결과를 돌려준다. 멈춤이 결과를 바꾸지 않는다.
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
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "turn state changed");
        }
        const outcome = { kind: "interrupted", reason: input.reason };
        // 모델이 쓴 본문이 없으므로 machine이 확정한 사실만 결과로 정리한다.
        const facts = { turn: row.id, session: row.session, outcome };
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
        publishTurnEnded(tx, deps.publish, row, outcome as never);
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
  };
}
