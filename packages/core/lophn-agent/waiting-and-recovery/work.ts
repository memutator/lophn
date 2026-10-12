import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  applyQuestionOption,
  cancelQuestionGroup,
  correctWaitingRun,
  questionRead,
  resolveRunWait,
  runList,
  runRead,
  toolCallList,
  toolCallRead,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  approvalsGet,
  cancelApprovalRequest,
} from "../../../protocol/approvals/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import { callRevision } from "../tools/mod.ts";
import type { Admission, CallRequest, CoreCall } from "../tool-judgment/mod.ts";
import { approvalVerdict, type CallFacts } from "./model.ts";

// 사람 기다림의 결정 반영(wait resolver). command 밖의 일이고 결과는 command로 남긴다. 결정 전달은
// event나 입력 payload의 값을 믿지 않고 ledger의 현재 요청과 고정 call을 읽는다. event가 유실돼도
// 같은 읽기로 다시 만나고, 각 단계는 읽은 현재 상태에서 이어 가므로 어느 지점에서 죽어도 같은
// 결정을 한 번만 반영한다. 허락은 시작이 아니다: 재검사를 통과한 call만 시작한다.

type JudgmentPort = {
  admit(
    request: CallRequest,
    recorded: NonNullable<ToolCallOutput["decision"]>,
  ): Promise<Result<Admission>>;
  start(
    request: CallRequest,
    admission: Extract<Admission, { kind: "enter" }>,
  ): Promise<Result<string>>;
  closeUnentered(
    request: CallRequest,
    stateSeq: string,
    code: string,
  ): Promise<Result<string>>;
};

type ToolCallOutput = z.output<typeof toolCallRead.output>["tool_call"];

export type WaitWorkDeps = {
  // machine 자격의 loopback. 읽기와 대기 command를 부른다.
  machine: CoreCall;
  // tool 판정. 진입 직전 재검사와 시작, 미실행 종료를 같은 기준으로 쓴다.
  judgment: JudgmentPort;
  // 고정 call의 실제 입력(model 응답에서 온 값). 재검사는 이 입력의 현재 사실로 한다. 없으면 허락을
  // 쓰지 않는다.
  callRequest(toolCall: string): Promise<Result<CallRequest>>;
};

export const SUPERSEDED_TEXT =
  "The person sent a correction, so this request was withdrawn.";

export type WaitStep =
  // run이 기다리고 있지 않다.
  | { kind: "idle" }
  // 아직 사람의 결정이 없다.
  | { kind: "pending"; request: string }
  // 답은 받았지만 고정 action의 적용이 아직이다(접수와 적용은 다르다). 전제가 달라져 적용하지
  // 못했다면 why가 달라진 이유다.
  | { kind: "action_pending"; request: string; why?: string }
  // 미시작을 확인하지 못했다. approval을 쓰지 않고 그대로 둔다.
  | { kind: "unverified"; request: string; why: string }
  | {
    kind: "resolved";
    state: "running" | "finished";
    resolution: z.output<typeof resolveRunWait.output>["resolution"];
  };

export type CorrectionStep =
  | WaitStep
  | { kind: "corrected"; state: "running" | "finished" };

async function post<O extends z.ZodType>(
  call: CoreCall,
  route: { resource: string; method: string; output: O },
  body: unknown,
): Promise<Result<z.output<O>>> {
  const reply = await call(routePath(route), body);
  if (!reply.ok) return reply;
  const parsed = route.output.safeParse(reply.value);
  if (!parsed.success) {
    return err({ code: "unavailable", message: "unexpected core reply" });
  }
  return ok(parsed.data);
}

function factsOf(call: ToolCallOutput): CallFacts {
  return {
    state: call.state,
    entered: call.started_at !== null,
    outcome: call.outcome === null
      ? null
      : { kind: call.outcome.kind, code: call.outcome.code },
  };
}

export function createWaitResolver(deps: WaitWorkDeps) {
  async function waitingRun(run: string) {
    const read = await post(deps.machine, runRead, { run });
    if (!read.ok) return read;
    return ok(read.value.run);
  }

  async function readCall(toolCall: string): Promise<Result<ToolCallOutput>> {
    const read = await post(deps.machine, toolCallRead, {
      tool_call: toolCall,
    });
    return read.ok ? ok(read.value.tool_call) : read;
  }

  // 고정 call은 판정이 이 approval을 가리킨 call이다. RunWaited와 같은 근거를 읽는다.
  async function fixedCall(
    run: string,
    approval: string,
  ): Promise<Result<ToolCallOutput | undefined>> {
    const listed = await post(deps.machine, toolCallList, { run });
    if (!listed.ok) return listed;
    return ok(
      listed.value.tool_calls.find((call) =>
        call.decision?.approval === approval
      ),
    );
  }

  async function resolve(
    run: { id: string; state_seq: string },
    request: string,
    decisionSeq: string,
  ): Promise<Result<WaitStep>> {
    const resolved = await post(deps.machine, resolveRunWait, {
      input: { run: run.id, request, decision_seq: decisionSeq },
      idempotency_key: `${request}:${decisionSeq}:resolve`,
      compare: { state_seq: run.state_seq, waiting_on: request },
      prepared: [],
    });
    if (!resolved.ok) {
      // 답 접수와 적용은 다르다. 적용 확인 전에는 재개하지 않고 그대로 기다린다.
      if (
        resolved.error.code === "conflict" &&
        resolved.error.message.includes("not applied")
      ) return ok({ kind: "action_pending", request });
      return resolved;
    }
    return ok({
      kind: "resolved",
      state: resolved.value.state,
      resolution: resolved.value.resolution,
    });
  }

  // 사람이 고른 선택지에 고정 action이 있고 아직 적용하지 않았으면 소유 command로 적용한다.
  // 답 저장 → 적용 → ResolveRunWait는 각각 따로 확정되고 읽은 현재 사실에서
  // 이어 가므로 어느 지점에서 죽어도 적용은 한 번이다: 적용했다면 `applied`가 이미 참이라 다시
  // 부르지 않고, 적용 중 죽었다면 transaction이 통째로 되돌아가 처음부터 다시 적용한다.
  // 전제가 달라져 적용하지 못하면 답은 그대로 두고 재개하지 않는다.
  async function applyChosen(
    record: z.output<typeof questionRead.output>["group"],
  ): Promise<Result<{ applied: boolean; why?: string }>> {
    if (record.status !== "answered" || record.closed_seq === null) {
      return ok({ applied: true });
    }
    // 고정 action이 있는 선택지를 가진 질문은 질문 하나짜리 묶음이라 적용할 것은 많아야 하나다.
    for (const question of record.questions) {
      const answer = question.answer;
      if (answer === null || answer.kind !== "option") continue;
      const chosen = question.options.find((option) =>
        option.key === answer.option_key
      );
      if (chosen === undefined || chosen.action === null) continue;
      if (question.applied) continue;
      const applied = await applyOne(
        question.id,
        record.closed_seq,
        chosen.key,
        chosen.action,
      );
      if (!applied.ok || !applied.value.applied) return applied;
    }
    return ok({ applied: true });
  }

  async function applyOne(
    question: string,
    answeredSeq: string,
    key: string,
    action: z.input<typeof applyQuestionOption.input>["action"],
  ): Promise<Result<{ applied: boolean; why?: string }>> {
    const applied = await post(deps.machine, applyQuestionOption, {
      input: {
        question,
        answered_seq: answeredSeq,
        option_key: key,
        action,
        evidence: { question, option: key },
      },
      idempotency_key: `${question}:${key}:apply`,
      compare: {},
      prepared: [],
    });
    if (applied.ok) return ok({ applied: true });
    if (applied.error.code === "conflict") {
      return ok({ applied: false, why: applied.error.message });
    }
    return applied;
  }

  // 질문 묶음을 본다. 묶음 전체의 답·만료·미루기·취소만 결정이다.
  async function settleQuestion(
    run: { id: string; state_seq: string },
    request: string,
  ): Promise<Result<WaitStep>> {
    const read = await post(deps.machine, questionRead, { group: request });
    if (!read.ok) return read;
    const question = read.value.group;
    if (question.status === "pending" || question.closed_seq === null) {
      return ok({ kind: "pending", request });
    }
    const chosen = await applyChosen(question);
    if (!chosen.ok) return chosen;
    // 적용하지 못했다. 접수와 적용은 다르므로 재개하지 않는다.
    if (!chosen.value.applied) {
      return ok({
        kind: "action_pending",
        request,
        ...(chosen.value.why === undefined ? {} : { why: chosen.value.why }),
      });
    }
    return await resolve(run, request, question.closed_seq);
  }

  // 허락은 재검사를 통과한 call만 시작한다. 거절·만료·취소·재검사 실패는 call을 미실행으로
  // 닫는다. 두 경우 모두 읽은 현재 상태에서 이어 가므로 되풀이해도 한 번만 반영한다.
  async function settleApproval(
    run: { id: string; state_seq: string },
    request: string,
  ): Promise<Result<WaitStep>> {
    const read = await post(deps.machine, approvalsGet, { approval: request });
    if (!read.ok) return read;
    const approval = read.value.request;
    if (approval.status === "pending" || approval.closed_seq === null) {
      return ok({ kind: "pending", request });
    }
    const found = await fixedCall(run.id, request);
    if (!found.ok) return found;
    if (found.value === undefined) {
      return ok({
        kind: "unverified",
        request,
        why: "the fixed call is not known",
      });
    }
    const fixed = found.value;
    const request_ = (): CallRequest => ({
      toolCall: fixed.id,
      run: run.id,
      tool: fixed.tool,
      input: null,
      stateSeq: callRevision(fixed),
    });
    const verdict = approvalVerdict(approval.status, factsOf(fixed));
    if (verdict.kind === "inconsistent") {
      return ok({ kind: "unverified", request, why: verdict.why });
    }
    if (verdict.kind === "needs_close") {
      const closed = await deps.judgment.closeUnentered(
        request_(),
        callRevision(fixed),
        "human_decision",
      );
      if (!closed.ok) return closed;
    } else if (verdict.kind === "needs_recheck") {
      const entered = await recheckAndStart(
        request,
        read.value.use !== null,
        fixed,
      );
      if (!entered.ok) return entered;
      if (entered.value !== undefined) return ok(entered.value);
    }
    return await resolve(run, request, approval.closed_seq);
  }

  // 재검사를 통과하면 시작을 기록하고, 아니면 미실행으로 닫는다. 읽을 수 없는 사실이 있으면
  // 허락을 쓰지 않는다(미시작을 확인하지 못한 approval은 사용하지 않는다).
  async function recheckAndStart(
    request: string,
    used: boolean,
    fixed: ToolCallOutput,
  ): Promise<Result<WaitStep | undefined>> {
    const unverified = (why: string): Result<WaitStep> =>
      ok({ kind: "unverified", request, why });
    const given = await deps.callRequest(fixed.id);
    if (!given.ok) return unverified("the call input is not available");
    const live = await readCall(fixed.id);
    if (!live.ok) return unverified("the call state is not readable");
    if (live.value.started_at !== null || live.value.state !== "requested") {
      // 다른 경로가 이미 진입 또는 종료를 기록했다. 다시 시작하지 않고 그 사실로 잇는다.
      return ok(undefined);
    }
    const target: CallRequest = {
      ...given.value,
      stateSeq: callRevision(live.value),
    };
    const recorded = live.value.decision;
    if (recorded === null) {
      const closed = await deps.judgment.closeUnentered(
        target,
        target.stateSeq,
        "recheck_failed",
      );
      return closed.ok ? ok(undefined) : closed;
    }
    const admitted = await deps.judgment.admit(target, recorded);
    if (!admitted.ok) return unverified("the call could not be rechecked");
    const admission = admitted.value;
    if (admission.kind === "enter") {
      if (used) {
        // 이미 쓴 허락인데 진입 기록이 없다. 미시작을 확인할 수 없으므로 다시 쓰지 않는다.
        return unverified("the approval was already used");
      }
      const started = await deps.judgment.start(target, admission);
      if (!started.ok) {
        // 동시에 다른 경로가 먼저 시작했을 수 있다. 현재 상태를 다시 읽어 판단한다.
        const again = await readCall(fixed.id);
        if (again.ok && again.value.started_at !== null) return ok(undefined);
        return started;
      }
      return ok(undefined);
    }
    // 규칙 금지는 그 이유로, 그 밖의 달라진 사실은 재검사 실패로 닫는다. 허락으로 바꾸지 않는다.
    const code = admission.kind === "denied" ? "denied" : "recheck_failed";
    const closed = await deps.judgment.closeUnentered(
      target,
      target.stateSeq,
      code,
    );
    return closed.ok ? ok(undefined) : closed;
  }

  // run 하나의 기다림을 현재 ledger 사실로 한 걸음 푼다.
  async function settle(run: string): Promise<Result<WaitStep>> {
    const read = await waitingRun(run);
    if (!read.ok) return read;
    const current = read.value;
    if (current.state !== "waiting_user" || current.waiting_on === null) {
      return ok({ kind: "idle" });
    }
    const reference = { id: current.id, state_seq: current.state_seq };
    return current.waiting_on.startsWith("qgr_")
      ? await settleQuestion(reference, current.waiting_on)
      : await settleApproval(reference, current.waiting_on);
  }

  // 재시작 뒤 기다리는 run을 모두 다시 만난다. event 유실도 같은 읽기로 이어진다.
  async function recover(): Promise<Result<{ run: string; step: WaitStep }[]>> {
    const listed = await post(deps.machine, runList, { state: "waiting_user" });
    if (!listed.ok) return listed;
    const steps: { run: string; step: WaitStep }[] = [];
    for (const run of listed.value.runs) {
      const step = await settle(run.id);
      if (!step.ok) return step;
      steps.push({ run: run.id, step: step.value });
    }
    return ok(steps);
  }

  // 명시 수정으로 옛 요청을 취소하고 수정을 반영한다. 요청 소유 영역이 먼저 취소하고 고정
  // call을 미실행으로 닫은 뒤 CorrectWaitingRun이 run을 잇거나 답 없음으로 끝내며 수정 입력을
  // 새 담당에 보존한다. 사람이 이미 정한 요청(답·허락·거절)은 수정으로 덮지 않는다.
  async function correct(
    run: string,
    message: string,
  ): Promise<Result<CorrectionStep>> {
    const read = await waitingRun(run);
    if (!read.ok) return read;
    const current = read.value;
    if (current.state !== "waiting_user" || current.waiting_on === null) {
      return ok({ kind: "idle" });
    }
    const request = current.waiting_on;
    if (request.startsWith("qgr_")) {
      const question = await post(deps.machine, questionRead, {
        group: request,
      });
      if (!question.ok) return question;
      const record = question.value.group;
      if (record.status === "pending") {
        const cancelled = await post(deps.machine, cancelQuestionGroup, {
          input: {
            group: request,
            created_seq: record.created_seq,
            closed_reason: "superseded",
            closed_reason_text: SUPERSEDED_TEXT,
          },
          idempotency_key: `${request}:superseded`,
          compare: { created_seq: record.created_seq },
          prepared: [],
        });
        if (!cancelled.ok) return cancelled;
      } else if (record.closed_reason !== "superseded") {
        // 이미 사람이 정한 요청이다. 수정이 덮지 않고 그 결정을 먼저 반영한다.
        return await settleQuestion(
          { id: current.id, state_seq: current.state_seq },
          request,
        );
      }
    } else {
      const approval = await post(deps.machine, approvalsGet, {
        approval: request,
      });
      if (!approval.ok) return approval;
      const record = approval.value.request;
      if (record.status === "pending") {
        const cancelled = await post(deps.machine, cancelApprovalRequest, {
          input: {
            approval: request,
            created_seq: record.created_seq,
            closed_reason: SUPERSEDED_TEXT,
          },
          idempotency_key: `${request}:superseded`,
          compare: { created_seq: record.created_seq },
          prepared: [],
        });
        if (!cancelled.ok) return cancelled;
      } else if (record.status !== "cancelled") {
        return await settleApproval(
          { id: current.id, state_seq: current.state_seq },
          request,
        );
      }
      const found = await fixedCall(run, request);
      if (!found.ok) return found;
      if (found.value !== undefined && found.value.state === "requested") {
        const closed = await deps.judgment.closeUnentered(
          {
            toolCall: found.value.id,
            run,
            tool: found.value.tool,
            input: null,
            stateSeq: callRevision(found.value),
          },
          callRevision(found.value),
          "superseded",
        );
        if (!closed.ok) return closed;
      }
    }
    const corrected = await post(deps.machine, correctWaitingRun, {
      input: { run, message, request },
      idempotency_key: `${request}:correct:${message}`,
      compare: { state_seq: current.state_seq, waiting_on: request },
      prepared: [],
    });
    if (!corrected.ok) return corrected;
    return ok({ kind: "corrected", state: corrected.value.state });
  }

  return { settle, recover, correct };
}
