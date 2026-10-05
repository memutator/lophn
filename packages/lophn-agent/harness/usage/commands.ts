import { err, ok, type Result } from "../../../base/mod.ts";
import {
  finishModelCall,
  modelCallFinished,
  modelCallStarted,
  modelCallSupplemented,
  startModelCall,
  supplementModelCall,
} from "../../../contracts/lophn-agent/mod.ts";
import { parseActor } from "../../../contracts/platform/mod.ts";
import type { Input, RequestContext } from "../../../contracts/platform/mod.ts";
import type {
  BlobFieldDefinition,
  CommandDefinition,
  Tx,
} from "../../../contracts/platform/mod.ts";
import { defineBlobField } from "../../../contracts/platform/mod.ts";
import { assertCall, callFromRow, type CallRow } from "./model.ts";

// 등록 순서: 입력 검사 → CAS 비교 → 쓰기 → event. 짧은 transaction 하나.
// executor는 processed_through_seq만 검사하므로 state_seq 비교 기준은
// handler가 현재 행을 읽어 직접 본다(provider checkRevision와 같은 방식).
// 오류 본문은 어디에도 저장하지 않는다(R3). credential 값은 참조만 남는다(R2).

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
    field: "output",
    retention: { kind: "capacity", category: "model_call_body" },
    general_read: false,
  }),
];

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "model call not found" });
}

function unavailableProvider(): Result<never> {
  return err({
    code: "unavailable",
    message: "provider or credential is not registered",
  });
}

// StartModelCall은 machine 전용 기록이다(R1). actor 종류는 route가 이미 본다.
function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : err({
    code: "forbidden",
    message: "model call records are machine only",
  });
}

function loadCall(tx: Tx, id: string): Result<CallRow> {
  const row = tx.sql.get(
    `select id, run, session, model_use, preset, purpose, test_request,
       attempt_kind, attempt_order, retry_of, credential_change_of,
       provider, credential_key, credential_revision, model_name, protocol,
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
// rollback되고 전송도 없다(R1).
function storeStart(tx: Tx, call: ModelCallRecord, stateSeq: number): void {
  tx.sql.run(
    `insert into model_calls (
       id, run, session, model_use, preset, purpose, test_request,
       attempt_kind, attempt_order, retry_of, credential_change_of,
       provider, credential_key, credential_revision, model_name, protocol,
       call_model, input, context_basis, output, state, state_seq,
       started_at, finished_at, duration_ms, first_output_ms, outcome,
       usage, cost
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      call.id,
      call.run,
      call.session,
      call.model_use,
      call.preset === null ? null : JSON.stringify(call.preset),
      call.purpose,
      call.test_request === null ? null : JSON.stringify(call.test_request),
      call.attempt_kind,
      call.attempt_order,
      call.retry_of,
      call.credential_change_of,
      call.model.provider,
      call.model.credential_key,
      call.model.credential_revision,
      call.model.name,
      call.model.protocol,
      JSON.stringify(call.model),
      call.input,
      call.context_basis,
      call.output,
      call.state,
      stateSeq,
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

// provider와 credential 등록은 StartModelCall의 unavailable 근원이다. 문맥
// 구간 기준은 call 자격 검사의 몫이다(run-loop, Q5).
function checkProvider(
  tx: Tx,
  call: ModelCallRecord,
): Result<void> {
  const row = tx.sql.get(
    "select id, enabled from providers where id = ?",
    [call.model.provider],
  );
  if (row === undefined) return unavailableProvider();
  if (!boolOf(row["enabled"])) {
    return unavailableProvider();
  }
  return ok(undefined);
}

function boolOf(value: unknown): boolean {
  return value === 1 || value === 1n || value === true;
}

export function createUsageCommands(): {
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
        // 입력 schema refine이 started·결과 없음·초기 비용 unknown·test
        // timeout 조건을 이미 본다. connection_test는 명시 user 요청이며
        // 가짜 run·세션은 없다(테이블 check와 입력 refine이 같이 본다).
        const registered = checkProvider(tx, call.value);
        if (!registered.ok) return registered;
        // 같은 id 재시작은 R1의 시도마다 한 번이다. 유니크 PK가 막기 전에
        // conflict로 내보낸다(저장 실패 rollback은 internal로 새지 않는다).
        const existing = tx.sql.get(
          "select id from model_calls where id = ?",
          [call.value.id],
        );
        if (existing !== undefined) {
          return conflict("model call attempt already recorded");
        }
        const seq = tx.emit(modelCallStarted, call.value.id, {
          run: call.value.run,
          session: call.value.session,
          model_use: call.value.model_use,
          purpose: call.value.purpose,
          model: call.value.model,
          input: call.value.input,
          context_basis: call.value.context_basis,
        });
        // 호출자가 보낸 CAS 기준 state_seq를 저장한다. emit seq는 event 순번이고
        // 기록의 판 순번과는 다르다(compare가 같은 값을 다시 보낼 수 있어야 한다).
        void seq;
        storeStart(tx, call.value, Number(input.state_seq));
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
        const seq = tx.emit(modelCallFinished, input.call, {
          outcome: input.outcome,
          output: input.output,
          usage: input.usage,
          cost: input.cost,
          duration_ms: input.duration_ms,
          first_output_ms: input.first_output_ms,
        });
        void seq;
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
            state_seq: seq,
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
      handle(tx, ctx, input: Input<typeof supplementModelCall>) {
        const trusted = requireMachine(ctx);
        if (!trusted.ok) return trusted;
        const current = loadCall(tx, input.call);
        if (!current.ok) return current;
        // 보완은 finished call에서만 통과한다(domain model).
        if (current.value.state !== "finished") {
          return conflict("supplement needs a finished call");
        }
        // 끝난 본문·결과와 최초 사실·가격은 덮지 않는다(R9). supplement 행만
        // 근거를 남긴다. 같은 supplement_key 재전송은 PK가 막는다.
        const duplicate = tx.sql.get(
          "select call from model_call_supplements where call = ? and supplement_key = ?",
          [input.call, input.supplement_key],
        );
        if (duplicate !== undefined) {
          return conflict("supplement key already recorded");
        }
        const at = tx.now();
        // 세 시점 가격 판은 call 행에 남아 있다. previous_basis는 확인 시각이
        // 아니라 그 판의 revision이다(sha256은 아니지만 event payload는 열
        // 검사가 이미 본다). 판이 없으면 null이다.
        const seq = tx.emit(modelCallSupplemented, input.call, {
          supplement_key: input.supplement_key,
          previous_basis: null,
        });
        tx.sql.run(
          `insert into model_call_supplements (
             call, supplement_key, usage, cost, outcome, basis, event_seq, at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.call,
            input.supplement_key,
            input.usage === null ? null : JSON.stringify(input.usage),
            input.cost === null ? null : JSON.stringify(input.cost),
            input.outcome === null ? null : JSON.stringify(input.outcome),
            input.basis,
            Number(seq),
            at,
          ],
        );
        return ok({ call: callFromRow(current.value) });
      },
    },
  };
}

type ModelCallRecord = ReturnType<typeof callFromRow>;
