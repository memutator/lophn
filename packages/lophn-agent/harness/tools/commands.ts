import { err, ok, type Result } from "../../../base/mod.ts";
import {
  decideToolCall,
  finishToolCall,
  recordReadToolCall,
  recordToolRequest,
  registerPreparedBlob,
  RUN_BLOB_PURPOSES,
  startToolCall,
  supplementToolCall,
  toolCallDecided,
  toolCallFinished,
  toolCallRequested,
  toolCallStarted,
  toolCallSupplemented,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  defineBlobField,
  parseActor,
} from "../../../contracts/platform/mod.ts";
import type {
  BlobFieldDefinition,
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../../contracts/platform/mod.ts";
import { callColumns, callFromRow, type CallRow } from "./model.ts";

// 등록 순서: 입력 검사 → CAS 비교 → 쓰기 → event. 짧은 transaction 하나.
// 입력·출력 원문은 열에 없고 redaction을 거친 blob hash만 남는다(R15).

export const toolCallBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: "tool_call",
    field: "input",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "tool_call",
    field: "output",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
];

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "tool call not found" });
}

function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : err({
    code: "forbidden",
    message: "tool call records are machine only",
  });
}

function loadCall(tx: Tx, id: string): Result<CallRow> {
  const row = tx.sql.get(
    `select ${callColumns} from tool_calls where id = ?`,
    [id],
  );
  if (row === undefined) return notFound();
  return ok(row as CallRow);
}

function revisionOf(row: CallRow): string {
  const stored = row["state_seq"];
  return typeof stored === "bigint" ? stored.toString() : String(stored);
}

function checkRevision(
  row: CallRow,
  compare: { state_seq: string },
): Result<void> {
  return revisionOf(row) === compare.state_seq
    ? ok(undefined)
    : conflict("tool call state changed");
}

const INSERT = `insert into tool_calls (
  id, run, model_call, response_key, response_order, tool, definition_revision,
  effect, app_command, confirm, extension, input, output, retry_of, attempt,
  retry_at, decision, state, state_seq, started_at, finished_at, duration_ms,
  outcome, result
) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertCall(
  tx: Tx,
  input: Input<typeof recordToolRequest>,
  stateSeq: number,
  extra: {
    decision: string | null;
    state: "requested" | "started" | "finished";
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    outcome: string | null;
    output: string | null;
    result: string | null;
  },
): void {
  tx.sql.run(INSERT, [
    input.id,
    input.run,
    input.model_call,
    input.response_key,
    input.response_order,
    input.tool,
    input.definition_revision,
    input.effect,
    // 앱 command 원래 호출의 계약이다(app command tool만 싣는다, lophn-agent#T48).
    input.app_command === undefined
      ? null
      : JSON.stringify(input.app_command),
    input.confirm ? 1 : 0,
    input.extension === null ? null : JSON.stringify(input.extension),
    input.input,
    extra.output,
    input.retry_of,
    input.attempt,
    null,
    extra.decision,
    extra.state,
    stateSeq,
    extra.startedAt,
    extra.finishedAt,
    extra.durationMs,
    extra.outcome,
    extra.result,
  ]);
}

function duplicateRequest(
  tx: Tx,
  input: Input<typeof recordToolRequest>,
): boolean {
  const existing = tx.sql.get(
    `select id from tool_calls
     where model_call = ? and response_key = ? and attempt = ?`,
    [input.model_call, input.response_key, input.attempt],
  );
  return existing !== undefined;
}

export function createToolCommands(): {
  request: CommandDefinition<typeof recordToolRequest>;
  decide: CommandDefinition<typeof decideToolCall>;
  start: CommandDefinition<typeof startToolCall>;
  finish: CommandDefinition<typeof finishToolCall>;
  recordRead: CommandDefinition<typeof recordReadToolCall>;
  supplement: CommandDefinition<typeof supplementToolCall>;
} {
  return {
    request: {
      route: recordToolRequest,
      handle(tx, ctx, input, compare) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        if (duplicateRequest(tx, input)) {
          return conflict("tool call request already recorded");
        }
        // compare.run_state_seq·model_call_finished_seq는 호출자가 본 판이다.
        // run·model call 표는 그 concern이 소유하므로 여기서 다시 열지 않는다.
        void compare;
        const seq = tx.emit(toolCallRequested, input.id, {
          run: input.run,
          model_call: input.model_call,
          response_key: input.response_key,
          tool: input.tool,
          input: input.input,
          retry_of: input.retry_of,
        });
        if (input.input_size !== undefined) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "tool_call",
            owner_key: input.id,
            field: "input",
            hash: input.input,
            size: input.input_size,
            purpose: RUN_BLOB_PURPOSES.tool_call_input,
            seq,
          });
          if (!registered.ok) return registered;
        }
        insertCall(tx, input, 0, {
          decision: null,
          state: "requested",
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          outcome: null,
          output: null,
          result: null,
        });
        return ok({ tool_call: input.id });
      },
    },
    decide: {
      route: decideToolCall,
      handle(tx, ctx, input, compare) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const current = loadCall(tx, input.tool_call);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        if (current.value["state"] !== "requested") {
          return conflict("tool call decision needs a requested call");
        }
        if (current.value["decision"] !== null) {
          return conflict("tool call decision already recorded");
        }
        const seq = tx.emit(toolCallDecided, input.tool_call, input.decision);
        void seq;
        tx.sql.run(
          "update tool_calls set decision = ?, state_seq = ? where id = ?",
          [
            JSON.stringify(input.decision),
            Number(compare.state_seq) + 1,
            input.tool_call,
          ],
        );
        return ok({
          tool_call: input.tool_call,
          decision: input.decision.decision,
        });
      },
    },
    start: {
      route: startToolCall,
      handle(tx, ctx, input, compare) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const current = loadCall(tx, input.tool_call);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        if (current.value["state"] !== "requested") {
          return conflict("tool call already started");
        }
        if (current.value["decision"] === null) {
          return conflict("tool call needs a decision before it starts");
        }
        // 자격·범위 재검사는 실행기가 이 command 앞에서 한다. 여기서는 기록이
        // 요청 상태이고 판정이 있을 때만 진입을 남긴다.
        void compare.run_state_seq;
        void compare.assignment_revision;
        const seq = tx.emit(toolCallStarted, input.tool_call, {
          started_at: input.started_at,
          idempotency_key: input.tool_call,
        });
        void seq;
        tx.sql.run(
          `update tool_calls set state = 'started', started_at = ?, state_seq = ?
           where id = ?`,
          [input.started_at, Number(compare.state_seq) + 1, input.tool_call],
        );
        return ok({
          tool_call: input.tool_call,
          idempotency_key: input.tool_call,
        });
      },
    },
    finish: {
      route: finishToolCall,
      handle(tx, ctx, input, compare) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const current = loadCall(tx, input.tool_call);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        const state = current.value["state"];
        if (state === "finished") return conflict("tool call already finished");
        if (state === "requested" && input.outcome.kind === "success") {
          return conflict("a requested call cannot finish as success");
        }
        const seq = tx.emit(toolCallFinished, input.tool_call, {
          outcome: input.outcome,
          output: input.output,
          finished_at: input.finished_at,
        });
        if (input.output_size !== undefined && input.output !== null) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "tool_call",
            owner_key: input.tool_call,
            field: "output",
            hash: input.output,
            size: input.output_size,
            purpose: RUN_BLOB_PURPOSES.tool_call_output,
            seq,
          });
          if (!registered.ok) return registered;
        }
        tx.sql.run(
          `update tool_calls set state = 'finished', outcome = ?, output = ?,
             result = ?, finished_at = ?, duration_ms = ?, state_seq = ?
           where id = ?`,
          [
            JSON.stringify(input.outcome),
            input.output,
            input.result === null ? null : JSON.stringify(input.result),
            input.finished_at,
            input.duration_ms,
            Number(compare.state_seq) + 1,
            input.tool_call,
          ],
        );
        return ok({ tool_call: input.tool_call, outcome: input.outcome });
      },
    },
    recordRead: {
      route: recordReadToolCall,
      handle(tx, ctx, input) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const request = input.request;
        if (duplicateRequest(tx, request)) {
          return conflict("tool call request already recorded");
        }
        // 후행 기록은 실제 순서대로 네 event를 남긴다(R15). 읽기 응답은 이
        // 저장을 기다리지 않는다. 저장은 다음 model 판단 전에 한다.
        tx.emit(toolCallRequested, request.id, {
          run: request.run,
          model_call: request.model_call,
          response_key: request.response_key,
          tool: request.tool,
          input: request.input,
          retry_of: request.retry_of,
        });
        tx.emit(toolCallDecided, request.id, input.decision);
        tx.emit(toolCallStarted, request.id, {
          started_at: input.started_at,
          idempotency_key: request.id,
        });
        tx.emit(toolCallFinished, request.id, {
          outcome: input.outcome,
          output: input.output,
          finished_at: input.finished_at,
        });
        insertCall(tx, request, 0, {
          decision: JSON.stringify(input.decision),
          state: "finished",
          startedAt: input.started_at,
          finishedAt: input.finished_at,
          durationMs: input.duration_ms,
          outcome: JSON.stringify(input.outcome),
          output: input.output,
          result: JSON.stringify(input.result),
        });
        return ok({ tool_call: request.id });
      },
    },
    supplement: {
      route: supplementToolCall,
      handle(tx, ctx, input, compare) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const current = loadCall(tx, input.tool_call);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        if (current.value["state"] !== "finished") {
          return conflict("supplement needs a finished call");
        }
        const duplicate = tx.sql.get(
          `select tool_call from tool_call_supplements
           where tool_call = ? and supplement_key = ?`,
          [input.tool_call, input.supplement_key],
        );
        if (duplicate !== undefined) {
          return conflict("supplement key already recorded");
        }
        const previous = current.value["output"];
        const seq = tx.emit(toolCallSupplemented, input.tool_call, {
          previous_fact: typeof previous === "string" ? previous : input.fact,
          fact: input.fact,
          supplement_key: input.supplement_key,
        });
        tx.sql.run(
          `insert into tool_call_supplements (
             tool_call, supplement_key, fact, note, event_seq, at
           ) values (?, ?, ?, ?, ?, ?)`,
          [
            input.tool_call,
            input.supplement_key,
            input.fact,
            input.note,
            Number(seq),
            tx.now(),
          ],
        );
        // 기존 outcome은 유지한다. 보완은 행만 더한다.
        void callFromRow;
        return ok({
          tool_call: input.tool_call,
          supplement_key: input.supplement_key,
        });
      },
    },
  };
}
