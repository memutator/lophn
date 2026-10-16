import { err, ok, type Result } from "../../../base/mod.ts";
import {
  finishModelCall,
  registerPreparedBlob,
  RUN_BLOB_PURPOSES,
  startModelCall,
  supplementModelCall,
} from "../../../protocol/lophn-agent/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
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
import { assertCall, callFromRow, type CallRow } from "./model.ts";

// 등록 순서: 입력 검사 → CAS 비교 → 쓰기. 짧은 transaction 하나. event는 쓰지 않는다.
// executor는 processed_through_seq만 검사하므로 state_seq 비교 기준은
// handler가 현재 행을 읽어 직접 본다(provider checkRevision와 같은 방식).
// 오류 본문은 어디에도 저장하지 않는다. credential 값은 참조만 남는다.

// 본문은 blob 참조만 남는다. model_call body는 용량 보존 종류다(plan blob 자리).
export const modelCallBodyFields: readonly BlobFieldDefinition[] = [
  defineBlobField({
    owner_kind: "model_call",
    field: "input",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "model_call",
    field: "context_basis",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: "model_call",
    field: "output",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
];

// ledger 위치. 시작·끝·보완의 기록 위치가 이 값이다.
function ledgerHead(tx: Tx): number {
  const row = tx.sql.get(
    "select coalesce(max(seq), 0) as head from events",
    [],
  );
  return Math.max(1, row === undefined ? 1 : Number(row["head"]));
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "model call not found" });
}

function unavailableProvider(): Result<never> {
  return err({
    code: "unavailable",
    message: "provider is not connected",
  });
}

// StartModelCall은 machine 전용 기록이다. actor 종류는 route가 이미 본다.
function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : err({
    code: "forbidden",
    message: "model call records are machine only",
  });
}

function loadCall(tx: Tx, id: string): Result<CallRow> {
  const row = tx.sql.get(
    `select id, turn, session, model_use, agent_hash, purpose,
       attempt_kind, attempt_order, retry_of,
       provider, credential_revision, model_name, protocol,
       call_model, input, context_basis, output, state, state_seq,
       started_at, finished_at, duration_ms, first_output_ms, outcome,
       usage, cost
     from model_calls where id = ?`,
    [id],
  );
  if (row === undefined) return notFound();
  return ok(row as CallRow);
}

// state_seq CAS 비교 기준. compare.state_seq가 현재 기록과 다르면 conflict다.
function checkRevision(
  row: CallRow,
  compare: { state_seq: string },
): Result<void> {
  const stored = typeof row.state_seq === "bigint"
    ? row.state_seq.toString()
    : String(row.state_seq);
  if (stored !== compare.state_seq) {
    return conflict("model call state changed");
  }
  return ok(undefined);
}

// 시작 기록 저장은 같은 transaction이다. 저장이 실패하면 command 전체가
// rollback되고 전송도 없다.
function storeStart(
  tx: Tx,
  call: ModelCallRecord,
  stateSeq: number,
  startedSeq: number,
): void {
  tx.sql.run(
    `insert into model_calls (
       id, turn, session, model_use, agent_hash, purpose,
       attempt_kind, attempt_order, retry_of,
       provider, credential_revision, model_name, protocol,
       call_model, input, context_basis, output, state, state_seq, started_seq,
       started_at, finished_at, duration_ms, first_output_ms, outcome,
       usage, cost
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      call.id,
      call.turn,
      call.session,
      call.model_use,
      call.agent_hash,
      call.purpose,
      call.attempt_kind,
      call.attempt_order,
      call.retry_of,
      call.model.provider,
      call.model.credential_revision,
      call.model.name,
      call.model.protocol,
      JSON.stringify(call.model),
      call.input,
      call.context_basis,
      call.output,
      call.state,
      stateSeq,
      startedSeq,
      call.started_at,
      call.finished_at,
      call.duration_ms,
      call.first_output_ms,
      call.outcome === null ? null : JSON.stringify(call.outcome),
      JSON.stringify(call.usage),
      JSON.stringify(call.cost),
    ],
  );
}

// 연결된 provider는 StartModelCall의 unavailable 근원이다. Disconnect한 provider에는 새 호출을 시작하지
// 않는다. 문맥 구간 기준은 call 자격 검사의 몫이다(run-loop).
function checkProvider(
  tx: Tx,
  call: ModelCallRecord,
): Result<void> {
  const row = tx.sql.get(
    "select id from providers where id = ?",
    [call.model.provider],
  );
  return row === undefined ? unavailableProvider() : ok(undefined);
}

// 처음 반영하는 수정 입력은 ModelCall 시작과 같은 transaction에서 반영한다. 반영 command는
// 입력 표를 소유한 conversation이 주입한다. 반영이 거절되면 시작 기록도 남지 않고 전송도 없다.
type UsageDeps = {
  applyMessages?: (
    tx: Tx,
    input: { messages: string[]; call: string },
  ) => Result<unknown>;
};

export function createUsageCommands(deps: UsageDeps = {}): {
  start: CommandDefinition<typeof startModelCall>;
  finish: CommandDefinition<typeof finishModelCall>;
  supplement: CommandDefinition<typeof supplementModelCall>;
} {
  return {
    start: {
      route: startModelCall,
      handle(tx, ctx, input: Input<typeof startModelCall>) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const call = assertCall(input.call);
        if (!call.ok) return call;
        // 입력 schema refine이 started·결과 없음·초기 비용 unknown 조건을 이미 본다.
        const registered = checkProvider(tx, call.value);
        if (!registered.ok) return registered;
        // 같은 id 재시작은 시도마다 한 번이다. 유니크 PK가 막기 전에
        // conflict로 내보낸다(저장 실패 rollback은 internal로 새지 않는다).
        const existing = tx.sql.get(
          "select id from model_calls where id = ?",
          [call.value.id],
        );
        if (existing !== undefined) {
          return conflict("model call attempt already recorded");
        }
        // turn이 없는 요약 call은 session마다 시도 순번이 하나다.
        if (call.value.turn === null && call.value.session !== null) {
          const sameAttempt = tx.sql.get(
            `select id from model_calls
             where session = ? and turn is null and attempt_order = ?`,
            [call.value.session, call.value.attempt_order],
          );
          if (sameAttempt !== undefined) {
            return conflict("model call attempt already recorded");
          }
        }
        const seq = ledgerHead(tx);
        // 호출자가 보낸 CAS 기준 state_seq를 저장한다. started_seq는 시작한 ledger 위치다.
        storeStart(tx, call.value, Number(input.state_seq), seq);
        // 준비한 input·basis blob의 영구 참조는 시작 기록과 같은 transaction이다.
        if (input.blob_sizes !== undefined) {
          for (
            const [field, hash, size, purpose] of [
              [
                "input",
                call.value.input,
                input.blob_sizes.input,
                RUN_BLOB_PURPOSES.model_call_input,
              ],
              [
                "context_basis",
                call.value.context_basis,
                input.blob_sizes.context_basis,
                RUN_BLOB_PURPOSES.model_call_basis,
              ],
            ] as const
          ) {
            const registered = registerPreparedBlob(tx, ctx, {
              owner_kind: "model_call",
              owner_key: call.value.id,
              field,
              hash,
              size,
              purpose,
              seq: String(seq),
            });
            if (!registered.ok) return registered;
          }
        }
        if (input.applied_messages.length > 0) {
          if (deps.applyMessages === undefined) {
            return conflict("applying messages is not connected");
          }
          const applied = deps.applyMessages(tx, {
            messages: input.applied_messages,
            call: call.value.id,
          });
          if (!applied.ok) return applied;
        }
        return ok({ call: call.value });
      },
    },
    finish: {
      route: finishModelCall,
      handle(tx, ctx, input: Input<typeof finishModelCall>, compare) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const current = loadCall(tx, input.call);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        if (current.value.state !== "started") {
          return conflict("model call was already finished");
        }
        const finishedAt = tx.now();
        const seq = ledgerHead(tx);
        if (input.output_size !== undefined && input.output !== null) {
          const registered = registerPreparedBlob(tx, ctx, {
            owner_kind: "model_call",
            owner_key: input.call,
            field: "output",
            hash: input.output,
            size: input.output_size,
            purpose: RUN_BLOB_PURPOSES.model_call_output,
            seq: String(seq),
          });
          if (!registered.ok) return registered;
        }
        tx.sql.run(
          `update model_calls set
             output = ?, state = 'finished', state_seq = ?, finished_at = ?,
             duration_ms = ?, first_output_ms = ?, outcome = ?, usage = ?, cost = ?
           where id = ?`,
          [
            input.output,
            Number(input.state_seq),
            finishedAt,
            input.duration_ms,
            input.first_output_ms,
            JSON.stringify(input.outcome),
            JSON.stringify(input.usage),
            JSON.stringify(input.cost),
            input.call,
          ],
        );
        return ok({
          call: callFromRow(current.value, {
            output: input.output,
            state: "finished",
            state_seq: String(seq),
            finished_at: finishedAt,
            duration_ms: input.duration_ms,
            first_output_ms: input.first_output_ms,
            outcome: input.outcome,
            usage: input.usage,
            cost: input.cost,
          }),
        });
      },
    },
    supplement: {
      route: supplementModelCall,
      handle(tx, ctx, input: Input<typeof supplementModelCall>, compare) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const current = loadCall(tx, input.call);
        if (!current.ok) return current;
        const same = checkRevision(current.value, compare);
        if (!same.ok) return same;
        // 보완은 finished call에서만 통과한다(domain model).
        if (current.value.state !== "finished") {
          return conflict("supplement needs a finished call");
        }
        // 끝난 본문·결과와 최초 사실·가격은 덮지 않는다. supplement 행만
        // 근거를 남긴다. 같은 supplement_key 재전송은 PK가 막는다.
        const duplicate = tx.sql.get(
          "select call from model_call_supplements where call = ? and supplement_key = ?",
          [input.call, input.supplement_key],
        );
        if (duplicate !== undefined) {
          return conflict("supplement key already recorded");
        }
        const at = tx.now();
        tx.sql.run(
          `insert into model_call_supplements (
             call, supplement_key, usage, cost, outcome, basis, seq, at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.call,
            input.supplement_key,
            input.usage === null ? null : JSON.stringify(input.usage),
            input.cost === null ? null : JSON.stringify(input.cost),
            input.outcome === null ? null : JSON.stringify(input.outcome),
            input.basis,
            ledgerHead(tx),
            at,
          ],
        );
        return ok({ call: callFromRow(current.value) });
      },
    },
  };
}

type ModelCallRecord = ReturnType<typeof callFromRow>;
