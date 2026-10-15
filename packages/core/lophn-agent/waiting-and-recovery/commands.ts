import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type acceptRun,
  type assignMessage,
  correctWaitingRun,
  recoverRun,
  resolveRunWait,
  RUN_OUTCOME_REASONS,
  runRecovered,
  runResumed,
  runWaited,
  waitRun,
} from "../../../protocol/lophn-agent/mod.ts";
import type { createApprovalRequest } from "../../../protocol/approvals/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { loadMessage } from "../session/mod.ts";
import {
  appliedOf,
  chosenActionOf,
  createQuestionCommands,
  loadGroup,
  type QuestionGroup,
} from "../tools/questions/mod.ts";
import { finishRunRow, loadRun, type RunRow } from "../run-loop/mod.ts";
import { loadToolCall } from "../tools/mod.ts";
import {
  boundaryOf,
  confirmedFactsOf,
  type ModelView,
  type ToolView,
} from "./recovery.ts";
import {
  type ApprovalFacts,
  approvalVerdict,
  type CallFacts,
  kindOf,
  loadApproval,
  loadResolution,
  questionVerdict,
  type ResolutionRow,
  waitedCall,
} from "./model.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction 하나다.
// 요청 생성과 waiting_on 연결, 결정 반영과 run 재개·종료는 각각 같은 transaction에서 확정한다.
// 결정 값은 입력으로 받지 않는다. 요청을 소유한 영역의 ledger 행(질문·approval·고정 call)만
// 읽고, `(request, decision_seq)`는 한 번만 반영한다.

export type WaitDeps = {
  // platform/approvals의 create handler. 같은 Tx에서 자격만 이 run의 agent로 바꿔 부른다. 요청자는
  // 항상 그 자격이므로 다른 actor를 대신 요청하지 못한다(core 조립이 넘긴다).
  createApproval: CommandDefinition<typeof createApprovalRequest>["handle"];
  // 수정 입력을 새 담당 run에 보존할 때 쓰는 run 접수와 메시지 이동(machine 전용 command의
  // handler). 접수·이동이 질문 종료와 같은 transaction이다.
  acceptRun: CommandDefinition<typeof acceptRun>["handle"];
  assignMessage: CommandDefinition<typeof assignMessage>["handle"];
};

type Code = "invalid_input" | "conflict" | "not_found" | "forbidden";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

function notFound(): Result<never> {
  return reject("not_found", "run not found");
}

function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : reject(
    "forbidden",
    "run waits are machine only",
  );
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

// 이 run에서 요청을 만드는 agent 자격. 요청자와 질문 소유는 항상 run의 assignment다.
function agentCtx(ctx: RequestContext, run: RunRow): RequestContext {
  return {
    ...ctx,
    actor: `agent:${run.assignment}` as RequestContext["actor"],
    run: run.id,
  };
}

function callFactsOf(tx: Tx, id: string): CallFacts | undefined {
  const call = loadToolCall(tx, id);
  if (call === undefined) return undefined;
  return {
    state: call.state,
    entered: call.started_at !== null,
    outcome: call.outcome === null
      ? null
      : { kind: call.outcome.kind, code: call.outcome.code },
  };
}

// 저장된 묶음을 WaitRun 결과의 제출 모양으로 되돌린다. 질문은 position 순서다.
function questionSubmission(group: QuestionGroup) {
  return {
    id: group.id,
    run: group.run,
    session: group.session,
    expires_at: group.expires_at,
    questions: group.questions.map((question) => ({
      id: question.id,
      group: question.group,
      position: question.position,
      prompt_blob: question.prompt_blob,
      reason_blob: question.reason_blob,
      options: JSON.parse(question.options),
      recommendation: question.recommendation === null
        ? null
        : JSON.parse(question.recommendation),
    })),
  };
}

function approvalSubmission(row: ApprovalFacts) {
  return {
    id: row.id,
    requester: row.requester,
    run: row.run,
    reason_blob: row.reason_blob,
    effect: JSON.parse(row.effect),
    action: JSON.parse(row.action),
    expires_at: row.expires_at,
  };
}

type RunOutcome = Output<typeof resolveRunWait>["outcome"];

function outcomeOf(row: RunRow): RunOutcome {
  return row.state === "finished"
    ? {
      kind: row.outcome_kind,
      reason: row.outcome_reason,
    } as RunOutcome
    : null;
}

function resolutionOutput(row: ResolutionRow) {
  return {
    run: row.run,
    request: row.request,
    decision_seq: row.decision_seq,
    tool_call: row.tool_call,
    result: row.result,
    reason: row.reason,
  } as Output<typeof resolveRunWait>["resolution"];
}

// 이미 반영한 결정의 재전달. 새 변경 없이 처음 결과를 돌려준다. 지금 run이 다른
// 요청을 기다리거나 끝났어도 그 결정의 결과는 그대로다.
function replayOutput(
  row: RunRow,
  resolution: ResolutionRow,
): Output<typeof resolveRunWait> {
  const terminal = resolution.result === "stopped_no_answer" ||
    resolution.result === "ignored_finished";
  const outcome: RunOutcome = terminal
    ? resolution.result === "stopped_no_answer"
      ? { kind: "stopped", reason: "no_answer" } as RunOutcome
      : outcomeOf(row)
    : null;
  return {
    run: row.id,
    state: terminal ? "finished" : "running",
    state_seq: terminal && resolution.result === "ignored_finished"
      ? row.state_seq
      : resolution.resolved_seq as string,
    resolution: resolutionOutput(resolution),
    outcome,
  };
}

function recordResolution(
  tx: Tx,
  row: {
    run: string;
    request: string;
    decision_seq: string;
    tool_call: string | null;
    result: string;
    reason: string;
    resolved_seq: string | null;
  },
): void {
  tx.sql.run(
    `insert into run_wait_resolutions
       (run, request, decision_seq, tool_call, result, reason, resolved_seq)
     values (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.run,
      row.request,
      Number(row.decision_seq),
      row.tool_call,
      row.result,
      row.reason,
      row.resolved_seq === null ? null : Number(row.resolved_seq),
    ],
  );
}

function loadAssignmentState(
  tx: Tx,
  id: string,
): { state: string; revision: number } | undefined {
  const row = tx.sql.get(
    "select state, revision from assignments where id = ?",
    [id],
  );
  return row === undefined
    ? undefined
    : { state: String(row["state"]), revision: Number(row["revision"]) };
}

// 질문 소유 영역의 결정 사실. 보이지 않거나 다른 run의 것은 없는 것과 같다.
type Decision =
  | { kind: "question"; row: QuestionGroup }
  | { kind: "approval"; row: ApprovalFacts };

function loadDecision(
  tx: Tx,
  request: string,
  run: string,
): Decision | undefined {
  if (kindOf(request) === "question") {
    const row = loadGroup(tx, request);
    return row === undefined || row.run !== run
      ? undefined
      : { kind: "question", row };
  }
  const row = loadApproval(tx, request);
  return row === undefined || row.run !== run
    ? undefined
    : { kind: "approval", row };
}

function closedSeqOf(decision: Decision): string | null {
  return decision.row.closed_seq;
}

type Base = {
  run: string;
  request: string;
  decision_seq: string;
  tool_call: string | null;
};

// 같은 run을 재개한다. RunResumed·반영 기록·run 상태가 한 transaction이다.
function resumeWith(
  tx: Tx,
  run: RunRow,
  base: Base,
  result: "resumed" | "call_started" | "call_not_executed",
  reason: string,
): Result<string> {
  const resolution = { ...base, result, reason };
  const seq = tx.emit(runResumed, run.id, {
    request: base.request,
    decision_seq: base.decision_seq,
    resolution: resolution as never,
  });
  recordResolution(tx, { ...resolution, resolved_seq: seq });
  // 기다린 시간은 active·stall에 세지 않는다. 재개 시각을 마지막 확인 시각으로 삼아 이후 재시작이
  // 기다린 시간을 중단 시간으로 더하지 않게 한다.
  const resumedAt = tx.now();
  tx.sql.run(
    `update runs set state = 'running', waiting_on = null, state_seq = ?,
       elapsed_checkpoint_at = case
         when elapsed_checkpoint_at is null or elapsed_checkpoint_at < ?
         then ? else elapsed_checkpoint_at end
     where id = ?`,
    [Number(seq), resumedAt, resumedAt, run.id],
  );
  return ok(seq);
}

function settled(
  tx: Tx,
  runId: string,
  base: Base,
): Result<Output<typeof resolveRunWait>> {
  const row = loadRun(tx, runId);
  const resolution = loadResolution(tx, base.request, base.decision_seq);
  if (row === undefined || resolution === undefined) {
    return reject("conflict", "the resolution was not stored");
  }
  return ok(replayOutput(row, resolution));
}

function stopNoAnswer(
  tx: Tx,
  run: RunRow,
): Result<{ seq: string }> {
  const outcome = { kind: "stopped", reason: "no_answer" };
  const facts = {
    run: run.id,
    assignment: run.assignment,
    started: run.started_at !== null,
    outcome,
  };
  const done = finishRunRow(
    tx,
    run,
    outcome,
    sha256(facts),
    canonicalize(facts),
    null,
  );
  return done.ok ? ok({ seq: done.value.seq }) : done;
}

function loadModelViews(tx: Tx, run: string): ModelView[] {
  return tx.sql.all(
    `select id, attempt_order, state, json_extract(outcome, '$.kind') as kind
     from model_calls where run = ? order by attempt_order`,
    [run],
  ).map((row) => ({
    id: String(row["id"]),
    attempt_order: Number(row["attempt_order"]),
    state: String(row["state"]) as ModelView["state"],
    outcome_kind: row["kind"] === null ? null : String(row["kind"]),
  }));
}

function loadToolViews(tx: Tx, run: string): ToolView[] {
  return tx.sql.all(
    `select id, model_call, response_key, response_order, attempt, effect,
       extension, state, json_extract(outcome, '$.kind') as kind
     from tool_calls where run = ? order by model_call, response_order, attempt`,
    [run],
  ).map((row) => ({
    id: String(row["id"]),
    model_call: String(row["model_call"]),
    response_key: String(row["response_key"]),
    response_order: Number(row["response_order"]),
    attempt: Number(row["attempt"]),
    effect: String(row["effect"]) as ToolView["effect"],
    extension: row["extension"] === null
      ? null
      : JSON.parse(String(row["extension"])),
    state: String(row["state"]) as ToolView["state"],
    outcome_kind: row["kind"] === null ? null : String(row["kind"]),
  }));
}

const FAILED_REASONS: ReadonlySet<string> = new Set(
  RUN_OUTCOME_REASONS.failed,
);

export function createWaitCommands(deps: WaitDeps): {
  wait: CommandDefinition<typeof waitRun>;
  resolve: CommandDefinition<typeof resolveRunWait>;
  correct: CommandDefinition<typeof correctWaitingRun>;
  recover: CommandDefinition<typeof recoverRun>;
} {
  const questions = createQuestionCommands();
  return {
    wait: {
      route: waitRun,
      handle(tx, ctx, input: Input<typeof waitRun>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const run = loadRun(tx, input.run);
        if (run === undefined) return notFound();
        if (run.state === "finished") {
          return reject("conflict", "the run is finished");
        }
        if (run.state !== "running") {
          return reject("conflict", "only a running run waits");
        }
        if (run.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        const assignment = loadAssignmentState(tx, run.assignment);
        if (assignment === undefined) return notFound();
        if (assignment.state !== "enabled") {
          return reject("forbidden", "the assignment is not enabled");
        }
        if (input.call !== null) {
          const call = loadToolCall(tx, input.call);
          if (call === undefined || call.run !== run.id) {
            return reject("not_found", "tool call not found");
          }
          if (call.state !== "requested") {
            return reject("conflict", "the fixed call is not waiting to start");
          }
        }
        const acting = agentCtx(ctx, run);
        const request = input.request;
        let waitingOn: string;
        let submitted: Output<typeof waitRun>["request"];
        if (request.kind === "question") {
          // 질문 묶음은 run의 assignment가 만든다. 이미 같은 내용으로 있으면 그것을 잇는다.
          const created = questions.create.handle(
            tx,
            acting,
            request.input,
            {},
          );
          if (!created.ok) return created;
          const stored = loadGroup(tx, request.input.id);
          if (stored === undefined) {
            return reject("conflict", "the question group was not stored");
          }
          if (stored.status !== "pending") {
            return reject("conflict", "the question group is already closed");
          }
          waitingOn = stored.id;
          submitted = { kind: "question", input: questionSubmission(stored) };
        } else {
          const requestInput = request.input;
          const existing = loadApproval(tx, requestInput.id);
          if (existing === undefined) {
            const created = deps.createApproval(tx, acting, requestInput, {});
            if (!created.ok) return created;
          } else {
            // 이미 만든 approval(판정이 먼저 만든 것)은 같은 run·같은 정확한 동작일 때만 잇는다.
            if (
              existing.status !== "pending" ||
              existing.run !== run.id ||
              existing.requester !== acting.actor ||
              existing.binding_hash !== requestInput.action.binding_hash
            ) {
              return reject(
                "conflict",
                "the approval is not a pending request of this run's action",
              );
            }
          }
          const stored = loadApproval(tx, requestInput.id);
          if (stored === undefined) {
            return reject("conflict", "the approval was not stored");
          }
          const call = loadToolCall(tx, request.tool_call);
          if (call === undefined || call.run !== run.id) {
            return reject("not_found", "tool call not found");
          }
          if (call.state !== "requested") {
            return reject("conflict", "the fixed call is not waiting to start");
          }
          // 판정이 이미 기록됐다면 이 approval을 가리키는 ask여야 한다.
          if (call.decision !== null) {
            if (
              call.decision.decision !== "ask" ||
              (call.decision.approval !== null &&
                call.decision.approval !== stored.id)
            ) {
              return reject(
                "conflict",
                "the call decision does not wait on this approval",
              );
            }
          }
          waitingOn = stored.id;
          submitted = {
            kind: "approval",
            tool_call: request.tool_call,
            input: approvalSubmission(stored),
          };
        }
        const seq = tx.emit(runWaited, run.id, {
          request: waitingOn,
          call: input.call,
          waited_at: tx.now(),
        });
        tx.sql.run(
          `update runs set state = 'waiting_user', waiting_on = ?, state_seq = ?
           where id = ?`,
          [waitingOn, Number(seq), run.id],
        );
        return ok({
          run: run.id,
          state: "waiting_user" as const,
          state_seq: seq,
          waiting_on: waitingOn,
          request: submitted,
        } as Output<typeof waitRun>);
      },
    },
    resolve: {
      route: resolveRunWait,
      handle(tx, ctx, input: Input<typeof resolveRunWait>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const run = loadRun(tx, input.run);
        if (run === undefined) return notFound();
        // 이미 반영한 결정은 처음 결과다. 같은 결정은 두 번 쓰이지 않는다.
        const prior = loadResolution(tx, input.request, input.decision_seq);
        if (prior !== undefined) {
          if (prior.run !== run.id) return notFound();
          return ok(replayOutput(run, prior));
        }
        const decision = loadDecision(tx, input.request, run.id);
        if (decision === undefined) return notFound();
        const closedSeq = closedSeqOf(decision);
        if (decision.row.status === "pending" || closedSeq === null) {
          return reject("conflict", "the request has no decision yet");
        }
        if (closedSeq !== input.decision_seq) {
          return reject("conflict", "the decision is not the current one");
        }
        const waited = waitedCall(tx, run.id, input.request);
        if (!waited.found) {
          return reject("conflict", "the run never waited on this request");
        }
        if (decision.kind === "approval" && waited.call === null) {
          return reject("conflict", "the approval has no fixed call");
        }
        const toolCall = decision.kind === "approval" ? waited.call : null;
        const base = {
          run: run.id,
          request: input.request,
          decision_seq: input.decision_seq,
          tool_call: toolCall,
        };
        // 끝난 run의 늦은 결정은 새 동작에 쓰지 않는다. 접수만 기록한다.
        if (run.state === "finished") {
          if (run.state_seq !== compare.state_seq) {
            return reject("conflict", "run state changed");
          }
          recordResolution(tx, {
            ...base,
            result: "ignored_finished",
            reason: "run_finished",
            resolved_seq: null,
          });
          return settled(tx, run.id, base);
        }
        if (run.state !== "waiting_user") {
          return reject("conflict", "the run is not waiting");
        }
        if (
          run.waiting_on !== input.request ||
          compare.waiting_on !== input.request
        ) {
          return reject("conflict", "the run waits on another request");
        }
        if (run.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        const assignment = loadAssignmentState(tx, run.assignment);
        if (assignment === undefined) return notFound();
        if (decision.kind === "question") {
          const chosen = chosenActionOf(decision.row);
          const verdict = questionVerdict({
            status: decision.row.status,
            chosenHasAction: chosen !== undefined,
            applied: chosen !== undefined &&
              appliedOf(tx, decision.row, chosen.question),
          });
          if (verdict.kind === "pending") {
            return reject("conflict", "the request has no decision yet");
          }
          if (verdict.kind === "action_pending") {
            // 답 접수는 적용이 아니다. 고정 action을 적용한 결과를 확인하기 전에는 잇지 않는다.
            return reject(
              "conflict",
              "the answer is accepted but its action is not applied yet",
            );
          }
          if (verdict.kind === "stop") {
            const done = stopNoAnswer(tx, run);
            if (!done.ok) return done;
            recordResolution(tx, {
              ...base,
              result: verdict.result,
              reason: verdict.reason,
              resolved_seq: done.value.seq,
            });
            return settled(tx, run.id, base);
          }
          const resumed = resumeWith(
            tx,
            run,
            base,
            verdict.result,
            verdict.reason,
          );
          if (!resumed.ok) return resumed;
          return settled(tx, run.id, base);
        }
        const call = callFactsOf(tx, toolCall as string);
        const verdict = approvalVerdict(decision.row.status, call);
        if (verdict.kind === "pending") {
          return reject("conflict", "the request has no decision yet");
        }
        if (verdict.kind === "needs_recheck") {
          return reject(
            "conflict",
            "the grant is accepted but the fixed call is not rechecked yet",
          );
        }
        if (verdict.kind === "needs_close") {
          return reject(
            "conflict",
            "the fixed call is not closed as not executed yet",
          );
        }
        if (verdict.kind === "inconsistent") {
          return reject("conflict", verdict.why);
        }
        const resumed = resumeWith(
          tx,
          run,
          base,
          verdict.result,
          verdict.reason,
        );
        if (!resumed.ok) return resumed;
        return settled(tx, run.id, base);
      },
    },
    correct: {
      route: correctWaitingRun,
      handle(tx, ctx, input: Input<typeof correctWaitingRun>, compare) {
        const kind = parseActor(ctx.actor)?.kind;
        if (kind !== "user" && kind !== "machine") {
          return reject("forbidden", "a correction needs a user or machine");
        }
        const run = loadRun(tx, input.run);
        if (run === undefined) return notFound();
        if (run.state !== "waiting_user") {
          return reject("conflict", "the run is not waiting");
        }
        if (
          run.waiting_on !== input.request ||
          compare.waiting_on !== input.request
        ) {
          return reject("conflict", "the run waits on another request");
        }
        if (run.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        // 명시 수정만 옛 요청을 취소한다. 일반 메시지는 기다림을 풀지 않는다.
        // 받은 메시지 기록이 steer와 turn으로 바뀌어 옛 correction 열이 없다. 이 길은 새 대기 흐름이 설 때까지 막혀 있다.
        const message = loadMessage(tx, input.message) as
          | {
            id: string;
            state_seq: string;
            session: string;
            actor?: string;
            mode?: string;
            run?: string;
            applied_at_call?: string | null;
          }
          | undefined;
        if (
          message === undefined || message.actor !== "user" ||
          message.mode !== "correction" || message.run !== run.id ||
          message.session !== run.session
        ) {
          return reject("not_found", "correction not found");
        }
        if (message.applied_at_call !== null) {
          return reject("conflict", "the correction was already applied");
        }
        const decision = loadDecision(tx, input.request, run.id);
        if (decision === undefined) return notFound();
        const closedSeq = closedSeqOf(decision);
        // 옛 요청은 요청 소유 영역이 먼저 취소해 둔다(질문은 superseded, approval은 취소). 사람의
        // 답·허락·거절이나 아직 열린 요청을 수정으로 덮지 않는다.
        const cancelled = decision.kind === "question"
          ? decision.row.status === "cancelled" &&
            decision.row.closed_reason === "superseded"
          : decision.row.status === "cancelled";
        if (!cancelled || closedSeq === null) {
          return reject(
            "conflict",
            "cancel the old request before applying the correction",
          );
        }
        const waited = waitedCall(tx, run.id, input.request);
        if (!waited.found) {
          return reject("conflict", "the run never waited on this request");
        }
        const toolCall = decision.kind === "approval" ? waited.call : null;
        if (decision.kind === "approval") {
          const call = toolCall === null
            ? undefined
            : callFactsOf(tx, toolCall);
          if (
            call === undefined || call.state !== "finished" || call.entered ||
            call.outcome?.kind !== "not_executed"
          ) {
            return reject(
              "conflict",
              "the fixed call is not closed as not executed yet",
            );
          }
        }
        const base = {
          run: run.id,
          request: input.request,
          decision_seq: closedSeq,
          tool_call: toolCall,
        };
        if (decision.kind === "approval") {
          // 옛 approval 취소는 미실행 뒤 같은 run의 새 판단이다. 수정은 같은 run에 남는다.
          const resumed = resumeWith(
            tx,
            run,
            base,
            "call_not_executed",
            "superseded",
          );
          if (!resumed.ok) return resumed;
          return ok({
            run: run.id,
            state: "running" as const,
            state_seq: resumed.value,
            request: input.request,
          });
        }
        // 옛 질문 취소는 답 없음 종료다. 수정 입력은 같은 transaction에서 새 담당 run에 보존한다.
        const assignment = loadAssignmentState(tx, run.assignment);
        if (assignment === undefined) return notFound();
        if (run.session === null) {
          return reject("invalid_input", "a correction needs a session");
        }
        const done = stopNoAnswer(tx, run);
        if (!done.ok) return done;
        recordResolution(tx, {
          ...base,
          result: "stopped_no_answer",
          reason: "superseded",
          resolved_seq: done.value.seq,
        });
        const machine = { ...ctx, actor: "machine" } as RequestContext;
        const next = tx.newId("run");
        const accepted = deps.acceptRun(tx, machine, {
          id: next,
          assignment: run.assignment,
          session: run.session,
          source: { kind: "message", message: message.id },
          continued_from: null,
          start_after: run.id,
        }, { assignment_revision: assignment.revision });
        if (!accepted.ok) return accepted;
        const moved = deps.assignMessage(tx, machine, {
          message: message.id,
          run: next,
        }, {
          previous_run: run.id,
          message_state_seq: message.state_seq,
          applied_at_call: null,
        });
        if (!moved.ok) return moved;
        return ok({
          run: run.id,
          state: "finished" as const,
          state_seq: done.value.seq,
          request: input.request,
        });
      },
    },
    recover: {
      route: recoverRun,
      // 복구가 ledger에서 확정한 경계(RecoveryBasis)를 한 번 기록한다. 경계는 ledger의 model·tool call
      // 행에서 다시 계산해 입력과 같을 때만 받는다. 한도 시간은 줄지 않고 run 전체를 처음부터
      // 반복하거나 멈춘 assignment를 풀지 않는다.
      handle(tx, ctx, input: Input<typeof recoverRun>, compare) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const run = loadRun(tx, input.run);
        if (run === undefined) return notFound();
        if (run.state_seq !== compare.state_seq) {
          return reject("conflict", "run state changed");
        }
        const models = loadModelViews(tx, run.id);
        const tools = loadToolViews(tx, run.id);
        const found = boundaryOf(run, models, tools);
        if (found.boundary !== input.boundary || found.call !== input.call) {
          return reject(
            "conflict",
            "the recovery basis does not match the stored boundary",
          );
        }
        const head = tx.sql.get(
          "select coalesce(max(seq), 0) as seq from events",
          [],
        );
        if (BigInt(input.basis_seq) > BigInt(String(head?.["seq"] ?? 0))) {
          return reject(
            "conflict",
            "the recovery basis is newer than the ledger",
          );
        }
        const known = new Set([
          ...models.filter((call) => call.state === "finished").map((call) =>
            call.id
          ),
          ...tools.filter((call) => call.state === "finished").map((call) =>
            call.id
          ),
        ]);
        if (input.confirmed_results.some((id) => !known.has(id))) {
          return reject("conflict", "a confirmed result is not stored");
        }
        const output = (seq: string, outcome: RunOutcome | null) => ({
          run: run.id,
          state_seq: seq,
          basis: input,
          outcome,
        } as Output<typeof recoverRun>);
        if (run.state === "finished") {
          // 끝난 run은 감사 기록만 남긴다. 결과를 바꾸거나 다시 열지 않는다.
          tx.emit(runRecovered, run.id, input);
          return ok(output(run.state_seq, outcomeOf(run) as never));
        }
        if (run.state === "accepted" || run.state === "waiting_user") {
          if (input.resolution !== "resume") {
            return reject(
              "conflict",
              "only a running run is finished by recovery",
            );
          }
          tx.emit(runRecovered, run.id, input);
          return ok(output(run.state_seq, null));
        }
        const assignment = loadAssignmentState(tx, run.assignment);
        if (assignment === undefined) return notFound();
        if (assignment.state !== "enabled") {
          return reject("forbidden", "the assignment is not enabled");
        }
        const at = input.elapsed.checkpoint_at;
        if (
          input.elapsed.active_ms < run.elapsed_active_ms ||
          input.elapsed.stall_ms < run.elapsed_stall_ms ||
          at === null ||
          (run.elapsed_checkpoint_at !== null && at < run.elapsed_checkpoint_at)
        ) {
          return reject(
            "invalid_input",
            "recovery cannot reduce the elapsed limits",
          );
        }
        tx.sql.run(
          `update runs set elapsed_active_ms = ?, elapsed_stall_ms = ?,
             elapsed_checkpoint_at = ? where id = ?`,
          [input.elapsed.active_ms, input.elapsed.stall_ms, at, run.id],
        );
        const seq = tx.emit(runRecovered, run.id, input);
        if (input.resolution === "resume") {
          tx.sql.run("update runs set state_seq = ? where id = ?", [
            Number(seq),
            run.id,
          ]);
          return ok(output(seq, null));
        }
        // 끝냄은 확정한 사실로만 정리한다. model을 다시 부르지 않는다.
        if (!FAILED_REASONS.has(input.reason)) {
          return reject("invalid_input", "recovery ends with a failed reason");
        }
        const outcome = { kind: "failed", reason: input.reason };
        const facts = {
          run: run.id,
          assignment: run.assignment,
          started: true,
          outcome,
          recovered: { boundary: input.boundary, call: input.call },
          confirmed: confirmedFactsOf(tools),
        };
        const done = finishRunRow(
          tx,
          run,
          outcome,
          sha256(facts),
          canonicalize(facts),
          null,
        );
        if (!done.ok) return done;
        return ok(output(done.value.seq, outcome as RunOutcome));
      },
    },
  };
}
