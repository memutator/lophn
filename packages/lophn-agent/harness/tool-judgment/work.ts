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
} from "../../../protocol/lophn-agent/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../../protocol/apps/mod.ts";
import { documentGet } from "../../../protocol/projects/mod.ts";
import {
  applyApprovedAction,
  type ApprovalAction,
  approvalBindingHash,
  type ApprovalRequest,
  approvalsGet,
  approvalsList,
  createApprovalRequest,
  type JsonObject,
} from "../../../protocol/platform/mod.ts";
import {
  checkInput,
  findTool,
  type RunCredential,
  type ToolDefinition,
  unchanged,
} from "../tools/mod.ts";
import { type CoreCall, post } from "./core-call.ts";
import {
  type BasisSnapshot,
  type CallFacts,
  judge,
  type Judgment,
  lowerBySessionGrant,
  type Origin,
  refusalKey,
  type Reversibility,
  sameBasis,
  sameLineage,
} from "./model.ts";
import { findSessionGrant } from "./session-grant.ts";

// 호출 판정과 진입 직전 재검사. command 밖의 일이고 결과는 command로 남긴다. 판정은 model.ts의
// 판정표가 하고 여기는 사실을 읽고 기록과 approval 생성·적용을 잇는다. model의 말은 어느
// 사실에도 들어오지 않는다(R7). core 읽기와 command는 주입한 호출로만 한다.

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
  // run 기준이 고정한 resolved agent의 hash. 판정 기록과 같은 tool 비교(session 허락)의 기준이다.
  agentHash: string;
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
  // run을 읽지 못했으면 null이다.
  agentHash: string | null;
  runStateSeq: string | null;
  origin: { id: string | null; run: string } | null;
  // 이 run이 속한 session. session 허락을 찾는 범위다.
  session: string | null;
};

function jsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function originOf(
  source: { kind: string; message?: string; original_message?: string },
): { id: string | null; kind: Origin } {
  if (source.kind === "message") {
    return { id: source.message ?? null, kind: "human_request" };
  }
  return { id: source.original_message ?? null, kind: "handoff" };
}

// confirm 접수의 같은 동작은 앱·release·command·입력 지문이다. approval·key·caller는
// 호출마다 다르고, process nonce는 run이 끝나 앱이 다시 뜨면 바뀐다(apps Q23).
function confirmRefusalInput(value: JsonObject): JsonObject {
  return {
    app: value["app"],
    release: value["release"],
    command: value["command"],
    input_hash: value["input_hash"],
  };
}

// Operator의 쓰기가 닿는 대상이 그 Operator의 담당 자리(project 또는 앱)에 속하는지. 문서 쓰기는
// 대상이 저장할 문서(자리를 소유 계약이 말한다)이거나 새 문서를 놓을 자리 자체다. 읽지 못한 문서,
// 자리가 없는 문서, 다른 자리의 문서는 모두 같은 답(false)이라 존재가 새지 않는다. 쓸 수 있는 tool은
// 정의의 권한이 이미 걸러서 제공했고(roleAllows), 이 검사는 그 안에서 자리만 본다.
async function inOperatorPlace(
  deps: JudgmentDeps,
  place: { kind: string; id: string | null },
  target: string,
): Promise<boolean> {
  if (place.id === null) return false;
  if (target.startsWith("prj_") || target.startsWith("app_")) {
    return target === place.id;
  }
  if (!target.startsWith("doc_")) return false;
  const read = await post(deps.agent, documentGet, { document: target });
  if (!read.ok) return false;
  const where = read.value.document.place;
  return where !== null && where.kind === place.kind && where.id === place.id;
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
  const confirm = action.operation === "invocation.accept_confirm";
  const key = refusalKey(
    confirm ? { ...action, input: confirmRefusalInput(action.input) } : action,
  );
  const origins = new Map<string, string | null>();
  for (const request of listed.value.requests) {
    if (request.run === null || request.action.input.kind !== "inline") {
      continue;
    }
    const rejected = request.action.input.value;
    const same = refusalKey({
      operation: request.action.command,
      targets: request.action.targets,
      input: request.action.command === "invocation.accept_confirm"
        ? confirmRefusalInput(rejected)
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
  // Operator의 문서 쓰기는 정의의 권한 안(제공된 tool)에서 담당 자리의 문서에만 닿는다. 자리 밖은
  // 승인으로 열지 않는 범위 밖이다. 그다음 판정은 다른 agent와 같다(roles/operator#R7).
  const placed = assignment?.role === "operator" &&
    action?.concern === "documents/versions";
  const targets = await Promise.all(
    (action?.targets ?? []).map(async (target) => ({
      id: target.id,
      inScope: deps.credential.targets.has(target.id) &&
        (!placed || await inOperatorPlace(deps, assignment.scope, target.id)),
      reversibility: target.reversibility,
    })),
  );
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
      agent_hash: deps.agentHash,
    };
  }
  return {
    facts,
    basis,
    resolved: action,
    input,
    assignmentRevision: assignment?.revision ?? null,
    agentHash: record === undefined ? null : deps.agentHash,
    runStateSeq: record?.state_seq ?? null,
    origin: record === undefined || origin === null
      ? null
      : { id: origin.id, run: record.id },
    session: record?.session ?? null,
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

  // 판정표 뒤에 session 허락 칸을 적용한다. ask로 판정된 호출만 같은 session의 같은 tool·동작에 대한
  // 허락이 있을 때 allow로 낮아지고, 낮춘 근거 request를 함께 돌려준다. confirm 앱 command는 낮추지
  // 않는다(R14).
  async function judgeWithSessionGrant(
    gathered: Gathered,
  ): Promise<{ judgment: Judgment; grant: string | null }> {
    const judgment = judge(gathered.facts);
    const { resolved, basis, session } = gathered;
    if (
      judgment.decision !== "ask" || gathered.facts.confirm ||
      resolved === null || resolved.confirm !== undefined ||
      basis === null || session === null
    ) return { judgment, grant: null };
    const grant = await findSessionGrant(deps.machine, {
      session,
      concern: resolved.concern,
      basis,
    });
    return grant === undefined
      ? { judgment, grant: null }
      : { judgment: lowerBySessionGrant(gathered.facts, judgment), grant };
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
      // 카드가 Allow for this session을 보일 수 있는 ask는 session 있는 run의 tool call ask이고 사람이
      // 호출마다 확인하는 앱 command(confirm)가 아닌 것이다(platform/approvals#R20).
      session_grantable: resolved.confirm === undefined &&
        gathered.session !== null,
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
    const judged = await judgeWithSessionGrant(gathered);
    let judgment = judged.judgment;
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
      agent_hash: gathered.agentHash,
      contract_revision: gathered.resolved?.contractRevision ?? null,
      comparison_basis: gathered.basis,
      approval: judgment.decision === "ask" ? approval : null,
      // 낮춘 allow만 근거 request를 남긴다. 판정이 다시 계산돼 ask·deny가 되면 근거도 없다.
      session_grant: judgment.code === "session_granted" ? judged.grant : null,
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
    // 낮춘 allow의 재검사는 session 허락이 지금도 서 있어야 allow다. 사람의 한 번 허락을 기다린
    // 호출은 그 사이 생긴 session 허락으로 판정을 바꾸지 않는다.
    const current = recorded.decision === "allow"
      ? (await judgeWithSessionGrant(gathered)).judgment
      : judge(gathered.facts);
    if (current.decision === "deny") {
      return ok({ kind: "denied", reason: current.reason });
    }
    if (
      current.decision !== recorded.decision || gathered.basis === null ||
      gathered.assignmentRevision !== recorded.assignment_revision ||
      gathered.agentHash !== recorded.agent_hash ||
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
