import type { z } from "zod";
import {
  type Clock,
  err,
  fingerprint,
  formatAt,
  type IdSource,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  assignmentRead,
  decideToolCall,
  finishToolCall,
  runRead,
  startToolCall,
  type ToolDecision,
} from "../../../contracts/lophn-agent/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../../contracts/apps/mod.ts";
import {
  applyApprovedAction,
  type ApprovalAction,
  approvalBindingHash,
  type ApprovalRequest,
  approvalsGet,
  approvalsList,
  createApprovalRequest,
  type JsonObject,
  routePath,
} from "../../../contracts/platform/mod.ts";
import {
  checkInput,
  findTool,
  type RunCredential,
  type ToolDefinition,
  unchanged,
} from "../tools/mod.ts";
import {
  type BasisSnapshot,
  type CallFacts,
  judge,
  type Judgment,
  type Origin,
  refusalKey,
  type Reversibility,
  sameBasis,
  sameLineage,
} from "./model.ts";

// 호출 판정과 진입 직전 재검사. command 밖의 일이고 결과는 command로 남긴다. 판정은 model.ts의
// 판정표가 하고 여기는 사실을 읽고 기록과 approval 생성·적용을 잇는다. model의 말은 어느
// 사실에도 들어오지 않는다(R7). core 읽기와 command는 주입한 호출로만 한다.

export type CoreCall = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;

// 소유 계약이 입력에서 읽은 정확한 동작. 모르거나 읽지 못하면 err이고 deny다(R2).
export type ResolvedAction = {
  concern: string;
  // 소유 command 이름. approval의 동작 이름과 같다.
  operation: string;
  contractRevision: string;
  targets: readonly { id: string; reversibility: Reversibility }[];
  // 쓰기 계약이 요구하는 정확한 대상 CAS.
  comparison: JsonObject;
  // approval 화면의 변경·되돌림 설명. 실행기가 해석한 값이고 model의 말이 아니다.
  changes: string;
  external: string | null;
  reversibility: string;
  // 사람이 확인해야 하는 앱 command(confirm)의 접수 입력에서 approval ID를 뺀 값이다. 있으면 approval
  // request의 동작이 접수 command(`invocation.accept_confirm`) 자체라서, agent의 사전 질문과 앱의
  // confirm이 같은 approval 하나다(apps/invocations#R7, platform/approvals#R8).
  confirm?: Omit<InvocationAcceptConfirmInput, "approval">;
};

export type CallRef = { run: string; toolCall: string };

export type ToolBinding = {
  // 현재 사실로 소유 계약의 동작을 읽는다. 읽지 못하거나 정의가 만들어진 계약과 달라졌으면 err이고
  // 호출은 deny다(R2, R6).
  resolve(
    input: unknown,
    call: CallRef,
  ): Result<ResolvedAction> | Promise<Result<ResolvedAction>>;
};

export type JudgmentDeps = {
  clock: Clock;
  ids: IdSource;
  // machine 자격의 loopback. 읽기와 ToolCall·approval 적용 command를 부른다.
  machine: CoreCall;
  // 이 run에 묶인 agent 자격. approval request만 이 자격으로 만든다(요청자는 자격과 같다).
  agent: CoreCall;
  assignment: string;
  credential: RunCredential;
  // run이 고정한 제공 목록과 각 tool의 소유 계약 연결.
  listed: readonly ToolDefinition[];
  bindings: ReadonlyMap<string, ToolBinding>;
  // 외부 MCP tool의 현재 연결 설정 판. 연결이 사라졌으면 undefined.
  mcpConnection(definition: ToolDefinition): { revision: number } | undefined;
  // 질문 기한. 숫자는 요구가 정하지 않아 호출자가 정한다.
  approvalTtlMs: number;
};

export type CallRequest = {
  toolCall: string;
  run: string;
  tool: string;
  input: unknown;
  // ToolCall의 현재 state_seq. 호출자가 기록한 판을 그대로 넘긴다.
  stateSeq: string;
};

type Gathered = {
  facts: CallFacts;
  basis: BasisSnapshot | null;
  resolved: ResolvedAction | null;
  input: JsonObject | null;
  assignmentRevision: number | null;
  presetRevision: number | null;
  runStateSeq: string | null;
  origin: { id: string | null; run: string } | null;
};

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

function jsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function originOf(
  source: { kind: string; message?: string; original_message?: string },
): { id: string | null; kind: Origin } {
  if (source.kind === "message") {
    return { id: source.message ?? null, kind: "human_request" };
  }
  if (source.kind === "handoff") {
    return { id: source.original_message ?? null, kind: "handoff" };
  }
  return { id: null, kind: "periodic" };
}

// 사람이 거절한 같은 동작이 이 run의 계보에 있는지(R9). 거절만 본다. 만료·취소·기술 실패는
// status가 달라 걸리지 않는다. 계보는 같은 run이거나 같은 원래 사람 요청이다.
async function refusedBefore(
  deps: JudgmentDeps,
  run: { run: string; origin: string | null },
  action: { operation: string; targets: readonly string[]; input: JsonObject },
): Promise<boolean> {
  const listed = await post(deps.machine, approvalsList, {
    status: "rejected",
    limit: 100,
  });
  if (!listed.ok) return false;
  const key = refusalKey(action);
  const origins = new Map<string, string | null>();
  for (const request of listed.value.requests) {
    if (request.run === null || request.action.input.kind !== "inline") {
      continue;
    }
    // confirm 접수 입력의 approval ID는 요청마다 달라 같은 동작의 비교에서 뺀다.
    const rejected = request.action.input.value;
    const same = refusalKey({
      operation: request.action.command,
      targets: request.action.targets,
      input: "approval" in rejected && request.action.command ===
          "invocation.accept_confirm"
        ? Object.fromEntries(
          Object.entries(rejected).filter(([name]) => name !== "approval"),
        )
        : rejected,
    }) === key;
    if (!same) continue;
    if (run.run === request.run) return true;
    if (!origins.has(request.run)) {
      const read = await post(deps.machine, runRead, { run: request.run });
      origins.set(
        request.run,
        read.ok ? originOf(read.value.run.source).id : null,
      );
    }
    if (
      sameLineage(run, {
        run: request.run,
        origin: origins.get(request.run) ?? null,
      })
    ) return true;
  }
  return false;
}

// 호출 하나의 사실을 읽는다. 읽지 못한 것은 모른다로 두어 판정이 deny가 되게 한다(R2).
async function gather(
  deps: JudgmentDeps,
  request: CallRequest,
): Promise<Gathered> {
  const definition = findTool(deps.listed, request.tool);
  const binding = definition === undefined
    ? undefined
    : deps.bindings.get(definition.name);
  const read = await post(deps.machine, runRead, { run: request.run });
  const record = read.ok ? read.value.run : undefined;
  const assigned = record === undefined
    ? undefined
    : await post(deps.machine, assignmentRead, {
      assignment: record.assignment,
    });
  const assignment = assigned?.ok ? assigned.value.assignment : undefined;
  const origin = record === undefined ? null : originOf(record.source);
  const checked = definition === undefined
    ? undefined
    : checkInput(definition.input, request.input);
  const validInput = checked?.ok === true && jsonObject(checked.value) &&
    unchanged(request.input, checked.value);
  const input = validInput && jsonObject(request.input) ? request.input : null;
  const resolved = definition === undefined || binding === undefined ||
      !validInput
    ? undefined
    : await binding.resolve(request.input, {
      run: request.run,
      toolCall: request.toolCall,
    });
  const action = resolved?.ok ? resolved.value : null;
  const connection = definition?.origin === "external"
    ? deps.mcpConnection(definition)
    : undefined;
  // R4: 주기 run은 assignment가 선언한 남길 문서·읽을 자료의 쓰기만 열린다. 선언은
  // assignment 읽기의 outputs와 읽기 선언 표에서 읽는다.
  const declaredOutputs = assignment === undefined
    ? new Set<string>()
    : new Set(assignment.outputs.map((output) => output.document));
  const targets = (action?.targets ?? []).map((target) => ({
    id: target.id,
    inScope: deps.credential.targets.has(target.id),
    declared: declaredOutputs.has(target.id),
    reversibility: target.reversibility,
  }));
  const refused = action !== null && input !== null && record !== undefined &&
      origin !== null
    ? await refusedBefore(
      deps,
      { run: request.run, origin: origin.id },
      action.confirm === undefined
        ? {
          operation: action.operation,
          targets: action.targets.map((target) => target.id),
          input,
        }
        : {
          operation: action.operation,
          targets: [action.confirm.app, action.confirm.release],
          input: action.confirm as JsonObject,
        },
    )
    : false;
  const facts: CallFacts = {
    identity: deps.credential.run === request.run &&
      record?.assignment === deps.assignment,
    assignment: assignment === undefined
      ? "unknown"
      : assignment.state === "enabled"
      ? "active"
      : assignment.state,
    run: record === undefined
      ? "unknown"
      : record.state === "finished"
      ? "ended"
      : "active",
    origin: origin?.kind ?? null,
    // 소유 계약이 현재 동작을 읽어 주지 못하면(범위 밖·없는 대상·계약이 바뀜) 없는 tool과 같은 답이다.
    listed: definition !== undefined && binding !== undefined &&
      resolved?.ok !== false,
    roleAllows: definition !== undefined &&
      deps.credential.operations.has(definition.contract),
    connection: definition?.origin !== "external"
      ? "n/a"
      : connection === undefined
      ? "lost"
      : "connected",
    inputValid: validInput,
    effect: definition?.effect ?? null,
    confirm: definition?.confirm ?? false,
    refused,
    targets,
  };
  let basis: BasisSnapshot | null = null;
  if (
    definition !== undefined && action !== null && input !== null &&
    assignment !== undefined
  ) {
    basis = {
      tool: definition.name,
      definition_revision: definition.revision,
      description_hash: await fingerprint(definition.description),
      contract_revision: action.contractRevision,
      operation: action.operation,
      input_hash: await fingerprint(input),
      targets: action.targets.map((target) => target.id),
      comparison: action.comparison,
      mcp_configuration_revision: connection?.revision ?? null,
      assignment_revision: assignment.revision,
      preset_revision: assignment.preset_revision,
    };
  }
  return {
    facts,
    basis,
    resolved: action,
    input,
    assignmentRevision: assignment?.revision ?? null,
    presetRevision: assignment?.preset_revision ?? null,
    runStateSeq: record?.state_seq ?? null,
    origin: record === undefined || origin === null
      ? null
      : { id: origin.id, run: record.id },
  };
}

// approval에 고정하는 정확한 동작. 같은 사실에서 항상 같은 binding hash가 나온다. confirm 앱 command는
// 접수 command 자체가 동작이라 approval ID가 입력에 들어간다.
async function actionFor(
  deps: JudgmentDeps,
  gathered: Gathered,
  approval?: string,
): Promise<ApprovalAction | undefined> {
  const { resolved, input } = gathered;
  if (resolved === null || input === null) return undefined;
  const caller = `agent:${deps.assignment}` as ApprovalAction["caller"];
  let base;
  if (resolved.confirm !== undefined) {
    if (approval === undefined) return undefined;
    const accept = { ...resolved.confirm, approval };
    base = {
      concern: resolved.concern,
      command: resolved.operation,
      caller,
      targets: [accept.app, accept.release],
      input: { kind: "inline" as const, value: accept },
      input_hash: await fingerprint(accept),
      comparison: { release: accept.release },
    };
  } else {
    base = {
      concern: resolved.concern,
      command: resolved.operation,
      caller,
      targets: resolved.targets.map((target) => target.id),
      input: { kind: "inline" as const, value: input },
      input_hash: await fingerprint(input),
      comparison: resolved.comparison,
    };
  }
  return {
    ...base,
    binding_hash: await approvalBindingHash({ ...base, binding_hash: "0" }),
  };
}

export type Decided = {
  decision: ToolDecision;
  judgment: Judgment;
  // 판정을 기록한 뒤의 ToolCall state_seq.
  stateSeq: string;
};

function nextSeq(seq: string): string {
  return (BigInt(seq) + 1n).toString();
}

export function createToolJudgment(deps: JudgmentDeps) {
  async function record(
    request: CallRequest,
    decision: ToolDecision,
  ): Promise<Result<string>> {
    const decided = await post(deps.machine, decideToolCall, {
      input: { tool_call: request.toolCall, decision },
      idempotency_key: `${request.toolCall}:decide`,
      compare: { state_seq: request.stateSeq },
      prepared: [],
    });
    if (!decided.ok) return decided;
    return ok(nextSeq(request.stateSeq));
  }

  // 설명은 이 call 하나를 가리킨다. 승인은 그 call 하나에만 쓰므로 같은 동작의 다른 call은 다른
  // approval이 필요하다.
  function reasonOf(request: CallRequest, targets: readonly string[]): string {
    return `tool call ${request.toolCall}: ${request.tool} on ${
      targets.join(", ")
    }`;
  }

  function targetsOf(gathered: Gathered): string[] {
    const resolved = gathered.resolved!;
    return resolved.confirm === undefined
      ? resolved.targets.map((target) => target.id)
      : [resolved.confirm.app, resolved.confirm.release];
  }

  // 같은 call의 대기 approval이 이미 있으면 그것을 쓴다. 재시도·복구가 같은 질문을 둘 만들지
  // 않는다.
  async function pendingFor(
    request: CallRequest,
    gathered: Gathered,
  ): Promise<string | undefined> {
    const reason = await sha256Hex(reasonOf(request, targetsOf(gathered)));
    const listed = await post(deps.machine, approvalsList, {
      run: request.run,
      status: "pending",
    });
    if (!listed.ok) return undefined;
    for (const entry of listed.value.requests) {
      if (entry.reason_blob !== reason) continue;
      const action = await actionFor(deps, gathered, entry.id);
      if (action?.binding_hash === entry.action.binding_hash) return entry.id;
    }
    return undefined;
  }

  async function createApproval(
    request: CallRequest,
    gathered: Gathered,
  ): Promise<Result<string | "refused">> {
    const existing = await pendingFor(request, gathered);
    if (existing !== undefined) return ok(existing);
    const resolved = gathered.resolved;
    if (resolved === null) {
      return err({ code: "internal", message: "approval has no action" });
    }
    const id = deps.ids.newId("apr");
    const action = await actionFor(deps, gathered, id);
    if (action === undefined) {
      return err({ code: "internal", message: "approval has no action" });
    }
    // 설명은 값으로 싣는다. core가 redaction을 거쳐 blob으로 준비하고 platform이 영구 참조를
    // 등록한다. 여기서 hash를 만들지도 blob을 준비하지도 않는다.
    const body = {
      id,
      requester: `agent:${deps.assignment}`,
      run: request.run,
      reason: reasonOf(request, targetsOf(gathered)),
      effect: {
        changes: resolved.changes,
        external: resolved.external,
        reversible: false,
        reversibility: resolved.reversibility,
      },
      action,
      expires_at: formatAt(deps.clock.nowMs() + deps.approvalTtlMs),
    };
    const created = await post(deps.agent, createApprovalRequest, {
      input: body,
      idempotency_key: `${request.toolCall}:approval`,
      compare: {},
      prepared: [],
    });
    if (created.ok) return ok(created.value.request.id);
    // 읽기 목록이 놓친 오래된 거절은 platform의 계보 검사가 같은 답으로 막는다(R9).
    const details = created.error.details;
    if (
      created.error.code === "conflict" &&
      typeof details?.["rejected_approval"] === "string"
    ) return ok("refused");
    return created;
  }

  // 호출을 판정하고 기록한다. ask면 정확한 approval request를 만들어 잇고, deny는 호출도
  // approval request도 만들지 않는다(R1). 쓰기·승인 필요 호출의 시작은 이 기록 뒤에만 한다.
  async function decide(request: CallRequest): Promise<Result<Decided>> {
    const gathered = await gather(deps, request);
    let judgment = judge(gathered.facts);
    let approval: string | null = null;
    if (judgment.decision === "ask") {
      if (gathered.resolved === null || gathered.input === null) {
        judgment = judge({ ...gathered.facts, effect: null });
      } else {
        const created = await createApproval(request, gathered);
        if (!created.ok) return created;
        if (created.value === "refused") {
          judgment = judge({ ...gathered.facts, refused: true });
        } else {
          approval = created.value;
        }
      }
    }
    const decision: ToolDecision = {
      decision: judgment.decision,
      reason: judgment.reason,
      effect: judgment.effect,
      assignment_revision: gathered.assignmentRevision,
      preset_revision: gathered.presetRevision,
      contract_revision: gathered.resolved?.contractRevision ?? null,
      comparison_basis: gathered.basis,
      approval: judgment.decision === "ask" ? approval : null,
    };
    const recorded = await record(request, decision);
    if (!recorded.ok) return recorded;
    let stateSeq = recorded.value;
    if (judgment.decision === "deny") {
      const closed = await closeUnentered(request, stateSeq, "denied");
      if (!closed.ok) return closed;
      stateSeq = closed.value;
    }
    return ok({ decision, judgment, stateSeq });
  }

  // 진입하지 않고 끝나는 call의 기록. 미실행이고 결과 hash는 없다.
  async function closeUnentered(
    request: CallRequest,
    stateSeq: string,
    code: string,
  ): Promise<Result<string>> {
    const finished = await post(deps.machine, finishToolCall, {
      input: {
        tool_call: request.toolCall,
        outcome: { kind: "not_executed", code },
        output: null,
        result: null,
        finished_at: deps.clock.now(),
        duration_ms: null,
      },
      idempotency_key: `${request.toolCall}:finish`,
      compare: { state_seq: stateSeq },
      prepared: [],
    });
    if (!finished.ok) return finished;
    return ok(nextSeq(stateSeq));
  }

  async function approvalOf(id: string): Promise<
    Result<{ request: ApprovalRequest; used: boolean }>
  > {
    const read = await post(deps.machine, approvalsGet, { approval: id });
    if (!read.ok) return read;
    return ok({ request: read.value.request, used: read.value.use !== null });
  }

  // 최초·retry·복구·approval 뒤의 실제 호출 직전 재검사(R6). 확인한 대상·입력·계약·연결·
  // scope가 기록한 판정 때와 다르면 옛 허락을 쓰지 않는다. 승인 상태는 platform ledger의
  // 사람 결정만 읽고 model·자료의 말은 읽지 않는다(R7).
  async function admit(
    request: CallRequest,
    recorded: ToolDecision,
  ): Promise<Result<Admission>> {
    if (recorded.decision === "deny") {
      return ok({ kind: "denied", reason: recorded.reason });
    }
    let approval: { request: ApprovalRequest; used: boolean } | undefined;
    if (recorded.decision === "ask") {
      if (recorded.approval === null) return ok({ kind: "changed" });
      const read = await approvalOf(recorded.approval);
      if (!read.ok) return ok({ kind: "changed" });
      approval = read.value;
      // 사람의 결정이 끝난 approval은 현재 판정보다 먼저 답한다. 거절과 만료는 다른 사실이다.
      if (approval.request.status === "rejected") {
        return ok({ kind: "rejected", approval: recorded.approval });
      }
      if (
        approval.request.status === "expired" ||
        approval.request.status === "cancelled"
      ) {
        return ok({
          kind: "ended",
          approval: recorded.approval,
          status: approval.request.status,
        });
      }
    }
    const gathered = await gather(deps, request);
    const current = judge(gathered.facts);
    if (current.decision === "deny") {
      return ok({ kind: "denied", reason: current.reason });
    }
    if (
      current.decision !== recorded.decision || gathered.basis === null ||
      gathered.assignmentRevision !== recorded.assignment_revision ||
      gathered.presetRevision !== recorded.preset_revision ||
      !sameBasis(recorded.comparison_basis, gathered.basis)
    ) return ok({ kind: "changed" });
    if (approval === undefined || recorded.approval === null) {
      return ok({ kind: "enter", approval: null });
    }
    const action = await actionFor(deps, gathered, recorded.approval);
    if (
      action === undefined ||
      action.binding_hash !== approval.request.action.binding_hash
    ) return ok({ kind: "changed" });
    if (approval.request.status === "pending") {
      return ok({ kind: "waiting", approval: recorded.approval });
    }
    if (approval.used) return ok({ kind: "used", approval: recorded.approval });
    return ok({ kind: "enter", approval: recorded.approval });
  }

  // 진입을 기록한다. 이 기록은 판정이 있고 허락된 호출에만 낸다.
  async function start(
    request: CallRequest,
    admission: Extract<Admission, { kind: "enter" }>,
  ): Promise<Result<string>> {
    const gathered = await gather(deps, request);
    if (gathered.runStateSeq === null || gathered.assignmentRevision === null) {
      return err({ code: "unavailable", message: "run state is unknown" });
    }
    const started = await post(deps.machine, startToolCall, {
      input: {
        tool_call: request.toolCall,
        started_at: deps.clock.now(),
        approval: admission.approval,
      },
      idempotency_key: `${request.toolCall}:start`,
      compare: {
        state_seq: request.stateSeq,
        run_state_seq: gathered.runStateSeq,
        assignment_revision: gathered.assignmentRevision,
      },
      prepared: [],
    });
    if (!started.ok) return started;
    return ok(nextSeq(request.stateSeq));
  }

  // 허락된 동작을 적용한다. 소유 변경과 approval 한 번 사용은 platform이 같은 transaction에서
  // 확정하고, 같은 approval을 다시 쓰는 호출은 새 변경 없이 처음 receipt를 돌려받는다.
  async function apply(
    request: CallRequest,
    admission: Extract<Admission, { kind: "enter" }>,
  ) {
    if (admission.approval === null) {
      return err({ code: "invalid_input", message: "nothing to apply" });
    }
    const gathered = await gather(deps, request);
    const action = await actionFor(deps, gathered, admission.approval);
    if (action === undefined) {
      return err({ code: "conflict", message: "the action is not available" });
    }
    return await post(deps.machine, applyApprovedAction, {
      input: {
        approval: admission.approval,
        action,
        idempotency_key: request.toolCall,
      },
      idempotency_key: `${request.toolCall}:apply`,
      compare: {},
      prepared: [],
    });
  }

  return { decide, admit, start, apply, closeUnentered };
}

export type Admission =
  | { kind: "enter"; approval: string | null }
  | { kind: "waiting"; approval: string }
  | { kind: "rejected"; approval: string }
  | { kind: "ended"; approval: string; status: string }
  | { kind: "used"; approval: string }
  | { kind: "changed" }
  | { kind: "denied"; reason: string };
